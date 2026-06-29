// =============================================================================
// config.js — static configuration for the Xûr resolver.
//
// IMPORTANT (Edge of Fate era): the old Nightfall/Trials "featured weapon"
// rotation is gone — there's no targetable weekly weapon and the Bungie API
// exposes none (verified: vendor sales, milestones, and activity rewards all
// lack it). That whole feature was removed. What remains is the one
// ritual-adjacent vendor whose stock IS targetable: Xûr.
//
// Xûr sells specific exotic gear you can go buy, so we read his LIVE inventory.
// His stock is split across multiple vendor "screens": the main offering carries
// exotic armor + the Xûrfboard + an exotic engram, while "Strange Gear Offers"
// carries his rotating exotic AND legendary WEAPONS (e.g. Hawkmoon). We read both
// and merge. Verified via the live vendor dumps + `npm run lookup -- --vendors "nine"`.
// =============================================================================

export const XUR_VENDOR_HASH = 2190858386 // Xûr — Agent of the Nine (main screen)
export const XUR_VENDOR_HASHES = [
  2190858386, // main: exotic armor, Xûrfboard, exotic engram
  3751514131 // "Strange Gear Offers": exotic + legendary weapons, legendary armor set
]

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
