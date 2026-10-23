/**
 * Runs the three sample enquiries through a REAL model with Hollis's rates,
 * no database or UI needed. Reads ANTHROPIC_API_KEY from .env.
 *   npx tsx scripts/try-enquiries.ts [model]
 * Writes each draft + built quote to .tmp/live-<name>.json
 */
import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/import/csv";
import { normaliseRates } from "../src/import/rates";
import { HOLLIS_RATE_DECISIONS } from "../src/import/hollis-decisions";
import { buildSystemPrompt, buildUserMessage } from "../src/ai/prompt";
import { makeDraftCaller } from "../src/ai/providers";
import { buildQuote } from "../src/quote/build";
import { formatGBP, fromMilli } from "../src/lib/money";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY in .env");
  const rates = normaliseRates(parseCsv(readFileSync("data/hollis-rates.csv", "utf8")), { vatBps: 2000, decisions: HOLLIS_RATE_DECISIONS }).rates;
  const settings = { minimumChargePence: 45000, vatRateBps: 2000, siteVisitAreaM2: 150, siteVisitKeywords: ["car park", "carpark", "car-park"] };
  const system = buildSystemPrompt({ companyName: "Hollis Groundworks", tradingArea: "Walsall", siteVisitAreaM2: 150, rates });
  const call = makeDraftCaller({ provider: "anthropic", apiKey, model: process.argv[2] ?? null });
  mkdirSync(".tmp", { recursive: true });

  const only = process.argv[3];
  for (const f of readdirSync("tests/fixtures").filter((x) => x.endsWith(".txt") && (!only || x.startsWith(only)))) {
    const text = readFileSync(`tests/fixtures/${f}`, "utf8");
    const t0 = Date.now();
    const { draft, model } = await call(system, buildUserMessage(text));
    const q = buildQuote(draft, { enquiryText: text, rates, settings });
    writeFileSync(`.tmp/live-${f.replace(".txt", "")}.json`, JSON.stringify({ model, draft, quote: q }, null, 2));
    console.log(`\n=== ${f}  (${model}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`${q.outcome.toUpperCase()}: ${q.jobSummary}`);
    for (const l of q.lines) console.log(`  ${l.rateCode}  ${fromMilli(l.quantityMilli)} ${l.unit} × ${formatGBP(l.unitPricePence)} = ${formatGBP(l.lineTotalPence)}   (${l.working})`);
    if (q.outcome === "priced") console.log(`  Subtotal ${formatGBP(q.totals.subtotalPence)}  min top-up ${formatGBP(q.totals.minimumChargeAppliedPence)}  VAT ${formatGBP(q.totals.vatPence)}  TOTAL ${formatGBP(q.totals.totalPence)}`);
    for (const e of q.details.exclusions) console.log(`  EXCLUDED [${e.reason}] ${e.request}: ${e.note}`);
    for (const r of q.details.siteVisitReasons) console.log(`  SITE VISIT: ${r}`);
    for (const fl of q.flags) console.log(`  ${fl.level.toUpperCase()}: ${fl.message}`);
    for (const qn of q.details.questions) console.log(`  ASK: ${qn}`);
    console.log(`  MESSAGE: ${draft.customer_message.slice(0, 400)}`);
  }
}
main().catch((e) => {
  console.error(e.userMessage ?? "", e.message);
  process.exit(1);
});
