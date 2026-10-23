import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { makeRepo } from "@/server/repo";
import { draftQuoteFromEnquiry } from "@/quote/pipeline";
import type { DraftCaller } from "@/ai/providers";
import type { Draft } from "@/ai/draft-schema";
import { freshDbWithBothCompanies } from "./helpers";
import { greenwayDraft, kestrelCompromisedDraft, okaforDraft } from "./fixtures/drafts";

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const enquiry = (f: string) => readFileSync(`tests/fixtures/${f}`, "utf8");
const fake = (draft: Draft, seen?: { system?: string; user?: string; key?: string }) => (creds: { apiKey: string }) =>
  (async (system: string, user: string) => {
    if (seen) Object.assign(seen, { system, user, key: creds.apiKey });
    return { draft, model: "fake-model", raw: draft };
  }) as DraftCaller;

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
    const res = await repo.saveQuoteEdits(r.quoteId, {
      customerId: null,
      customerMessage: "edited",
      lines: [{ rateCode: null, description: "Small repair", unit: "job", quantityMilli: 1000, unitPricePence: 10000, source: "human", working: null, assumption: null }],
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
    expect((await repo.saveQuoteEdits(r.quoteId, { customerId: q.customerId, customerMessage: "x", lines })).ok).toBe(true);
    const chaseCustomer = (await makeRepo(ctx.db, ctx.chaseId).listCustomers())[0];
    const bad = await repo.saveQuoteEdits(r.quoteId, { customerId: chaseCustomer.id, customerMessage: "x", lines });
    expect(bad).toEqual({ ok: false, error: "Unknown customer" });
  });

  it("approval needs a person, happens once, and locks the quote", async () => {
    const repo = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(repo, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    await expect(makeRepo(ctx.db, ctx.hollisId, null).setQuoteStatus(r.quoteId, "approved")).rejects.toThrow();
    expect(await repo.setQuoteStatus(r.quoteId, "approved")).toBe(true);
    expect(await repo.setQuoteStatus(r.quoteId, "approved")).toBe(false);
    const q = (await repo.getQuote(r.quoteId))!;
    expect(q.approvedBy).toBe(daveId);
    expect((await repo.saveQuoteEdits(r.quoteId, { customerId: null, customerMessage: "", lines: [] })).ok).toBe(false);
    const trail = await repo.auditTrail(r.quoteId);
    expect(trail.map((t) => t.action)).toEqual(["ai_draft_created", "approved"]);
  });

  it("another company can't approve or edit it", async () => {
    const hollis = makeRepo(ctx.db, ctx.hollisId, daveId);
    const r = (await draftQuoteFromEnquiry(hollis, enquiry("1-okafor-driveway.txt"), fake(okaforDraft))) as { quoteId: string };
    const chase = makeRepo(ctx.db, ctx.chaseId, "00000000-0000-0000-0000-000000000000");
    expect(await chase.setQuoteStatus(r.quoteId, "approved")).toBe(false);
    expect((await chase.saveQuoteEdits(r.quoteId, { customerId: null, customerMessage: "", lines: [] })).ok).toBe(false);
    expect((await hollis.getQuote(r.quoteId))!.status).toBe("draft");
  });
});
