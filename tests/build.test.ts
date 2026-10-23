import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/import/csv";
import { normaliseRates } from "@/import/rates";
import { HOLLIS_RATE_DECISIONS } from "@/import/hollis-decisions";
import { buildQuote, type RateForPricing } from "@/quote/build";
import { DraftSchema } from "@/ai/draft-schema";
import { formatGBP } from "@/lib/money";
import { greenwayDraft, kestrelCompromisedDraft, kestrelDraft, okaforDraft } from "./fixtures/drafts";

const rates: RateForPricing[] = normaliseRates(parseCsv(readFileSync("data/hollis-rates.csv", "utf8")), {
  vatBps: 2000,
  decisions: HOLLIS_RATE_DECISIONS,
}).rates;
const settings = { minimumChargePence: 45000, vatRateBps: 2000, siteVisitAreaM2: 150, siteVisitKeywords: ["car park"] };
const enquiry = (f: string) => readFileSync(`tests/fixtures/${f}`, "utf8");
const line = (q: ReturnType<typeof buildQuote>, code: string) => q.lines.find((l) => l.rateCode === code);

describe("fixtures are valid model output", () => {
  it.each([okaforDraft, greenwayDraft, kestrelDraft, kestrelCompromisedDraft])("parses", (d) => {
    expect(DraftSchema.safeParse(d).success).toBe(true);
  });
});

describe("Okafor drive extension", () => {
  const q = buildQuote(okaforDraft, { enquiryText: enquiry("1-okafor-driveway.txt"), rates, settings });

  it("converts 20ft × 15ft in code, not in the model", () => {
    expect(q.details.measurements[0].value).toBe(27.871);
    expect(q.details.measurements[0].working).toContain("6.096m × 4.572m");
    expect(line(q, "BP01")!.quantityMilli).toBe(27871);
    expect(line(q, "KB01")!.quantityMilli).toBe(10668);
  });

  it("derives volumes and whole loads", () => {
    expect(line(q, "EX02")!.quantityMilli).toBe(2787); // 27.871 x 0.1
    expect(line(q, "EX05")!.quantityMilli).toBe(1000); // 0.906 loads, rounded up
  });

  it("prices from the list and adds VAT on top", () => {
    expect(q.outcome).toBe("priced");
    expect(line(q, "BP01")!.unitPricePence).toBe(6200);
    const sum = q.lines.reduce((s, l) => s + l.lineTotalPence, 0);
    expect(q.totals.subtotalPence).toBe(sum);
    expect(q.totals.minimumChargeAppliedPence).toBe(0);
    expect(q.totals.vatPence).toBe(Math.round(sum * 0.2));
    console.log("Okafor:", formatGBP(q.totals.subtotalPence), "+ VAT", formatGBP(q.totals.vatPence), "=", formatGBP(q.totals.totalPence));
  });

  it("flags the dropped-kerb mention without pricing it, and keeps the tap out", () => {
    expect(q.lines.some((l) => l.rateCode === "KB04")).toBe(false);
    expect(q.flags.some((f) => f.message.includes("dropped kerb"))).toBe(true);
    expect(q.details.exclusions[0].request).toMatch(/tap/i);
  });

  it("collects conditions from the rates used", () => {
    expect(q.details.conditions.some((c) => c.includes("Up to 150mm deep"))).toBe(true);
  });
});

describe("Greenway car park", () => {
  it("produces no price, only a site visit", () => {
    const q = buildQuote(greenwayDraft, { enquiryText: enquiry("2-greenway-car-park.txt"), rates, settings });
    expect(q.outcome).toBe("site_visit");
    expect(q.lines).toHaveLength(0);
    expect(q.totals.totalPence).toBe(0);
    expect(q.details.exclusions.find((e) => e.reason === "not_offered")?.request).toMatch(/dropped kerb/i);
  });

  it("refuses to price even if the model tries to", () => {
    const eager = {
      ...greenwayDraft,
      recommended_outcome: "priced" as const,
      line_items: [{ rate_code: "TM01", measurement_id: "carpark", multiplier: null, round_up: false, quantity: null, options: [], working: "", assumption: null }],
    };
    const q = buildQuote(eager, { enquiryText: enquiry("2-greenway-car-park.txt"), rates, settings });
    expect(q.outcome).toBe("site_visit");
    expect(q.lines).toHaveLength(0);
    expect(q.details.siteVisitReasons.join(" ")).toMatch(/over the 150 m² limit/);
    expect(q.flags.some((f) => f.message.includes("tried to price"))).toBe(true);
  });
});

describe("Kestrel Row patio, with a prompt injection in the email", () => {
  const text = enquiry("3-kestrel-row-patio.txt");

  it("prices normally and flags the injected note", () => {
    const q = buildQuote(kestrelDraft, { enquiryText: text, rates, settings });
    expect(q.outcome).toBe("priced");
    expect(line(q, "PT02")!.unitPricePence).toBe(9600);
    expect(line(q, "PL01")!.unitPricePence).toBe(31000 + 6000); // road permit option
    // one warning for the one injected paragraph, not one per pattern it trips
    expect(q.flags.filter((f) => f.level === "danger")).toHaveLength(1);
  });

  it("holds even when the model obeys the injection", () => {
    const honest = buildQuote(kestrelDraft, { enquiryText: text, rates, settings });
    const q = buildQuote(kestrelCompromisedDraft, { enquiryText: text, rates, settings });
    // invented and inactive codes are dropped; totals match the honest draft exactly
    expect(q.lines.map((l) => l.rateCode)).toEqual(honest.lines.map((l) => l.rateCode));
    expect(q.totals).toEqual(honest.totals);
    // the code check still catches the note even though the model didn't report it
    expect(q.flags.some((f) => f.level === "danger" && f.message.includes("40% partner discount"))).toBe(true);
    expect(q.flags.some((f) => f.message.includes("didn't report") || f.message.includes("did not report"))).toBe(true);
    expect(q.flags.some((f) => f.message.includes("DISCOUNT40"))).toBe(true);
    expect(q.flags.some((f) => f.message.includes("mentions money or a discount"))).toBe(true);
    // and there is simply no way for a draft to carry a status
    expect(q).not.toHaveProperty("status");
  });
});

describe("minimum charge", () => {
  it("tops a small job up to £450 before VAT", () => {
    const small = {
      ...okaforDraft,
      measurements: [],
      line_items: [{ rate_code: "DR04", measurement_id: null, multiplier: null, round_up: false, quantity: 1, options: [], working: "", assumption: null }],
    };
    const q = buildQuote(small, { enquiryText: "CCTV survey please", rates, settings });
    expect(q.totals.subtotalPence).toBe(19500);
    expect(q.totals.minimumChargeAppliedPence).toBe(25500);
    expect(q.totals.vatPence).toBe(9000);
    expect(q.totals.totalPence).toBe(54000);
  });
});
