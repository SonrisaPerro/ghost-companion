// =============================================================================
// banshee.js — resolves Banshee-44's live weapon stock (Stage 3).
//
// Banshee-44 is a permanent Tower vendor, but his WEAPON offerings include a
// weekly-rotating set of legendary weapons you can buy outright — a targetable
// "just go grab this" item for the concierge, in the same spirit as Xûr's exotics.
//
// Reuses the verified vendor-read path (getVendorSales → per-item defs → gear.js
// classify/shape), identical to the Xûr/Monument resolvers. Requires the server's
// confidential service-account token (vendor sales are a per-character read).
//   - source 'live'     → authoritative read of his sales
//   - source 'fallback' → token/network failure; stock unknown, never asserted
// =============================================================================

import { refreshAccessToken, getPrimaryCharacter, getVendorSales, getItemDef } from './bungie.js'
import { BANSHEE_VENDOR_HASH, lastResetISO } from './config.js'
import { classifyGear, shapeItem } from './gear.js'

// Tiers worth surfacing as targetable weapons (skip commons/uncommons/blues and
// the non-weapon clutter Banshee also sells: mods, materials, engrams, upgrades).
const KEEP_TIERS = new Set(['Legendary', 'Exotic'])

export async function resolveBanshee() {
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    label: 'Banshee-44',
    location: 'The Tower (Courtyard)',
    present: false,
    weapons: []
  }

  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    const state = await getVendorSales(access_token, character, BANSHEE_VENDOR_HASH)

    // getVendorSales returned → we have an authoritative read (present or away).
    result.present = state.present
    result.source = 'live'

    const seen = new Set()
    for (const s of state.sales) {
      if (seen.has(s.itemHash)) continue
      seen.add(s.itemHash)
      let def
      try {
        def = await getItemDef(s.itemHash)
      } catch {
        continue
      }
      const tier = def?.inventory?.tierTypeName
      if (!KEEP_TIERS.has(tier)) continue
      if (classifyGear(def) !== 'weapon') continue
      result.weapons.push({ ...shapeItem(def), tier })
    }

    // Stable, readable ordering: exotics first, then alphabetical.
    result.weapons.sort(
      (a, b) => (a.tier === b.tier ? a.name.localeCompare(b.name) : a.tier === 'Exotic' ? -1 : 1)
    )
  } catch (err) {
    result.error = err.message // token/network failure → stock stays unknown
  }

  result.weekOf = lastResetISO()
  return result
}
