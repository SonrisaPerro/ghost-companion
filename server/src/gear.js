// =============================================================================
// gear.js — shared gear classification used by the live vendor resolvers.
//
// Both the Xûr and Monument resolvers need to split a vendor's exotic stock into
// weapons vs armor and shape it for the client. Keeping this in one place means
// the two endpoints classify identically (incl. the exotic class-item quirk).
// =============================================================================

const BUNGIE = 'https://www.bungie.net'
const WEAPON_CATEGORY = 1 // DestinyItemCategory.Weapon
const ARMOR_CATEGORY = 20 // DestinyItemCategory.Armor
const ITEM_TYPE_WEAPON = 3 // DestinyItemType.Weapon
const ITEM_TYPE_ARMOR = 2 // DestinyItemType.Armor
// Exotic class items (Hunter Cloak / Warlock Bond / Titan Mark) report itemType 0
// and only carry their class category — no Weapon/Armor category and no armor
// itemType — so we fall back to the type display name.
const CLASS_ITEM_RE = /\b(Cloak|Bond|Mark)\b/i

/** 'weapon' | 'armor' | null — robust across normal gear and exotic class items. */
export function classifyGear(def) {
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

/** Minimal client-facing shape for a single item definition. */
export function shapeItem(def) {
  if (!def) return null
  return {
    itemHash: def.hash,
    name: def.displayProperties?.name || '',
    icon: def.displayProperties?.icon ? `${BUNGIE}${def.displayProperties.icon}` : null,
    type: def.itemTypeDisplayName || ''
  }
}
