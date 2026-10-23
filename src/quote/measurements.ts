/** Turns the customer's measurements (in whatever units they used) into metric quantities. */
import type { Measurement } from "@/ai/draft-schema";
import { toMetres } from "@/lib/units";

export type ResolvedMeasurement = {
  id: string;
  label: string;
  sourceText: string;
  certainty: Measurement["certainty"];
  unit: "m2" | "lin_m" | "m3" | "each";
  value: number | null; // null when it couldn't be worked out
  working: string;
};

const SQFT = 0.09290304;
const SQYD = 0.83612736;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const show = (l: { value: number; unit: string }) => `${l.value}${l.unit}`;

export function resolveMeasurement(m: Measurement): ResolvedMeasurement {
  const base = { id: m.id, label: m.label, sourceText: m.source_text, certainty: m.certainty };
  switch (m.kind) {
    case "area": {
      if (m.length && m.width) {
        const a = toMetres(m.length.value, m.length.unit);
        const b = toMetres(m.width.value, m.width.unit);
        const v = r3(a * b);
        const conv = m.length.unit === "m" && m.width.unit === "m" ? "" : ` = ${r3(a)}m × ${r3(b)}m`;
        return { ...base, unit: "m2", value: v, working: `${show(m.length)} × ${show(m.width)}${conv} = ${v} m²` };
      }
      if (m.stated_area) {
        const f = m.stated_area.unit === "m2" ? 1 : m.stated_area.unit === "ft2" ? SQFT : SQYD;
        const v = r3(m.stated_area.value * f);
        return { ...base, unit: "m2", value: v, working: `${m.stated_area.value} ${m.stated_area.unit} = ${v} m²` };
      }
      return { ...base, unit: "m2", value: null, working: "No dimensions given" };
    }
    case "length": {
      const parts = m.parts.length ? m.parts : m.length ? [m.length] : [];
      if (!parts.length) return { ...base, unit: "lin_m", value: null, working: "No length given" };
      const v = r3(parts.reduce((s, p) => s + toMetres(p.value, p.unit), 0));
      return { ...base, unit: "lin_m", value: v, working: `${parts.map(show).join(" + ")} = ${v} m` };
    }
    case "volume":
      return m.stated_volume_m3
        ? { ...base, unit: "m3", value: m.stated_volume_m3, working: `${m.stated_volume_m3} m³` }
        : { ...base, unit: "m3", value: null, working: "No volume given" };
    case "count":
      return m.count
        ? { ...base, unit: "each", value: m.count, working: `${m.count}` }
        : { ...base, unit: "each", value: null, working: "No count given" };
  }
}

/** Which measurement units a rate unit can take directly (multiplier 1). */
export const COMPATIBLE: Record<string, ResolvedMeasurement["unit"][]> = {
  m2: ["m2"],
  lin_m: ["lin_m"],
  m3: ["m3"],
  each: ["each"],
};
