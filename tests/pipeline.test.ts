import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { quotes, users } from "@/db/schema";
import { makeRepo } from "@/server/repo";
import { draftQuoteFromEnquiry } from "@/quote/pipeline";
import type { DraftCaller } from "@/ai/providers";
import type { Draft } from "@/ai/draft-schema";
import { freshDbWithBothCompanies } from "./helpers";
import { greenwayDraft, kestrelCompromisedDraft, kestrelDraft, okaforDraft } from "./fixtures/drafts";

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const enquiry = (f: string) => readFileSync(`tests/fixtures/${f}`, "utf8");
const fake = (draft: Draft, seen?: { system?: string; user?: string; key?: string }) => (creds: { apiKey: string }) =>
  (async (system: string, user: string) => {
    if (seen) Object.assign(seen, { system, user, key: creds.apiKey });
    return { draft, model: "fake-model", raw: draft };
  }) as DraftCaller;

type Repo = ReturnType<typeof makeRepo>;
type Edit = Parameters<Repo["saveQuoteEdits"]>[1];
/** Saves as someone who has just opened the current version of the quote. */
const save = async (repo: Repo, id: string, edit: Omit<Edit, "seenUpdatedAtMs">) =>
  repo.saveQuoteEdits(id, { ...edit, seenUpdatedAtMs: (await repo.getQuote(id))?.updatedAt.getTime() ?? 0 });

let ctx: Awaited<ReturnType<typeof freshDbWithBothCompanies>>;
let daveId: string;
beforeAll(async () => {
  ctx = await freshDbWithBothCompanies();
  [{ id: daveId }] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, "dave@hollis.test"));
  await makeRepo(ctx.db, ctx.hollisId, daveId).saveApiKey("anthropic", "sk-ant-hollis-key-0001", null);
  await makeRepo(ctx.db, ctx.chaseId).saveApiKey("anthropic", "sk-ant-chase-key-0002", null);
});

describe("pipeline", () => {
  it("refuses without an API key", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    await repo.removeApiKey();
    const r = await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft));
    expect(r).toEqual({ ok: false, error: expect.stringContaining("API key") });
    await repo.saveApiKey("anthropic", "sk-ant-hollis-key-0001", null);
  });

  it("uses the company's own key and its own price list, without prices", async () => {
    const seen: { system?: string; user?: string; key?: string } = {};
    await draftQuoteFromEnquiry(makeRepo(ctx.db, ctx.chaseId), "From: a@b.com\n\nPlease quote new turf for my 40 m2 lawn", fake(okaforDraft, seen));
    expect(seen.key).toBe("sk-ant-chase-key-0002");
    expect(seen.system).toContain("LS01");
    expect(seen.system).not.toContain("BP01");
    expect(seen.system).not.toMatch(/£\s?\d/);
    expect(seen.user).toMatch(/^<enquiry>/);
    expect(seen.system).toContain("green waste removal (LS08)");
    expect(seen.system).not.toContain("250mm dug out");
  });

  it("saves a draft, matched to the right customer", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft));
    expect(r.ok).toBe(true);
    const q = (await repo.getQuote((r as { quoteId: string }).quoteId))!;
    expect(q.status).toBe("draft");
    expect(q.lines.length).toBe(8);
    expect((await repo.getCustomer(q.customerId!))!.displayName).toBe("Patience Okafor");
    expect(q.details!.measurements[0].value).toBe(27.871);
  });

  it("a compromised model still produces a draft, never an approved quote", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("3-kestrel-row-patio.txt"), fake(kestrelCompromisedDraft))) as { quoteId: string };
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.status).toBe("draft");
    expect(q.approvedBy).toBeNull();
    expect(q.flags.some((f) => f.level === "danger")).toBe(true);
    expect(q.lines.some((l) => l.rateCode === "DISCOUNT40")).toBe(false);
  });

  it("site visits are saved with no price", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("2-greenway-car-park.txt"), fake(greenwayDraft))) as { quoteId: string };
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.outcome).toBe("site_visit");
    expect(q.totalPence).toBe(0);
    expect(q.customerId).not.toBeNull();
  });
});

