import type { Unit } from "@/db/schema";

const UNIT_ALIASES: Record<string, Unit> = {
  m2: "m2", "m²": "m2", sqm: "m2", "sq m": "m2", "square metre": "m2", "square metres": "m2",
  m3: "m3", "m³": "m3", "cu m": "m3",
  "lin m": "lin_m", "lin. m": "lin_m", m: "lin_m", "linear m": "lin_m", "linear metre": "lin_m", lm: "lin_m",
  each: "each", ea: "each", no: "each", item: "each",
  load: "load",
  tonne: "tonne", "per tonne": "tonne", t: "tonne",
  day: "day", "per day": "day",
  job: "job",
};

export function normaliseUnit(raw: string): Unit | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return UNIT_ALIASES[key] ?? null;
}

export const UNIT_LABEL: Record<Unit, string> = {
  m2: "m²", m3: "m³", lin_m: "lin m", each: "each", load: "load", tonne: "tonne", day: "day", job: "job",
};

/** Length conversions done in code, never by the model. */
export const LENGTH_TO_METRES = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
  yd: 0.9144,
} as const;
export type LengthUnit = keyof typeof LENGTH_TO_METRES;

export function toMetres(value: number, unit: LengthUnit): number {
  return value * LENGTH_TO_METRES[unit];
}
