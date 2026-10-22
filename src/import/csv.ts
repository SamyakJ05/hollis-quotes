import Papa from "papaparse";

/** Parses a CSV exported from Excel: strips the UTF-8 BOM, trims headers and cells. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  if (result.errors.length) {
    throw new Error(`CSV parse errors: ${result.errors.map((e) => `row ${e.row}: ${e.message}`).join("; ")}`);
  }
  return result.data;
}