describe("human review", () => {
  it("edits recompute totals and re-apply the minimum charge", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const res = await save(repo, r.quoteId, {
      customerId: null,
      customerMessage: "edited",
      lines: [{ rateCode: null, description: "Small repair", unit: "job", quantityMilli: 1000, unitPricePence: 10000, working: null, assumption: null }],
    });
    expect(res.ok).toBe(true);
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.subtotalPence).toBe(10000);
    expect(q.minimumChargeAppliedPence).toBe(35000);
    expect(q.totalPence).toBe(54000);
  });

  it("saves edits with a customer attached, and rejects another company's customer", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const q = (await repo.getQuote(r.quoteId))!;
    const lines = q.lines.map((l) => ({ ...l }));
    expect((await save(repo, r.quoteId, { customerId: q.customerId, customerMessage: "x", lines })).ok).toBe(true);
    const chaseCustomer = (await makeRepo(ctx.db, ctx.chaseId).listCustomers())[0];
    const bad = await save(repo, r.quoteId, { customerId: chaseCustomer.id, customerMessage: "x", lines });
    expect(bad).toEqual({ ok: false, error: "Unknown customer" });
  });

  it("approval needs a person, happens once, and locks the quote", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const seen = (await repo.getQuote(r.quoteId))!.updatedAt.getTime();
    await expect(makeRepo(ctx.db, ctx.hollisId, null).setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen })).rejects.toThrow();
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen })).toEqual({ ok: true });
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen })).toEqual({ ok: false, reason: "not_draft" });
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.approvedBy).toBe(daveId);
    expect((await save(repo, r.quoteId, { customerId: null, customerMessage: "", lines: [] })).ok).toBe(false);
    const trail = await repo.auditTrail(r.quoteId);
    expect(trail.map((t) => t.action)).toEqual(["ai_draft_created", "approved"]);
  });

  it("another company can't approve or edit it", async () => {
    const hollis = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(hollis, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const chase = makeRepo(ctx.db, ctx.chaseId, "00000000-0000-0000-0000-000000000000");
    const seen = (await hollis.getQuote(r.quoteId))!.updatedAt.getTime();
    expect(await chase.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen })).toEqual({ ok: false, reason: "not_draft" });
    expect((await save(chase, r.quoteId, { customerId: null, customerMessage: "", lines: [] })).ok).toBe(false);
    expect((await hollis.getQuote(r.quoteId))!.status).toBe("draft");
  });

  it("ignores the client's claim about who wrote a line", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const q = (await repo.getQuote(r.quoteId))!;
    const lines = q.lines.map((l, i) => ({ ...l, source: "ai" as const, quantityMilli: i === 0 ? l.quantityMilli + 1000 : l.quantityMilli }));
    expect((await save(repo, r.quoteId, { customerId: q.customerId, customerMessage: "x", lines })).ok).toBe(true);
    const after = (await repo.getQuote(r.quoteId))!.lines;
    expect(after[0].source).toBe("human"); // changed, though the client said "ai"
    expect(after.slice(1).every((l) => l.source === "ai")).toBe(true); // untouched, keeps its source
    expect(after[1].working).toBe(q.lines[1].working);
  });

  it("won't add prices to a site visit unless the person confirms, and says so on the quote", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("2-greenway-car-park.txt"), fake(greenwayDraft))) as { quoteId: string };
    const custom = { rateCode: null, description: "Site survey", unit: "job" as const, quantityMilli: 1000, unitPricePence: 50000, working: null, assumption: null };
    const refused = await save(repo, r.quoteId, { customerId: null, customerMessage: "x", lines: [custom] });
    expect(refused).toMatchObject({ ok: false, code: "outcome_change" });
    expect((await repo.getQuote(r.quoteId))!.outcome).toBe("site_visit");
    expect((await repo.getQuote(r.quoteId))!.lines).toHaveLength(0);

    const ok = await save(repo, r.quoteId, { customerId: null, customerMessage: "x", acknowledgeOutcomeChange: true, lines: [custom] });
    expect(ok.ok).toBe(true);
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.outcome).toBe("priced");
    expect(q.flags.some((f) => f.message.includes("A person added prices"))).toBe(true);
    const edit = (await repo.auditTrail(r.quoteId)).find((t) => t.action === "edited")!;
    expect(edit.detail).toMatchObject({ outcomeChange: { from: "site_visit", to: "priced" } });
  });

  it("rejects an unknown rate code and an absurd line", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const base = { rateCode: null, description: "x", unit: "job" as const, quantityMilli: 1000, unitPricePence: 100, working: null, assumption: null };
    const unknown = await save(repo, r.quoteId, { customerId: null, customerMessage: "", lines: [{ ...base, rateCode: "NOPE9" }] });
    expect(unknown).toEqual({ ok: false, error: expect.stringContaining("NOPE9") });
    const huge = await save(repo, r.quoteId, { customerId: null, customerMessage: "", lines: [{ ...base, quantityMilli: 900_000_000, unitPricePence: 1_000_000 }] });
    expect(huge).toEqual({ ok: false, error: expect.stringContaining("looks wrong") });
  });

  it("approving a version that changed since it was opened is refused", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const opened = (await repo.getQuote(r.quoteId))!;
    // a colleague saves an edit after this person opened the page
    await save(repo, r.quoteId, { customerId: opened.customerId, customerMessage: "colleague's change", lines: opened.lines });
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: opened.updatedAt.getTime() })).toEqual({ ok: false, reason: "changed" });
    expect((await repo.getQuote(r.quoteId))!.status).toBe("draft");
    const latest = (await repo.getQuote(r.quoteId))!.updatedAt.getTime();
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: latest })).toEqual({ ok: true });
    await expect(repo.setQuoteStatus(r.quoteId, "approved")).rejects.toThrow(/version/);
  });

  it("a quote with security warnings needs them acknowledged to approve", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("3-kestrel-row-patio.txt"), fake(kestrelDraft))) as { quoteId: string };
    const seen = (await repo.getQuote(r.quoteId))!.updatedAt.getTime();
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen })).toEqual({ ok: false, reason: "warnings_unacknowledged" });
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: seen, acknowledgedWarnings: true })).toEqual({ ok: true });
    const approved = (await repo.auditTrail(r.quoteId)).find((t) => t.action === "approved")!;
    expect(approved.detail).toMatchObject({ securityWarningsAcknowledged: true });
  });

  it("refuses a save made against an older version, and writes nothing", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const opened = (await repo.getQuote(r.quoteId))!;
    expect((await save(repo, r.quoteId, { customerId: opened.customerId, customerMessage: "newer message", lines: opened.lines })).ok).toBe(true);
    const before = (await repo.getQuote(r.quoteId))!;

    const stale = await repo.saveQuoteEdits(r.quoteId, {
      customerId: null,
      customerMessage: "overwrites the newer message",
      seenUpdatedAtMs: opened.updatedAt.getTime(),
      lines: [{ rateCode: null, description: "Replaced", unit: "job", quantityMilli: 1000, unitPricePence: 100, working: null, assumption: null }],
    });
    expect(stale).toMatchObject({ ok: false, code: "changed", error: expect.stringContaining("changed by someone else") });
    const after = (await repo.getQuote(r.quoteId))!;
    expect(after.customerMessage).toBe("newer message");
    expect(after.lines.map((l) => l.description)).toEqual(before.lines.map((l) => l.description));
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect((await repo.auditTrail(r.quoteId)).filter((t) => t.action === "edited")).toHaveLength(1);
  });

  it("two reviewers: only the version on screen can be saved or approved", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const a = (await repo.getQuote(r.quoteId))!; // reviewer A opens the quote
    const b = (await repo.getQuote(r.quoteId))!; // reviewer B opens it too
    expect((await repo.saveQuoteEdits(r.quoteId, { customerId: b.customerId, customerMessage: "B's message", seenUpdatedAtMs: b.updatedAt.getTime(), lines: b.lines })).ok).toBe(true);

    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: a.updatedAt.getTime() })).toEqual({ ok: false, reason: "changed" });
    const aSave = await repo.saveQuoteEdits(r.quoteId, { customerId: a.customerId, customerMessage: "A's message", seenUpdatedAtMs: a.updatedAt.getTime(), lines: a.lines });
    expect(aSave).toMatchObject({ ok: false, code: "changed" });
    expect((await repo.getQuote(r.quoteId))!.customerMessage).toBe("B's message");

    const reread = (await repo.getQuote(r.quoteId))!; // A reloads and sees B's version
    expect(reread.customerMessage).toBe("B's message");
    expect(await repo.setQuoteStatus(r.quoteId, "approved", { seenUpdatedAtMs: reread.updatedAt.getTime() })).toEqual({ ok: true });
  });

  it("overriding a site visit retires the 'no price, by design' note and keeps the override warning", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("2-greenway-car-park.txt"), fake(greenwayDraft))) as { quoteId: string };
    const before = (await repo.getQuote(r.quoteId))!;
    expect(before.flags.some((f) => f.code === "no_price_by_design")).toBe(true);
    const custom = { rateCode: null, description: "Site survey", unit: "job" as const, quantityMilli: 1000, unitPricePence: 50000, working: null, assumption: null };
    expect((await save(repo, r.quoteId, { customerId: null, customerMessage: "x", acknowledgeOutcomeChange: true, lines: [custom] })).ok).toBe(true);
    const flags = (await repo.getQuote(r.quoteId))!.flags;
    expect(flags.some((f) => f.code === "no_price_by_design" || f.message.startsWith("Needs a site visit. No price"))).toBe(false);
    expect(flags.some((f) => f.message.includes("A person added prices"))).toBe(true);
  });

  it("also retires the note on rows saved before flags had codes", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("2-greenway-car-park.txt"), fake(greenwayDraft))) as { quoteId: string };
    const legacy = (await repo.getQuote(r.quoteId))!.flags.map((f) => ({ level: f.level, message: f.message }));
    await ctx.db.update(quotes).set({ flags: legacy }).where(eq(quotes.id, r.quoteId));
    const custom = { rateCode: null, description: "Site survey", unit: "job" as const, quantityMilli: 1000, unitPricePence: 50000, working: null, assumption: null };
    expect((await save(repo, r.quoteId, { customerId: null, customerMessage: "x", acknowledgeOutcomeChange: true, lines: [custom] })).ok).toBe(true);
    expect((await repo.getQuote(r.quoteId))!.flags.some((f) => f.message.startsWith("Needs a site visit. No price"))).toBe(false);
  });
});

