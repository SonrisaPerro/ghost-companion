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

// Monument to Lost Lights — Exotic Archive (the Tower kiosk that sells legacy
// raid/quest exotics for materials). Always present (not time-gated), but the
// catalog shifts as old content is added/retired, so we read it live to verify.
// Hash confirmed from the live Manifest 2026-06-29 (`lookup --vendors monument`).
export const MONUMENT_VENDOR_HASH = 4230408743

// Eververse (Tess Everis) — the Tower store where weapon/armor ornaments and other
// cosmetics rotate in and out for Bright Dust (grindable) or Silver (real money).
// The Manifest exposes THREE Tess "screens" (featured / Bright Dust / Silver), so
// we read all of them and merge the sales. Hashes confirmed from the live Manifest
// 2026-06-29 (`npm run lookup -- --vendors "tess"`). We read these live to answer
// "is this ornament buyable right now, and for how much" — availability rotates and
// isn't otherwise queryable from the Manifest.
export const EVERVERSE_VENDOR_HASHES = [3361454721, 3790213143, 788270413]

// Banshee-44 — Gunsmith (Tower). His weapon stock includes a weekly-rotating set
// of legendary weapons you can just buy — a genuinely targetable "go grab this"
// concierge item. Hash confirmed offline from the live Manifest's
// DestinyVendorDefinition (the `enabled:true` Banshee row) via probe-vendors.mjs;
// the other Banshee rows (4161623890 / 307884248) are disabled legacy/quest vendors.
export const BANSHEE_VENDOR_HASH = 672118013

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
