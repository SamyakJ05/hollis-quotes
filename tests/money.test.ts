import { describe, expect, it } from "vitest";
import { exVat, formatGBP, lineTotal, parsePounds, vatOn } from "@/lib/money";

describe("money", () => {
  it("parses messy pound strings exactly", () => {
    expect(parsePounds("£1,250")).toBe(125000);
    expect(parsePounds("18.40")).toBe(1840);
    expect(parsePounds("14.5")).toBe(1450);
    expect(parsePounds("TBC")).toBeNull();
  });
  it("does VAT in integer pence", () => {
    expect(exVat(8500, 2000)).toBe(7083);
    expect(vatOn(345678, 2000)).toBe(69136);
  });
  it("multiplies quantity thousandths by pence without float drift", () => {
    expect(lineTotal(27871, 6200)).toBe(172800); // 27.871 m2 x £62 = £1,728.00 (1728.002 rounded)
    expect(lineTotal(100, 1)).toBe(0);
  });
  it("formats", () => {
    expect(formatGBP(345012)).toBe("£3,450.12");
  });
});
