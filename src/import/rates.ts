/**
 * Rates import.
 *
 * Two layers, deliberately separate:
 *  1. Mechanical clean-up, done generically for any company's sheet:
 *     BOM, unit spellings (m2 / sqm / m²), "£1,250", "TBC", "inc VAT" prices,
 *     rows marked "old", "+£" options hiding in the notes column.
 *  2. Judgement calls (which duplicate wins, what is not offered, what needs
 *     a human) live in a per-company decisions file, one reason per row,
 *     so Shaz can read and confirm them. Nothing is silently dropped.
 *
 * Only rates with status "active" are ever shown to the AI.
 */
import type { RateAddon, RateStatus, Unit } from "@/db/schema";
import { exVat, formatGBP, parsePounds } from "@/lib/money";
import { normaliseUnit } from "@/lib/units";

export type RateDecision = {
  status?: RateStatus;
  supersededBy?: string;
  reviewFlag?: string;
  addons?: RateAddon[];
  caveats?: string[];
  note?: string;
};

export type NormalisedRate = {
  code: string;
  description: string;
  unit: Unit;
  ratePence: number | null;
  status: RateStatus;
  supersededBy: string | null;
  addons: RateAddon[];
  caveats: string[];
  reviewFlag: string | null;
  priceEnteredIncVat: boolean;
  original: Record<string, string>;
  importNotes: string[];
};

export type RatesImportResult = {
  rates: NormalisedRate[];
  minimumChargePence: number | null;
  problems: string[];
};

export function normaliseRates(
  rows: Record<string, string>[],
  opts: { vatBps: number; decisions?: Record<string, RateDecision> },
): RatesImportResult {
  const decisions = opts.decisions ?? {};
  const problems: string[] = [];
  const seen = new Set<string>();
  const out: NormalisedRate[] = [];

  for (const row of rows) {
    const code = (row.Code ?? "").trim().toUpperCase();
    if (!code) {
      problems.push(`Skipped a row with no code: ${JSON.stringify(row)}`);
      continue;
    }
    if (seen.has(code)) {
      problems.push(`Duplicate code ${code} — second occurrence ignored`);
      continue;
    }
    seen.add(code);

    const notesRaw = (row.Notes ?? "").trim();
    const notes = notesRaw.toLowerCase();
    const importNotes: string[] = [];
    let status: RateStatus = "active";
    let reviewFlag: string | null = null;

    // Unit
    let unit = normaliseUnit(row.Unit ?? "");
    if (!unit) {
      importNotes.push(`Unrecognised unit "${row.Unit}" — set to "each" and held for review`);
      unit = "each";
      status = "needs_review";
    } else if ((row.Unit ?? "").trim() !== unit) {
      importNotes.push(`Unit "${row.Unit}" normalised to ${unit}`);
    }

    // Price
    const rawRate = (row.Rate ?? "").trim();
    let ratePence: number | null = null;
    let priceEnteredIncVat = false;
    if (/^tbc$/i.test(rawRate) || rawRate === "") {
      importNotes.push(`No price in sheet ("${rawRate || "blank"}")`);
      status = "needs_review";
    } else {
      ratePence = parsePounds(rawRate);
      if (ratePence === null) {
        importNotes.push(`Could not read price "${rawRate}"`);
        status = "needs_review";
      } else if (/[£,]/.test(rawRate)) {
        importNotes.push(`Price "${rawRate}" read as ${formatGBP(ratePence)}`);
      }
    }

    if (ratePence !== null && /\binc(l|luding)?\.?\s*vat\b/.test(notes)) {
      const inc = ratePence;
      ratePence = exVat(inc, opts.vatBps);
      priceEnteredIncVat = true;
      reviewFlag = `Entered as ${formatGBP(inc)} inc VAT; converted to ${formatGBP(ratePence)} ex VAT. Please confirm.`;
      importNotes.push(reviewFlag);
    }

    if (/\bold\b/.test(notes)) {
      status = "superseded";
      importNotes.push(`Sheet marks this as old ("${notesRaw}")`);
    }

    if (/\+£/.test(notesRaw) && !decisions[code]?.addons) {
      problems.push(`${code}: notes contain a "+£" option but no add-on was mapped: "${notesRaw}"`);
    }

    const d = decisions[code];
    if (d) {
      if (d.status) status = d.status;
      if (d.reviewFlag) reviewFlag = d.reviewFlag;
      if (d.note) importNotes.push(d.note);
    }

    out.push({
      code,
      description: (row.Item ?? "").trim(),
      unit,
      ratePence,
      status,
      supersededBy: d?.supersededBy ?? null,
      addons: d?.addons ?? [],
      caveats: d?.caveats ?? [],
      reviewFlag,
      priceEnteredIncVat,
      original: { ...row },
      importNotes,
    });
  }

  // Integrity: every superseded row must point at an active replacement.
  const byCode = new Map(out.map((r) => [r.code, r]));
  for (const r of out) {
    if (r.status === "superseded") {
      const repl = r.supersededBy ? byCode.get(r.supersededBy) : undefined;
      if (!repl) problems.push(`${r.code} is superseded but no replacement is recorded`);
      else if (repl.status !== "active") problems.push(`${r.code} is superseded by ${repl.code}, which is not active`);
    }
    if (r.status === "active" && r.ratePence === null) {
      problems.push(`${r.code} is active but has no price`);
    }
  }

  const minimum = out.find((r) => r.status === "system" && /minimum/i.test(r.description));
  return { rates: out, minimumChargePence: minimum?.ratePence ?? null, problems };
}
