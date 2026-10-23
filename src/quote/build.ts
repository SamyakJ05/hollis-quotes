/**
 * Turns the model's draft into a priced quote. This is plain code: it looks
 * up every rate itself, converts units, multiplies, applies options, the
 * minimum charge and VAT. It can drop or flag what the model said; it never
 * takes a price, discount or status from the model.
 */
import type { Draft, Exclusion } from "@/ai/draft-schema";
import type { RateAddon, RateStatus, Unit } from "@/db/schema";
import { formatGBP, lineTotal, toMilli } from "@/lib/money";
import { UNIT_LABEL } from "@/lib/units";
import { detectInjection, messageMentionsMoney, notOfferedMentions, siteVisitKeywordHits } from "./guards";
import { COMPATIBLE, resolveMeasurement, type ResolvedMeasurement } from "./measurements";
import { computeTotals, type Totals } from "./totals";

export type Flag = { level: "info" | "warn" | "danger"; message: string };

export type RateForPricing = {
  code: string;
  description: string;
  unit: Unit;
  ratePence: number | null;
  status: RateStatus;
  addons: RateAddon[];
  caveats: string[];
  reviewFlag: string | null;
  importNotes: string[];
};

export type PricingSettings = {
  minimumChargePence: number;
  vatRateBps: number;
  siteVisitAreaM2: number;
  siteVisitKeywords: string[];
};

export type BuiltLine = {
  position: number;
  rateCode: string | null;
  description: string;
  unit: Unit;
  quantityMilli: number;
  unitPricePence: number;
  lineTotalPence: number;
  source: "ai" | "human" | "rule";
  working: string | null;
  assumption: string | null;
};

export type QuoteDetails = {
  measurements: ResolvedMeasurement[];
  exclusions: Exclusion[];
  conditions: string[];
  questions: string[];
  assumptions: string[];
  siteVisitReasons: string[];
};

export type BuiltQuote = {
  outcome: "priced" | "site_visit" | "cannot_quote";
  jobSummary: string;
  lines: BuiltLine[];
  totals: Totals;
  flags: Flag[];
  details: QuoteDetails;
  customerMessage: string;
};

const EPS = 1e-9;

