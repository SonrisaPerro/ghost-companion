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
import { XUR_VENDOR_HASHES, RITUALS, ACTIVITY_POOLS, lastResetISO } from './config.js'

const BUNGIE = 'https://www.bungie.net'
const WEAPON_CATEGORY = 1 // DestinyItemCategory.Weapon
const ARMOR_CATEGORY = 20 // DestinyItemCategory.Armor
const ITEM_TYPE_WEAPON = 3 // DestinyItemType.Weapon
const ITEM_TYPE_ARMOR = 2 // DestinyItemType.Armor
// Exotic class items (Hunter Cloak / Warlock Bond / Titan Mark) report itemType 0
// and only carry their class category (e.g. [23] for Hunter) — no Weapon/Armor
// category and no armor itemType — so we fall back to the type display name.
const CLASS_ITEM_RE = /\b(Cloak|Bond|Mark)\b/i

/** 'weapon' | 'armor' | null — robust across normal gear and exotic class items. */
function classifyGear(def) {
  const cats = def.itemCategoryHashes || []
  if (def.itemType === ITEM_TYPE_WEAPON || cats.includes(WEAPON_CATEGORY)) return 'weapon'
  if (
    def.itemType === ITEM_TYPE_ARMOR ||
    cats.includes(ARMOR_CATEGORY) ||
    CLASS_ITEM_RE.test(def.itemTypeDisplayName || '')
  ) {
    return 'armor'
  }
  return null
}

function shapeItem(def) {
  if (!def) return null
  return {
    itemHash: def.hash,
    name: def.displayProperties?.name || '',
    icon: def.displayProperties?.icon ? `${BUNGIE}${def.displayProperties.icon}` : null,
    type: def.itemTypeDisplayName || ''
  }
}

/** Reads Xûr's current stock across all his vendor screens and splits out the
 *  exotic weapons/armor he's selling. Exotic-only (engrams, materials, catalysts,
 *  the Xûrfboard vehicle, and his legendary gear are filtered out by tier +
 *  classifyGear). Empty (present:false) when he's away or every lookup fails. */
async function xurStock(accessToken, character) {
  const weapons = []
  const armor = []
  const seenSale = new Set() // dedupe sale hashes across vendor screens
  const seenItem = new Set() // dedupe items that appear on more than one screen
  let anySales = false

  for (const vendorHash of XUR_VENDOR_HASHES) {
    let hashes
    try {
      hashes = await getVendorSaleHashes(accessToken, character, vendorHash)
    } catch {
      continue // one screen failing shouldn't blank the others
    }
    if (hashes.length) anySales = true
    for (const h of hashes) {
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
  return { present: anySales, weapons, armor }
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
