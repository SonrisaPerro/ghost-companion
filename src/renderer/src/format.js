// =============================================================================
// format.js — tiny presentation helpers for currency costs, shared by the
// Eververse vendor panel and the ornament tracker. Extracted from
// GhostCompanion.jsx so both consumers reference one source.
// =============================================================================

import { C } from "./theme";

// A cost line's currency `kind` → colour. Bright Dust is grindable (blue),
// Silver is real money (gold), Glimmer is trivial (green).
export function costColor(kind) {
  return kind === "silver" ? C.gold : kind === "glimmer" ? C.green : C.blue;
}

export function formatQty(n) {
  return typeof n === "number" ? n.toLocaleString() : n;
}
