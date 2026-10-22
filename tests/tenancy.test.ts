import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companySettings, customers, enquiries, quotes } from "@/db/schema";
import { makeRepo } from "@/server/repo";
import { freshDbWithBothCompanies } from "./helpers";

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let ctx: Awaited<ReturnType<typeof freshDbWithBothCompanies>>;
beforeAll(async () => {
  ctx = await freshDbWithBothCompanies();
});

describe("tenant isolation", () => {
  it("each company only sees its own rates and customers", async () => {
    const hollis = makeRepo(ctx.db, ctx.hollisId);
    const chase = makeRepo(ctx.db, ctx.chaseId);
    const hRates = await hollis.listRates();
    const cRates = await chase.listRates();
    expect(hRates.every((r) => r.companyId === ctx.hollisId)).toBe(true);
    expect(cRates.every((r) => r.companyId === ctx.chaseId)).toBe(true);
    expect(hRates.some((r) => r.code.startsWith("LS"))).toBe(false);
    expect((await hollis.listCustomers()).length).toBe(9);
    expect((await chase.listCustomers()).length).toBe(3);
  });

  it("only active rates reach the AI", async () => {
    const active = await makeRepo(ctx.db, ctx.hollisId).activeRates();
    const codes = active.map((r) => r.code);
    for (const banned of ["KB04", "TM03", "CO02", "SB02", "BP02", "EX06", "MI01", "BP04", "KB02"]) {
      expect(codes).not.toContain(banned);
    }
  });

  it("fetching another company's quote by id returns nothing", async () => {
    const [enq] = await ctx.db
      .insert(enquiries)
      .values({ companyId: ctx.chaseId, rawText: "Gaz's private enquiry" })
      .returning();
    const [q] = await ctx.db
      .insert(quotes)
      .values({ companyId: ctx.chaseId, enquiryId: enq.id, outcome: "priced" })
      .returning();
    expect(await makeRepo(ctx.db, ctx.chaseId).getQuote(q.id)).not.toBeNull();
    expect(await makeRepo(ctx.db, ctx.hollisId).getQuote(q.id)).toBeNull();
    expect(await makeRepo(ctx.db, ctx.hollisId).getEnquiry(enq.id)).toBeNull();
  });

  it("the database refuses a quote that points at another company's customer", async () => {
    const [chaseCustomer] = await ctx.db.select().from(customers).where(eq(customers.companyId, ctx.chaseId)).limit(1);
    const [enq] = await ctx.db
      .insert(enquiries)
      .values({ companyId: ctx.hollisId, rawText: "x" })
      .returning();
    await expect(
      ctx.db.insert(quotes).values({
        companyId: ctx.hollisId,
        enquiryId: enq.id,
        customerId: chaseCustomer.id,
        outcome: "priced",
      }),
    ).rejects.toThrow();
  });

  it("customer lookup by email is scoped to the company", async () => {
    const hit = await makeRepo(ctx.db, ctx.hollisId).findCustomerByContact("Patience.Okafor64@example.com", null);
    expect(hit?.customer.displayName).toBe("Patience Okafor");
    expect(hit?.customer.internalNotes).toContain("2025");
    expect(await makeRepo(ctx.db, ctx.chaseId).findCustomerByContact("patience.okafor64@example.com", null)).toBeNull();
  });
});

describe("API keys", () => {
  it("are encrypted at rest, hidden from settings, and readable only by their own company", async () => {
    const hollis = makeRepo(ctx.db, ctx.hollisId);
    const key = "sk-ant-api03-TEST-KEY-abcd1234";
    await hollis.saveApiKey("anthropic", key, null);

    const [row] = await ctx.db.select().from(companySettings).where(eq(companySettings.companyId, ctx.hollisId));
    expect(row.encryptedApiKey).not.toContain("sk-ant");
    expect(row.apiKeyLast4).toBe("1234");

    const safe = await hollis.settings();
    expect(safe).not.toHaveProperty("encryptedApiKey");
    expect(JSON.stringify(safe)).not.toContain(key);
    expect(safe.hasApiKey).toBe(true);

    expect((await hollis.aiCredentials())?.apiKey).toBe(key);
    expect(await makeRepo(ctx.db, ctx.chaseId).aiCredentials()).toBeNull();

    // A ciphertext copied into another company's row must not decrypt there.
    await ctx.db
      .update(companySettings)
      .set({ encryptedApiKey: row.encryptedApiKey })
      .where(eq(companySettings.companyId, ctx.chaseId));
    await expect(makeRepo(ctx.db, ctx.chaseId).aiCredentials()).rejects.toThrow();
  });
});
