import type { RateDecision } from "./rates";

/** Chase Landscapes (Gaz, Cannock): the second, made-up tenant. */
export const CHASE_RATE_DECISIONS: Record<string, RateDecision> = {
  LS06: { caveats: ["Hedges up to 2m high"] },
  LS03: { caveats: ["Concrete posts"] },
  LS10: { note: "Depends on the product chosen. Ask Gaz." },
  LS11: { status: "system", note: "Minimum charge. Applied by the pricing engine, never a line." },
};
