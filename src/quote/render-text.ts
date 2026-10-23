/** Plain-text version of an approved quote for pasting into an email. No internal notes, ever. */
import { formatGBP } from "@/lib/money";
import { formatQuantity } from "@/lib/quantity";
import { UNIT_LABEL } from "@/lib/units";
import type { QuoteDetails } from "./build";
import type { Unit } from "@/db/schema";

export function renderQuoteText(q: {
  companyName: string;
  customerName: string | null;
  jobSummary: string | null;
  outcome: string;
  customerMessage: string | null;
  lines: { description: string; unit: Unit; quantityMilli: number; unitPricePence: number; lineTotalPence: number }[];
  subtotalPence: number;
  minimumChargeAppliedPence: number;
  vatPence: number;
  totalPence: number;
  vatRateBps: number;
  validityDays: number;
  details: QuoteDetails | null;
}): string {
  const out: string[] = [];
  if (q.customerMessage) out.push(q.customerMessage.trim(), "");
  if (q.outcome === "priced" && q.lines.length) {
    out.push(`QUOTE: ${q.jobSummary ?? ""}`.trim(), "");
    for (const l of q.lines) {
      out.push(`- ${l.description}: ${formatQuantity(l.quantityMilli)} ${UNIT_LABEL[l.unit]} @ ${formatGBP(l.unitPricePence)} = ${formatGBP(l.lineTotalPence)}`);
    }
    out.push("", `Subtotal (ex VAT): ${formatGBP(q.subtotalPence)}`);
    if (q.minimumChargeAppliedPence) out.push(`Minimum charge adjustment: ${formatGBP(q.minimumChargeAppliedPence)}`);
    out.push(`VAT at ${q.vatRateBps / 100}%: ${formatGBP(q.vatPence)}`, `Total: ${formatGBP(q.totalPence)}`, "");
    if (q.details?.conditions.length) out.push("Notes:", ...q.details.conditions.map((c) => `- ${c}`), "");
    if (q.details?.exclusions.length) out.push("Not included:", ...q.details.exclusions.map((e) => `- ${e.request}: ${e.note}`), "");
    out.push(`This quote is valid for ${q.validityDays} days.`);
  }
  out.push("", q.companyName);
  return out.join("\n");
}
