// =============================================================================
// xur.js — resolves Xûr's live weekly exotic stock.
//
// Edge of Fate reality: there's no targetable Nightfall/Trials featured weapon
// anymore (the API exposes none), so the old ritual rotation was removed. Xûr is
// the one ritual-adjacent vendor whose stock IS directly targetable — you buy
// specific exotic gear from him — so this is all that remains of the feature.
//
// Presence is authoritative, not inferred: getVendorState() reads the Vendors
// component's `enabled` flag and treats Bungie's 1627 (DestinyVendorNotFound) as
// a definitive "away". We only ever report present:true when we KNOW he's here.
//   - source 'live'     → we got an authoritative answer (present:true OR away)
//   - source 'fallback' → token/network failure; presence is UNKNOWN, never shown
// =============================================================================

import {
  refreshAccessToken,
  getPrimaryCharacter,
  getVendorState,
  getItemDef
} from './bungie.js'
import { XUR_VENDOR_HASHES, lastResetISO } from './config.js'
import { classifyGear, shapeItem } from './gear.js'

/**
 * Is Xûr physically in-world right now? He arrives at the Friday daily reset
 * (17:00 UTC) and departs at the Tuesday weekly reset (17:00 UTC), so he's gone
 * Tue 17:00 → Fri 17:00 (i.e. Tue-afternoon, all Wed, all Thu, Fri-morning).
 *
 * We need this because Bungie's Vendors `enabled` flag is NOT a reliable presence
 * signal during his absence window — it stays true and keeps serving his last
 * appearance's stock even though he isn't standing in the Tower. Resets are fixed
 * at 17:00 UTC year-round (DST-independent), so a UTC day/hour gate is exact.
 */
export function isXurInWindow(now = new Date()) {
  const day = now.getUTCDay() // 0 Sun … 6 Sat
  const hour = now.getUTCHours()
  switch (day) {
    case 6: // Sat
    case 0: // Sun
    case 1: // Mon
      return true
    case 5: // Fri — arrives at the 17:00 UTC daily reset
      return hour >= 17
    case 2: // Tue — departs at the 17:00 UTC weekly reset
      return hour < 17
    default: // Wed (3), Thu (4)
      return false
  }
}

/**
 * Reads Xûr's live state across all his vendor screens and splits out the exotic
 * weapons/armor he's selling. Presence comes from the Vendors `enabled` flag (via
 * getVendorState), NOT from "did any item come back". Exotic-only (engrams,
 * materials, catalysts, the Xûrfboard, and legendary gear are filtered out by
 * tier + classifyGear).
 *
 * Returns { present, determined, weapons, armor }:
 *   - present:    he's verified in town and selling
 *   - determined: at least one screen gave an authoritative answer (present/away);
 *                 false means every screen errored → caller treats as 'fallback'
 */
async function xurStock(accessToken, character) {
  const weapons = []
  const armor = []
  const seenSale = new Set() // dedupe sale hashes across vendor screens
  const seenItem = new Set() // dedupe items that appear on more than one screen
  let present = false
  let determined = false

  for (const vendorHash of XUR_VENDOR_HASHES) {
    let state
    try {
      state = await getVendorState(accessToken, character, vendorHash)
      determined = true // present OR away — either way we have an authoritative read
    } catch {
      continue // one screen faulting shouldn't blank an authoritative read from another
    }
    if (!state.present) continue // away/disabled screen contributes no stock
    present = true
    for (const h of state.saleHashes) {
      if (seenSale.has(h)) continue
      seenSale.add(h)
      let def
      try {
        def = await getItemDef(h)
      } catch {
        continue
      }
      if (def?.inventory?.tierTypeName !== 'Exotic') continue
      if (seenItem.has(def.hash)) continue
      seenItem.add(def.hash)
      const kind = classifyGear(def)
      if (kind === 'weapon') weapons.push(shapeItem(def))
      else if (kind === 'armor') armor.push(shapeItem(def))
    }
  }
  return { present, determined, weapons, armor }
}

export async function resolveXur() {
  const result = {
    weekOf: lastResetISO(),
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    // Xûr's weekly exotic stock. present is only ever true on an authoritative,
    // live read (source:'live'); on 'fallback' the UI must not assert presence.
    xur: { label: 'Xûr', location: 'The Tower (Hangar)', present: false, weapons: [], armor: [] }
  }

  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    const stock = await xurStock(access_token, character)
    // Presence requires BOTH an authoritative in-stock read AND his physical
    // schedule window — Bungie's `enabled` flag keeps serving last appearance's
    // stock after he's left (Tue 17:00 → Fri 17:00 UTC), so gate on the window too.
    result.xur = {
      ...result.xur,
      present: stock.present && isXurInWindow(),
      weapons: stock.weapons,
      armor: stock.armor
    }
    // 'live' only if we actually determined his state; otherwise stay 'fallback'
    // so the client treats presence as unknown rather than a confident "away".
    result.source = stock.determined ? 'live' : 'fallback'
  } catch (err) {
    result.error = err.message // token/network failure → presence stays unknown
  }

  return result
}
