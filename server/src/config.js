// =============================================================================
// config.js — static configuration for the rotation resolver.
//
// The ACTIVITY pools are the full set of activity hashes that count as a "run"
// for each ritual. They rarely change, so we embed them: even though the GM map
// and the featured weapon rotate weekly, ANY completion in the pool should tick
// the counter. This is also what lets the resolver degrade gracefully — if the
// vendor lookup fails we still serve correct activity pools (Approach A) with a
// null weapon ("check the in-game vendor").
//
// Verify/refresh these with:  npm run lookup -- --activities "Nightfall"
//                             npm run lookup -- --vendors "Commander Zavala"
// =============================================================================

// Vendors that sell the current featured weapon (component 402 = sales).
export const VENDORS = {
  nightfall: { vendorHash: 69482069, label: 'Grandmaster Nightfall' }, // Commander Zavala
  trials: { vendorHash: 765357505, label: 'Trials of Osiris' } //         Saint-14
}

// Xûr is handled separately: he's a vendor whose weekly stock IS the loot (you
// buy it, there's no activity to run), and he isn't always present. The hash
// below is the offering with the "Exotic Weapons" sale category (verified via
// `npm run lookup -- --vendors "xur"`).
export const XUR_VENDOR_HASH = 2190858386 // Xûr — Agent of the Nine

// Activity-hash pools (verified against Manifest 244164.*).
export const ACTIVITY_POOLS = {
  // Nightfall: The Ordeal (Master/Grandmaster) rotation + Strange Terrain.
  nightfall: [
    3265488365, 3849697861, 3883876600, 68611399, 135872559, 245243711, 380956400,
    766116577, 887176537, 1302909042, 1358381373, 1801803630, 13813394
  ],
  // Trials of Osiris (incl. Matchmade).
  trials: [3148168425, 3720296444, 4150051058, 588019350, 1114325415, 1166905690, 2723561970]
}

/**
 * Optional manual override, supplied as env ROTATION_OVERRIDE_JSON, e.g.
 *   {"nightfall":4289226715,"trials":2362652544}
 * Used when the vendor heuristic is wrong for a given week (the open-source
 * "community can correct it" lever). Returns { nightfall?, trials? } or null.
 */
export function parseOverride() {
  const raw = process.env.ROTATION_OVERRIDE_JSON
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return {
      nightfall: o.nightfall ? Number(o.nightfall) : undefined,
      trials: o.trials ? Number(o.trials) : undefined
    }
  } catch {
    return null
  }
}

/** ISO timestamp of the most recent weekly reset (Tuesday 17:00 UTC). */
export function lastResetISO(now = new Date()) {
  const d = new Date(now)
  d.setUTCHours(17, 0, 0, 0)
  // Day 2 = Tuesday. Walk back to the most recent Tuesday 17:00 UTC.
  while (d.getUTCDay() !== 2 || d > now) {
    d.setUTCDate(d.getUTCDate() - 1)
    d.setUTCHours(17, 0, 0, 0)
  }
  return d.toISOString()
}