describe("each company uses its own provider and key", () => {
  it("Chase on OpenAI and Hollis on Anthropic never borrow each other's", async () => {
    const hollis = makeRepo(ctx.db, ctx.hollisId, daveId);
    const chase = makeRepo(ctx.db, ctx.chaseId);
    await hollis.saveApiKey("anthropic", "sk-ant-hollis-fake-0001", null);
    await chase.saveApiKey("openai", "sk-chase-openai-fake-0002", "gpt-5.5");

    const seen: { company: string; provider: string; apiKey: string; model: string | null }[] = [];
    const factory = (company: string, draft: Draft) => (creds: { provider: string; apiKey: string; model: string | null }) => {
      seen.push({ company, ...creds });
      return (async () => ({ draft, model: creds.model ?? "default-model", raw: draft })) as DraftCaller;
    };
    const hq = (await draftQuoteFromEnquiry(hollis, enquiry("1-okafor-driveway.txt"), factory("hollis", okaforDraft))) as { quoteId: string };
    const cq = (await draftQuoteFromEnquiry(chase, "From: a@b.com\n\nPlease quote new turf for my 40 m2 lawn", factory("chase", okaforDraft))) as { quoteId: string };

    expect(seen).toEqual([
      { company: "hollis", provider: "anthropic", apiKey: "sk-ant-hollis-fake-0001", model: null },
      { company: "chase", provider: "openai", apiKey: "sk-chase-openai-fake-0002", model: "gpt-5.5" },
    ]);
    expect((await hollis.getQuote(hq.quoteId))!).toMatchObject({ aiProvider: "anthropic" });
    expect((await chase.getQuote(cq.quoteId))!).toMatchObject({ aiProvider: "openai", aiModel: "gpt-5.5" });
    // the other company can't open either quote, so can't see which provider it used
    expect(await chase.getQuote(hq.quoteId)).toBeNull();
    expect(await hollis.getQuote(cq.quoteId)).toBeNull();

    await chase.saveApiKey("anthropic", "sk-ant-chase-key-0002", null);
  });
});
