// =============================================================================
// rotation.js — resolves this week's featured Nightfall + Trials weapon.
//
// Strategy (with graceful degradation):
//   1. Manual override (env) wins, if present.
//   2. Otherwise read the vendor's current sales, fetch each sale item's def,
//      and surface the legendary weapons as candidates (+ a best guess).
//   3. If anything fails, we still return correct activity pools with a null
//      weapon — the client then shows "check the in-game vendor". (= Approach A)
//
// The vendor heuristic (best guess = first legendary weapon on sale) is the part
// that needs validation against a live token + active vendor; `candidates` and
// the ROTATION_OVERRIDE_JSON env exist precisely so a wrong guess is correctable.
// =============================================================================

import {
  refreshAccessToken,
  getPrimaryCharacter,
  getVendorSaleHashes,
  getItemDef
} from './bungie.js'
import { VENDORS, XUR_VENDOR_HASH, ACTIVITY_POOLS, parseOverride, lastResetISO } from './config.js'

const BUNGIE = 'https://www.bungie.net'
const WEAPON_ITEM_TYPE = 3 // DestinyItemType.Weapon
const ARMOR_ITEM_TYPE = 2 //  DestinyItemType.Armor

function shapeWeapon(def) {
  if (!def) return null
  return {
    itemHash: def.hash,
    name: def.displayProperties?.name || '',
    icon: def.displayProperties?.icon ? `${BUNGIE}${def.displayProperties.icon}` : null,
    type: def.itemTypeDisplayName || ''
  }
}

/** Reads Xûr's current stock and splits the exotic weapons/armor he's selling.
 *  Empty (present:false) when he's away or the lookup fails. */
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
    if (def.itemType === WEAPON_ITEM_TYPE) weapons.push(shapeWeapon(def))
    else if (def.itemType === ARMOR_ITEM_TYPE) armor.push(shapeWeapon(def))
  }
  return { present: hashes.length > 0, weapons, armor }
}

/** Reads a vendor's sales and returns the legendary/exotic weapons on offer. */
async function weaponsFromVendor(accessToken, character, vendorHash) {
  const hashes = await getVendorSaleHashes(accessToken, character, vendorHash)
  const out = []
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
    if (def?.itemType !== WEAPON_ITEM_TYPE) continue
    const tier = def.inventory?.tierTypeName
    if (tier !== 'Legendary' && tier !== 'Exotic') continue
    out.push(shapeWeapon(def))
  }
  return out
}

export async function resolveRotation() {
  const result = {
    weekOf: lastResetISO(),
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    nightfall: {
      label: VENDORS.nightfall.label,
      activityHashes: ACTIVITY_POOLS.nightfall,
      weapon: null,
      candidates: []
    },
    trials: {
      label: VENDORS.trials.label,
      activityHashes: ACTIVITY_POOLS.trials,
      weapon: null,
      candidates: []
    },
    // Xûr's weekly exotic stock (no activity pool — you buy these from him).
    // He now lives in the Tower (The Last City), near Ikora.
    xur: { label: 'Xûr', location: 'The Tower (near Ikora)', present: false, weapons: [], armor: [] }
  }

  // 1) Manual override wins (resolve names for nicer display).
  const override = parseOverride()
  if (override) {
    for (const key of ['nightfall', 'trials']) {
      if (override[key]) {
        try {
          result[key].weapon = shapeWeapon(await getItemDef(override[key]))
        } catch {
          result[key].weapon = { itemHash: override[key] }
        }
      }
    }
    result.source = 'override'
  }

  // 2) Vendor lookup for any ritual not already pinned by an override.
  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    for (const key of ['nightfall', 'trials']) {
      const weapons = await weaponsFromVendor(access_token, character, VENDORS[key].vendorHash)
      result[key].candidates = weapons
      if (!result[key].weapon) result[key].weapon = weapons[0] || null
    }
    // Xûr is best-effort: if he's away or his lookup fails, leave present:false.
    try {
      result.xur = { ...result.xur, ...(await xurStock(access_token, character)) }
    } catch {
      /* keep the empty xur default */
    }
    if (result.source !== 'override') result.source = 'vendor'
  } catch (err) {
    // 3) Degrade gracefully — activity pools are still correct.
    result.error = err.message
  }

  return result
}
