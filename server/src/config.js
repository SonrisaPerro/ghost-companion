// =============================================================================
// config.js — static configuration for the rotation resolver.
//
// IMPORTANT (Edge of Fate era): Nightfall and Trials no longer have a weekly
// "featured weapon" you can target, and the Bungie API doesn't expose one
// anywhere (verified: vendor sales, milestones, and activity rewards all lack
// it). So we DON'T try to resolve a weapon — we surface the activity pools (for
// auto-tracking runs) plus an accurate, static acquisition note per ritual.
//
// The ACTIVITY pools are the full set of activity hashes that count as a "run"
// for each ritual. ANY completion in the pool ticks the counter.
//
// Verify/refresh activity pools with:  npm run lookup -- --activities "Nightfall"
// =============================================================================

// Xûr is the one ritual-adjacent vendor whose stock IS targetable (you buy
// specific exotic armor from him), so we still read his live sales. The hash
// below is the offering with the "Exotic Weapons" sale category (verified via
// `npm run lookup -- --vendors "xur"`).
export const XUR_VENDOR_HASH = 2190858386 // Xûr — Agent of the Nine

// Per-ritual display label + accurate acquisition note (no weapon targeting).
export const RITUALS = {
  nightfall: {
    label: 'Nightfall',
    note: 'Random weapon drops — guaranteed to be one you have not collected yet until your set is complete, then purely random. Pre-Astyanax (non-tiered); a specific weapon cannot be targeted.'
  },
  trials: {
    label: 'Trials of Osiris',
    note: 'Targetable: focus weapons you have earned at least once at Saint-14 with Trials Engrams. Reach the Lighthouse (7 total wins) for its dedicated reward pool. A bonus focus pool also rotates weekly.'
  }
}

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
