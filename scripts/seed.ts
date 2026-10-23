import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb } from "../src/db";
import { seedCompany } from "../src/import/seed";
import { HOLLIS_RATE_DECISIONS } from "../src/import/hollis-decisions";
import { CHASE_RATE_DECISIONS } from "../src/import/chase-decisions";
import { runMigrations } from "./migrate";

function password(envName: string): string {
  const v = process.env[envName];
  if (v) return v;
  const generated = randomBytes(9).toString("base64url");
  console.log(`  ${envName} not set; generated: ${generated}`);
  return generated;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  await runMigrations(url);
  const db = createDb(url);

  const hollisPw = password("SEED_HOLLIS_PASSWORD");
  const chasePw = password("SEED_CHASE_PASSWORD");

  const hollis = await seedCompany(db, {
    name: "Hollis Groundworks",
    slug: "hollis",
    tradingArea: "Walsall",
    ratesCsv: readFileSync("data/hollis-rates.csv", "utf8"),
    customersCsv: readFileSync("data/hollis-customers.csv", "utf8"),
    decisions: HOLLIS_RATE_DECISIONS,
    siteVisitAreaM2: 150,
    siteVisitKeywords: ["car park", "carpark", "car-park"],
    users: [
      { email: "dave@hollisgroundworks.test", name: "Dave Hollis", role: "owner", password: hollisPw },
      { email: "shaz@hollisgroundworks.test", name: "Shaz", role: "staff", password: hollisPw },
    ],
  });
  console.log("Hollis:", hollis.skipped ? "already seeded" : "seeded", hollis.problems);

  const chase = await seedCompany(db, {
    name: "Chase Landscapes",
    slug: "chase",
    tradingArea: "Cannock",
    ratesCsv: readFileSync("data/chase-rates.csv", "utf8"),
    customersCsv: readFileSync("data/chase-customers.csv", "utf8"),
    decisions: CHASE_RATE_DECISIONS,
    siteVisitAreaM2: 100,
    users: [{ email: "gaz@chaselandscapes.test", name: "Gaz", role: "owner", password: chasePw }],
  });
  console.log("Chase:", chase.skipped ? "already seeded" : "seeded", chase.problems);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
