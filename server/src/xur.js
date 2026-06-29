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
    xur: { label: 'Xûr', location: 'The Tower (near Ikora)', present: false, weapons: [], armor: [] }
  }

  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    const stock = await xurStock(access_token, character)
    result.xur = {
      ...result.xur,
      present: stock.present,
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
