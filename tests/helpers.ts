import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { DB } from "@/db";
import { seedCompany } from "@/import/seed";
import { HOLLIS_RATE_DECISIONS } from "@/import/hollis-decisions";
import { CHASE_RATE_DECISIONS } from "@/import/chase-decisions";

export async function freshDbWithBothCompanies() {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as DB;
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  const hollis = await seedCompany(db, {
    name: "Hollis Groundworks",
    slug: "hollis",
    tradingArea: "Walsall",
    ratesCsv: readFileSync("data/hollis-rates.csv", "utf8"),
    customersCsv: readFileSync("data/hollis-customers.csv", "utf8"),
    decisions: HOLLIS_RATE_DECISIONS,
    siteVisitAreaM2: 150,
    users: [{ email: "dave@hollis.test", name: "Dave", role: "owner", password: "pw-hollis" }],
  });
  const chase = await seedCompany(db, {
    name: "Chase Landscapes",
    slug: "chase",
    tradingArea: "Cannock",
    ratesCsv: readFileSync("data/chase-rates.csv", "utf8"),
    customersCsv: readFileSync("data/chase-customers.csv", "utf8"),
    decisions: CHASE_RATE_DECISIONS,
    siteVisitAreaM2: 100,
    users: [{ email: "gaz@chase.test", name: "Gaz", role: "owner", password: "pw-chase" }],
  });
  return { db, client, hollisId: hollis.companyId, chaseId: chase.companyId };
}
