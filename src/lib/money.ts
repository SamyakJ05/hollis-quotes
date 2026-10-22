/** All money is integer pence. All quantities are integer thousandths. */

export function parsePounds(raw: string): number | null {
  const cleaned = raw.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Banker-free, plain half-up rounding of a rational pence amount. */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Converts a VAT-inclusive pence price to ex-VAT pence. vatBps = 2000 for 20%. */
export function exVat(incPence: number, vatBps: number): number {
  return roundHalfUp(incPence * 10000, 10000 + vatBps);
}

export function vatOn(netPence: number, vatBps: number): number {
  return roundHalfUp(netPence * vatBps, 10000);
}

/** quantity (thousandths) x unit price (pence) -> pence, rounded half-up. */
export function lineTotal(quantityMilli: number, unitPricePence: number): number {
  return roundHalfUp(quantityMilli * unitPricePence, 1000);
}

export function formatGBP(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
}

export function toMilli(n: number): number {
  return Math.round(n * 1000);
}

export function fromMilli(m: number): number {
  return m / 1000;
}
