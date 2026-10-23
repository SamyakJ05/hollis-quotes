/** "27.871" -> 27871 (thousandths). Exact, no floats. Null if not a plain non-negative number. */
export function parseQuantityMilli(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * 1000 + Number(f.padEnd(3, "0"));
}

export function formatQuantity(milli: number): string {
  const s = (milli / 1000).toFixed(3);
  return s.replace(/\.?0+$/, "");
}

export function penceToPoundsInput(pence: number): string {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, "0")}`;
}
