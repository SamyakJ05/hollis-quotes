/**
 * Runs the three sample enquiries through a REAL model with Hollis's rates,
 * no database or UI needed.
 *   npx tsx scripts/try-enquiries.ts [model] [fileprefix] [--provider anthropic|openai]
 * Reads ANTHROPIC_API_KEY (default) or OPENAI_API_KEY (--provider openai) from .env or the environment.
 * Anthropic was live-tested with all three enquiries; the OpenAI path is covered by mocked tests only,
 * so this script is how someone with an OpenAI key can check it end to end.
 * Writes each draft + built quote to .tmp/live-<provider>-<name>.json
 */
import "dotenv/config";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseCsv } from "../src/import/csv";
import { normaliseRates } from "../src/import/rates";
import { HOLLIS_RATE_DECISIONS } from "../src/import/hollis-decisions";
import { HOLLIS_ESTIMATING_NOTES } from "../src/import/estimating-notes";
import { buildSystemPrompt, buildUserMessage } from "../src/ai/prompt";
import { DEFAULT_MODELS, PROVIDER_INFO, type Provider } from "../src/ai/provider-info";
import { makeDraftCaller } from "../src/ai/providers";
import { buildQuote } from "../src/quote/build";
import { formatGBP, fromMilli } from "../src/lib/money";

function parseArgs(): { provider: Provider; model: string | null; only: string | undefined } {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--provider");
  const provider = at >= 0 ? argv[at + 1] : "anthropic";
  if (provider !== "anthropic" && provider !== "openai") {
    console.error(`Unknown provider "${provider}". Use --provider anthropic or --provider openai.`);
    process.exit(1);
  }
  const positional = argv.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  return { provider, model: positional[0] ?? null, only: positional[1] };
}

async function main() {
  const { provider, model: modelArg, only } = parseArgs();
  const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = process.env[keyVar];
  if (!apiKey) {
    console.error(`${keyVar} is not set. Add it to .env or the environment to run the ${PROVIDER_INFO[provider].label} path.`);
    process.exit(1);
  }
  const rates = normaliseRates(parseCsv(readFileSync("data/hollis-rates.csv", "utf8")), { vatBps: 2000, decisions: HOLLIS_RATE_DECISIONS }).rates;
  const settings = { minimumChargePence: 45000, vatRateBps: 2000, siteVisitAreaM2: 150, siteVisitKeywords: ["car park", "carpark", "car-park"] };
  const system = buildSystemPrompt({ companyName: "Hollis Groundworks", tradingArea: "Walsall", siteVisitAreaM2: 150, estimatingNotes: HOLLIS_ESTIMATING_NOTES, rates });
  const call = makeDraftCaller({ provider, apiKey, model: modelArg });
  mkdirSync(".tmp", { recursive: true });

  for (const f of readdirSync("tests/fixtures").filter((x) => x.endsWith(".txt") && (!only || x.startsWith(only)))) {
    const text = readFileSync(`tests/fixtures/${f}`, "utf8");
    const t0 = Date.now();
    const { draft, model } = await call(system, buildUserMessage(text));
    const q = buildQuote(draft, { enquiryText: text, rates, settings });
    writeFileSync(`.tmp/live-${provider}-${f.replace(".txt", "")}.json`, JSON.stringify({ model, draft, quote: q }, null, 2));
    console.log(`\n=== ${f}  (${PROVIDER_INFO[provider].label}, ${model ?? DEFAULT_MODELS[provider]}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
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
