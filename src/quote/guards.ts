/**
 * Checks that run on the raw enquiry text in code, whatever the model said.
 * They can only make a quote MORE cautious (flag it, force a site visit),
 * never less.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /\b(note|instructions?|message)\s+(for|to)\s+(any\s+)?(automated|ai|artificial intelligence)\b[^\n]*/i,
  /\b(automated|ai)\s+(quoting\s+)?(assistant|system|agent|model)s?\b[^\n]*/i,
  /\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?)\b[^\n]*/i,
  /\b(apply|give|add)\s+(a\s+)?\d{1,3}\s?%\s+(partner\s+|trade\s+)?discount\b[^\n]*/i,
  /\b(waive|remove|skip)\s+(the\s+|any\s+)?minimum\s+charge\b[^\n]*/i,
  /\bmark\s+(this|the)\s+quote\s+as\s+approved\b[^\n]*/i,
  /\b(do\s+not|don't)\s+mention\s+this\b[^\n]*/i,
  /\b(system\s+prompt|you\s+are\s+now\s+(a|an|in))\b[^\n]*/i,
];

/**
 * Returns each paragraph of the enquiry that contains an instruction aimed
 * at an automated system, once, however many patterns it trips.
 */
export function detectInjection(text: string): string[] {
  const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .filter((p) => INJECTION_PATTERNS.some((re) => re.test(p)))
    .map((p) => (p.length > 400 ? `${p.slice(0, 400)}…` : p));
}

/** Keywords from "not offered" rates, e.g. "Dropped kerb / vehicle crossover". */
export function notOfferedMentions(text: string, notOffered: { code: string; description: string }[]) {
  const lower = text.toLowerCase();
  const out: { code: string; keyword: string }[] = [];
  for (const r of notOffered) {
    for (const kw of r.description.toLowerCase().split("/").map((s) => s.trim()).filter((s) => s.length > 3)) {
      if (lower.includes(kw)) out.push({ code: r.code, keyword: kw });
    }
  }
  return out;
}

export function siteVisitKeywordHits(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k.toLowerCase()));
}

/** The covering note must not carry money. Prices only come from the priced table. */
export function messageMentionsMoney(message: string): boolean {
  return /£\s?\d|\d+\s?(pounds|quid)\b|\bdiscount\b|\d+\s?%/i.test(message);
}
