/**
 * Demo/dev only: saves the three sample enquiries as drafts using the
 * hand-written fixture answers instead of a live model, so the review
 * screens can be tried without an API key. Goes through the real pipeline.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db";
import { companies, users } from "../src/db/schema";
import { makeRepo } from "../src/server/repo";
import { draftQuoteFromEnquiry } from "../src/quote/pipeline";
import type { Draft } from "../src/ai/draft-schema";
import { greenwayDraft, kestrelDraft, okaforDraft } from "../tests/fixtures/drafts";

async function main() {
  const db = createDb(process.env.DATABASE_URL!);
  const [hollis] = await db.select().from(companies).where(eq(companies.slug, "hollis"));
  const [dave] = await db.select().from(users).where(eq(users.email, "dave@hollisgroundworks.test"));
  const repo = makeRepo(db, hollis.id, dave.id);
  const hadKey = (await repo.settings()).hasApiKey;
  if (!hadKey) await repo.saveApiKey("anthropic", "sk-ant-placeholder-for-fixtures-only", null);
  const pairs: [string, Draft][] = [
    ["1-okafor-driveway.txt", okaforDraft],
    ["2-greenway-car-park.txt", greenwayDraft],
    ["3-kestrel-row-patio.txt", kestrelDraft],
  ];
  for (const [file, draft] of pairs) {
    const r = await draftQuoteFromEnquiry(repo, readFileSync(`tests/fixtures/${file}`, "utf8"), () => async () => ({ draft, model: "fixture", raw: draft }));
    console.log(file, r);
  }
  if (!hadKey) await repo.removeApiKey();
  process.exit(0);
}
main();
