// =============================================================================
// rotation.js — resolves this week's ritual data.
//
// Edge of Fate reality: there is no targetable "featured weapon" for Nightfall
// or Trials (and the API exposes none). So we return:
//   - activity pools (so completions auto-track as runs), per ritual
//   - an accurate static acquisition note, per ritual
//   - Xûr's live exotic stock (his armor IS directly targetable)
//
// Graceful degradation: if the Xûr lookup fails (no token / he's away) we still
// return the ritual pools + notes, with source 'fallback'.
// =============================================================================

import {
  refreshAccessToken,
  getPrimaryCharacter,
  getVendorSaleHashes,
  getItemDef
} from './bungie.js'
import { XUR_VENDOR_HASH, RITUALS, ACTIVITY_POOLS, lastResetISO } from './config.js'

const BUNGIE = 'https://www.bungie.net'
const WEAPON_CATEGORY = 1 // DestinyItemCategory.Weapon
const ARMOR_CATEGORY = 20 // DestinyItemCategory.Armor

function shapeItem(def) {
  if (!def) return null
  return {
    itemHash: def.hash,
    name: def.displayProperties?.name || '',
    icon: def.displayProperties?.icon ? `${BUNGIE}${def.displayProperties.icon}` : null,
    type: def.itemTypeDisplayName || ''
  }
}

/** Reads Xûr's current stock and splits the exotic weapons/armor he's selling.
 *  Classifies by itemCategoryHashes (not itemType) so exotic class items — the
 *  Hunter cloak / Warlock bond / Titan mark, which report itemType 0 — still
 *  count as armor. Empty (present:false) when he's away or the lookup fails. */
async function xurStock(accessToken, character) {
  const hashes = await getVendorSaleHashes(accessToken, character, XUR_VENDOR_HASH)
  const weapons = []
  const armor = []
  const seen = new Set()
  for (const h of hashes) {
    if (seen.has(h)) continue
    seen.add(h)
    let def
    try {
      def = await getItemDef(h)
    } catch {
      continue
    }
    if (def?.inventory?.tierTypeName !== 'Exotic') continue
    const cats = def.itemCategoryHashes || []
    if (cats.includes(WEAPON_CATEGORY)) weapons.push(shapeItem(def))
    else if (cats.includes(ARMOR_CATEGORY)) armor.push(shapeItem(def))
  }
  return { present: hashes.length > 0, weapons, armor }
}

// TEMP DEBUG: dump every Xûr sale item with its tier + categories so we can see
// why a known exotic (e.g. an exotic hand cannon) isn't being classified.
export async function debugXur() {
  const { access_token } = await refreshAccessToken()
  const character = await getPrimaryCharacter(access_token)
  const hashes = await getVendorSaleHashes(access_token, character, XUR_VENDOR_HASH)
  const items = []
  for (const h of hashes) {
    let def
    try {
      def = await getItemDef(h)
    } catch (e) {
      items.push({ hash: h, error: e.message })
      continue
    }
    items.push({
      hash: h,
      name: def?.displayProperties?.name || '',
      tier: def?.inventory?.tierTypeName || null,
      itemType: def?.itemType,
      itemTypeDisplayName: def?.itemTypeDisplayName || '',
      cats: def?.itemCategoryHashes || []
    })
  }
  return { vendorHash: XUR_VENDOR_HASH, count: hashes.length, items }
}

export async function resolveRotation() {
  const result = {
    weekOf: lastResetISO(),
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    nightfall: {
      label: RITUALS.nightfall.label,
      activityHashes: ACTIVITY_POOLS.nightfall,
      note: RITUALS.nightfall.note
    },
    trials: {
      label: RITUALS.trials.label,
      activityHashes: ACTIVITY_POOLS.trials,
      note: RITUALS.trials.note
    },
    // Xûr's weekly exotic stock (no activity pool — you buy these from him).
    // He now lives in the Tower (The Last City), near Ikora.
    xur: { label: 'Xûr', location: 'The Tower (near Ikora)', present: false, weapons: [], armor: [] }
  }

  // Xûr's live stock is the only thing that needs a token; everything else is
  // static. If it succeeds we mark the payload 'live'.
  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    result.xur = { ...result.xur, ...(await xurStock(access_token, character)) }
    result.source = 'live'
  } catch (err) {
    result.error = err.message // degrade: pools + notes still correct
  }

  return result
}