export function buildQuote(
  draft: Draft,
  ctx: { enquiryText: string; rates: RateForPricing[]; settings: PricingSettings },
): BuiltQuote {
  const flags: Flag[] = [];
  const exclusions: Exclusion[] = [...draft.exclusions];
  const conditions = new Set<string>();
  const byCode = new Map(ctx.rates.map((r) => [r.code.toUpperCase(), r]));
  const measurements = draft.measurements.map(resolveMeasurement);
  const mById = new Map(measurements.map((m) => [m.id, m]));

  // 1. Injection / manipulation: flagged whether or not the model noticed.
  const detected = detectInjection(ctx.enquiryText);
  const reported = draft.suspicious_content.map((s) => s.excerpt);
  for (const excerpt of new Set([...detected, ...reported])) {
    flags.push({
      level: "danger",
      message: `The enquiry contains text that tries to instruct the quoting system: "${excerpt.slice(0, 160)}". It was ignored and has no effect on prices or approval. Check with the customer before agreeing to anything it asks for.`,
    });
  }
  if (detected.length && !reported.length) {
    flags.push({ level: "warn", message: "The AI did not report the suspicious text itself; the code check caught it." });
  }

  // 2. Services we don't offer, mentioned anywhere in the enquiry.
  const notOffered = ctx.rates.filter((r) => r.status === "not_offered");
  for (const hit of notOfferedMentions(ctx.enquiryText, notOffered)) {
    flags.push({
      level: "warn",
      message: `The enquiry mentions "${hit.keyword}", which you don't offer. Nothing was priced for it; check the reply handles it.`,
    });
  }

  // 3. Site visit: the model's view, plus rules it can't overrule.
  let outcome = draft.recommended_outcome;
  const siteVisitReasons = [...draft.site_visit_reasons];
  const forced: string[] = [];
  for (const m of measurements) {
    if (m.unit === "m2" && m.value !== null && m.value > ctx.settings.siteVisitAreaM2) {
      forced.push(`${m.label} is about ${Math.round(m.value)} m², over the ${ctx.settings.siteVisitAreaM2} m² limit for emailed quotes`);
    }
  }
  for (const k of siteVisitKeywordHits(ctx.enquiryText, ctx.settings.siteVisitKeywords)) {
    forced.push(`The enquiry mentions "${k}"`);
  }
  if (forced.length) {
    if (outcome === "priced") {
      flags.push({ level: "warn", message: "The AI tried to price this, but your rules say it needs a site visit. No price was produced." });
    }
    outcome = "site_visit";
    siteVisitReasons.push(...forced);
  }

  // 4. Lines.
  const lines: BuiltLine[] = [];
  if (outcome === "priced") {
    for (const li of draft.line_items) {
      const code = li.rate_code.trim().toUpperCase();
      const rate = byCode.get(code);
      if (!rate) {
        flags.push({ level: "warn", message: `The AI used "${li.rate_code}", which isn't on your price list. That line was removed.` });
        continue;
      }
      if (rate.status !== "active" || rate.ratePence === null) {
        flags.push({
          level: "warn",
          message: `The AI picked ${rate.code} (${rate.description}), which is ${rate.status.replace("_", " ")}. That line was removed.`,
        });
        if (!exclusions.some((e) => e.request.toLowerCase().includes(rate.description.toLowerCase().slice(0, 12)))) {
          exclusions.push({
            request: rate.description,
            reason: rate.status === "not_offered" ? "not_offered" : "no_price",
            note: rate.importNotes.at(-1) ?? "No current price.",
          });
        }
        continue;
      }

      let qty = 0;
      let working = li.working;
      const mult = li.multiplier ?? 1;
      if (li.measurement_id) {
        const m = mById.get(li.measurement_id);
        if (!m || m.value === null) {
          flags.push({ level: "warn", message: `Couldn't work out the quantity for ${rate.code} (${rate.description}). Please fill it in.` });
        } else {
          qty = m.value * mult;
          if (mult === 1 && !COMPATIBLE[rate.unit]?.includes(m.unit)) {
            flags.push({
              level: "warn",
              message: `${rate.code} is priced per ${UNIT_LABEL[rate.unit]} but its quantity came from "${m.label}" in ${UNIT_LABEL[m.unit]}. Check it.`,
            });
          }
          if (m.certainty === "vague") {
            flags.push({ level: "warn", message: `${rate.code} uses a vague measurement ("${m.sourceText}"). Confirm before sending.` });
          }
          working = `${m.working}${mult !== 1 ? ` × ${mult}` : ""}${li.round_up ? ", rounded up" : ""}. ${li.working}`;
        }
      } else if (li.quantity !== null) {
        qty = li.quantity;
      } else {
        flags.push({ level: "warn", message: `No quantity for ${rate.code} (${rate.description}). Please fill it in.` });
      }
      if (li.round_up) qty = Math.ceil(qty - EPS);

      const chosen: RateAddon[] = [];
      for (const opt of li.options) {
        const o = opt.toLowerCase();
        const addon = rate.addons.find((a) => a.label.toLowerCase().includes(o) || o.includes(a.label.toLowerCase()));
        if (addon) chosen.push(addon);
        else flags.push({ level: "info", message: `Option "${opt}" isn't on your list for ${rate.code}; ignored.` });
      }
      const unitPrice = rate.ratePence + chosen.reduce((s, a) => s + a.amountPence, 0);
      const quantityMilli = toMilli(qty);

      rate.caveats.forEach((c) => conditions.add(`${rate.description}: ${c}`));
      if (rate.reviewFlag) flags.push({ level: "info", message: `${rate.code}: ${rate.reviewFlag}` });

      lines.push({
        position: lines.length,
        rateCode: rate.code,
        description: chosen.length ? `${rate.description} (+ ${chosen.map((a) => a.label).join(", ")})` : rate.description,
        unit: rate.unit,
        quantityMilli,
        unitPricePence: unitPrice,
        lineTotalPence: lineTotal(quantityMilli, unitPrice),
        source: "ai",
        working,
        assumption: li.assumption,
      });
    }
    if (!lines.length) {
      outcome = "cannot_quote";
      flags.push({ level: "warn", message: "Nothing on the price list could be used for this job, so there's no price." });
    }
  }

  if (outcome === "site_visit") {
    flags.push({ level: "info", message: "Needs a site visit. No price has been produced, by design." });
  }

  if (messageMentionsMoney(draft.customer_message)) {
    flags.push({ level: "warn", message: "The draft reply mentions money or a discount. Prices should only come from the table; check the wording." });
  }

  const totals = computeTotals(
    lines.map((l) => l.lineTotalPence),
    { minimumChargePence: ctx.settings.minimumChargePence, vatRateBps: ctx.settings.vatRateBps, priced: outcome === "priced" },
  );
  if (totals.minimumChargeAppliedPence > 0) {
    flags.push({ level: "info", message: `Minimum charge applied: the job came to ${formatGBP(totals.subtotalPence)}, below your ${formatGBP(ctx.settings.minimumChargePence)} minimum.` });
  }

  return {
    outcome,
    jobSummary: draft.job_summary,
    lines,
    totals,
    flags,
    details: {
      measurements,
      exclusions,
      conditions: [...conditions],
      questions: draft.questions_for_customer,
      assumptions: draft.assumptions,
      siteVisitReasons,
    },
    customerMessage: draft.customer_message,
  };
}
