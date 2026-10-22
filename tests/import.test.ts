import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/import/csv";
import { normaliseRates } from "@/import/rates";
import { normaliseCustomers } from "@/import/customers";
import { HOLLIS_RATE_DECISIONS } from "@/import/hollis-decisions";

const rates = normaliseRates(parseCsv(readFileSync("data/hollis-rates.csv", "utf8")), {
  vatBps: 2000,
  decisions: HOLLIS_RATE_DECISIONS,
});
const byCode = Object.fromEntries(rates.rates.map((r) => [r.code, r]));

describe("Hollis rates import", () => {
  it("reads every row, BOM and all, with no unresolved problems", () => {
    expect(rates.rates).toHaveLength(40);
    expect(rates.problems).toEqual([]);
    expect(byCode.EX01).toBeDefined(); // would be "﻿Code" without BOM stripping
  });

  it("normalises unit spellings", () => {
    expect(byCode.EX03.unit).toBe("m2"); // sqm
    expect(byCode.EX04.unit).toBe("m2"); // m²
    expect(byCode.KB01.unit).toBe("lin_m"); // lin m
    expect(byCode.EX06.unit).toBe("tonne"); // per tonne
  });

  it("converts the inc-VAT patio price to ex-VAT and flags it", () => {
    expect(byCode.PT01.ratePence).toBe(7083);
    expect(byCode.PT01.priceEnteredIncVat).toBe(true);
    expect(byCode.PT01.reviewFlag).toMatch(/inc VAT/);
    expect(byCode.PT01.status).toBe("active");
  });

  it("retires old duplicates in favour of current prices", () => {
    expect(byCode.SB02).toMatchObject({ status: "superseded", supersededBy: "SB03" });
    expect(byCode.BP02).toMatchObject({ status: "superseded", supersededBy: "BP01" });
    expect(byCode.EX06).toMatchObject({ status: "superseded", supersededBy: "EX05" });
    expect(byCode.SB03).toMatchObject({ status: "active", ratePence: 4100 });
  });

  it("never makes a price up for TBC or doubtful rows", () => {
    expect(byCode.TM03).toMatchObject({ status: "needs_review", ratePence: null });
    expect(byCode.KB04).toMatchObject({ status: "not_offered", ratePence: null });
    expect(byCode.CO02.status).toBe("needs_review");
    expect(byCode.CO02.ratePence).toBe(125000); // "£1,250" parsed, but unusable until the unit is confirmed
    expect(byCode.KB02.status).toBe("needs_review");
  });

  it("pulls price options out of the notes column", () => {
    expect(byCode.BP01.addons).toEqual([{ label: "Herringbone pattern", amountPence: 400, per: "unit" }]);
    expect(byCode.PL01.addons[0]).toMatchObject({ amountPence: 6000, per: "item" });
  });

  it("treats the minimum charge as a system rule, not a line item", () => {
    expect(byCode.MI01.status).toBe("system");
    expect(rates.minimumChargePence).toBe(45000);
  });

  it("keeps the original spreadsheet row for audit", () => {
    expect(byCode.CO02.original.Rate).toBe("£1,250");
  });
});

describe("Hollis customers import", () => {
  const customers = normaliseCustomers(parseCsv(readFileSync("data/hollis-customers.csv", "utf8")));
  const find = (s: string) => customers.find((c) => c.displayName.includes(s) || c.companyName?.includes(s))!;

  it("merges 13 rows into 9 customers", () => {
    expect(customers).toHaveLength(9);
  });

  it("merges both Okafor rows so her new email finds last year's job", () => {
    const c = find("Okafor");
    expect(c.displayName).toBe("Patience Okafor");
    expect(c.contacts.map((x) => x.email).sort()).toEqual(["p.okafor@example.com", "patience.okafor64@example.com"]);
    expect(c.internalNotes).toContain("front drive block paving 2025");
    expect(c.postcode).toBe("WS5 3PL");
  });

  it("treats accounts@kestrelrow as a billing contact, not a separate customer", () => {
    const c = find("Kestrel Row");
    expect(c.companyName).toBe("Kestrel Row Lettings");
    expect(c.billingEmail).toBe("accounts@kestrelrow.example");
    expect(c.paymentTerms).toBe("30 days");
    expect(c.contacts.find((x) => x.role === "primary")?.email).toBe("marcus@kestrelrow.example");
  });

  it("merges the Sandhu and Doyle duplicates and drops the 'DUPLICATE?' note", () => {
    expect(find("Sandhu").displayName).toBe("Jaswinder Sandhu");
    expect(find("Sandhu").internalNotes).toBeNull();
    const doyle = find("Doyle");
    expect(doyle.displayName).toBe("Kevin Doyle");
    expect(doyle.contacts).toHaveLength(1);
    expect(doyle.internalNotes).toBe("side return concrete");
  });

  it("records why each merge happened", () => {
    expect(find("Okafor").importNotes[0]).toMatch(/same address/);
    expect(find("Doyle").importNotes[0]).toMatch(/same phone/);
  });
});
