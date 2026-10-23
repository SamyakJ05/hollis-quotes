/**
 * Seeds a company from its CSVs: company, settings, users, rates, customers.
 * Used by scripts/seed.ts and by the tests (against an in-memory Postgres).
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { companies, companySettings, customerContacts, customers, rates, users } from "@/db/schema";
import { parseCsv } from "./csv";
import { normaliseCustomers } from "./customers";
import { normaliseRates, type RateDecision } from "./rates";

export type CompanySeed = {
  name: string;
  slug: string;
  tradingArea: string;
  ratesCsv: string;
  customersCsv: string;
  decisions: Record<string, RateDecision>;
  siteVisitAreaM2: number;
  siteVisitKeywords?: string[];
  users: { email: string; name: string; role: "owner" | "staff"; password: string }[];
};

export async function seedCompany(db: DB, seed: CompanySeed) {
  const existing = await db.select().from(companies).where(eq(companies.slug, seed.slug));
  if (existing.length) return { companyId: existing[0].id, skipped: true as const, problems: [] as string[] };

  const vatBps = 2000;
  const rateResult = normaliseRates(parseCsv(seed.ratesCsv), { vatBps, decisions: seed.decisions });
  const customerResult = normaliseCustomers(parseCsv(seed.customersCsv));

  return db.transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: seed.name, slug: seed.slug, tradingArea: seed.tradingArea })
      .returning();

    await tx.insert(companySettings).values({
      companyId: company.id,
      vatRateBps: vatBps,
      minimumChargePence: rateResult.minimumChargePence ?? 0,
      siteVisitAreaM2: seed.siteVisitAreaM2,
      siteVisitKeywords: seed.siteVisitKeywords ?? [],
    });

    for (const u of seed.users) {
      await tx.insert(users).values({
        companyId: company.id,
        email: u.email.toLowerCase(),
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      });
    }

    await tx.insert(rates).values(rateResult.rates.map((r) => ({ ...r, companyId: company.id })));

    for (const c of customerResult) {
      const { contacts, sourceRows, ...rest } = c;
      const [row] = await tx
        .insert(customers)
        .values({ ...rest, companyId: company.id, importNotes: [`From sheet rows ${sourceRows.join(", ")}`, ...rest.importNotes] })
        .returning();
      if (contacts.length) {
        await tx
          .insert(customerContacts)
          .values(contacts.map((ct) => ({ ...ct, companyId: company.id, customerId: row.id })));
      }
    }

    return { companyId: company.id, skipped: false as const, problems: rateResult.problems };
  });
}
