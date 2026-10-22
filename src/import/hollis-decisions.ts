/**
 * Judgement calls on Hollis Groundworks' price list (02-rates.csv).
 * Each one has a reason. These are assumptions until Shaz confirms them,
 * and the Rates page shows every one of them.
 */
import type { RateDecision } from "./rates";

export const HOLLIS_RATE_DECISIONS: Record<string, RateDecision> = {
  EX01: { caveats: ["Up to 150mm deep"] },
  EX04: { caveats: ["Concrete up to 150mm thick", "Breaker hire included"] },
  EX05: { caveats: ["Approx 10m³ loose / 16t per load"] },
  EX06: { supersededBy: "EX05", note: "Replaced by EX05 (muck away per load), as the sheet says." },
  SB02: {
    status: "superseded",
    supersededBy: "SB03",
    note: "Same item as SB03. SB03 is marked as the March price, so SB02 (£38) is the old one.",
  },
  SB03: { note: "Marked 'new price from March'." },
  BP01: {
    addons: [{ label: "Herringbone pattern", amountPence: 400, per: "unit" }],
    caveats: ["Charcoal or brindle"],
  },
  BP02: { supersededBy: "BP01", note: "Replaced by BP01 (£62), as the sheet says 'old price'." },
  BP04: {
    status: "included",
    note: "Sheet says 'usually included in BP01??'. Treated as included in BP01, so not charged separately. Confirm whether it's chargeable on lay-only (BP03) jobs.",
  },
  KB02: {
    status: "needs_review",
    note: "Same item as KB01 but £26 with no spec. Probably the pre-March price. Not used until confirmed; KB01 (£28) is used.",
  },
  KB04: {
    status: "not_offered",
    note: "Council-approved contractors only. Hollis doesn't do dropped kerbs; the customer should go to the council.",
  },
  TM02: { caveats: ["Existing base must be sound"] },
  TM03: { note: "Supplier price keeps changing. Ask Dave." },
  CO02: {
    status: "needs_review",
    note: "Price '£1,250' with note 'think this is per load not per m3?? check'. The unit is in doubt, so it isn't used until confirmed.",
  },
  DR03: { caveats: ["Subject to percolation test"] },
  PL01: {
    addons: [{ label: "Road permit (skip on the road)", amountPence: 6000, per: "item" }],
    caveats: ["Needs a permit if the skip goes on the road"],
  },
  MI01: {
    status: "system",
    note: "Minimum charge. Applied by the pricing engine to any job under £450, never added as a line by the AI.",
  },
  MI02: {
    reviewFlag:
      "Sheet asks 'same as SB04?'. Kept separate: weed membrane for landscaping vs geotextile under sub-base (SB04). Confirm.",
  },
};
