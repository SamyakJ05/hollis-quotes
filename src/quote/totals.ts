import { vatOn } from "@/lib/money";

export type Totals = { subtotalPence: number; minimumChargeAppliedPence: number; vatPence: number; totalPence: number };

/**
 * Ex-VAT subtotal, then the minimum-charge top-up, then VAT on top.
 * Used for the AI's draft and again after every human edit, so the
 * minimum charge can't be forgotten on small jobs.
 */
export function computeTotals(lineTotals: number[], opts: { minimumChargePence: number; vatRateBps: number; priced: boolean }): Totals {
  if (!opts.priced) return { subtotalPence: 0, minimumChargeAppliedPence: 0, vatPence: 0, totalPence: 0 };
  const subtotal = lineTotals.reduce((s, n) => s + n, 0);
  const topUp = subtotal > 0 && subtotal < opts.minimumChargePence ? opts.minimumChargePence - subtotal : 0;
  const net = subtotal + topUp;
  const vat = vatOn(net, opts.vatRateBps);
  return { subtotalPence: subtotal, minimumChargeAppliedPence: topUp, vatPence: vat, totalPence: net + vat };
}
