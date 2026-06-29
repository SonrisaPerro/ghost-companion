// =============================================================================
// monument.js — resolves the Monument to Lost Lights "Exotic Archive" catalog.
//
// The Monument is the Tower kiosk that sells legacy raid/quest exotics for
// materials (Exotic Cipher, Ascendant Shards/Alloys, Spoils of Conquest, Glimmer).
// It's always present (not time-gated like Xûr), but the catalog shifts as old
// content rotates in/out, so we read it LIVE and report each exotic with its cost.
//
// This is primarily a verification surface: it tells us exactly which exotics are
// buyable here right now and for how much, so the static `vendor` acquisition
// paths in paths.json can be kept accurate. Same auth path as the Xûr resolver
// (one service account's refresh token, global read).
//   - source 'live'     → authoritative read of the vendor's sales
//   - source 'fallback' → token/network failure; catalog unknown
// =============================================================================

import {
  refreshAccessToken,
  getPrimaryCharacter,
  getVendorSales,
  getItemDef
} from './bungie.js'
import { MONUMENT_VENDOR_HASH } from './config.js'
import { classifyGear, shapeItem } from './gear.js'

/** Resolves a sale's cost itemHashes to readable names, caching across the catalog. */
async function resolveCosts(costs, cache) {
  const out = []
  for (const c of costs) {
    if (!cache.has(c.itemHash)) {
      let name = `#${c.itemHash}`
      try {
        const d = await getItemDef(c.itemHash)
        name = d?.displayProperties?.name || name
      } catch {
        /* leave the hash placeholder */
      }
      cache.set(c.itemHash, name)
    }
    out.push({ name: cache.get(c.itemHash), quantity: c.quantity })
  }
  return out
}

/**
 * Reads the Monument's live catalog. The top-level vendor sells 3 CATEGORY
 * containers ("Light and Dark Saga Exotics", "Fate Saga Exotics", "Legacy
 * Gear"), each itemType-0 with a `preview` block: `previewVendorHash` points at
 * the sub-vendor that actually sells the exotics, and `derivedItemCategories`
 * lists the child item hashes. We follow each container:
 *   - read the sub-vendor's live sales → real purchase costs, keyed by itemHash
 *   - enumerate the container's derivedItemCategories items → the catalog itself
 * then filter to EXOTIC weapons/armor and attach the cost (if the sub-vendor
 * exposed one). Costs may be empty if a sub-vendor isn't character-readable.
 */
async function monumentCatalog(accessToken, character) {
  const { present, sales } = await getVendorSales(accessToken, character, MONUMENT_VENDOR_HASH)
  const weapons = []
  const armor = []
  const costCache = new Map()
  const seen = new Set()

  for (const container of sales) {
    let cDef
    try {
      cDef = await getItemDef(container.itemHash)
    } catch {
      continue
    }
    const preview = cDef?.preview
    if (!preview) continue

    // Costs from the live sub-vendor, keyed by the exotic's itemHash. The preview
    // sub-vendors often aren't character-readable, in which case costs stay blank
    // and we still surface the catalog from derivedItemCategories.
    const costByItem = new Map()
    if (preview.previewVendorHash) {
      try {
        const sub = await getVendorSales(accessToken, character, preview.previewVendorHash)
        for (const s of sub.sales) costByItem.set(s.itemHash, s.costs)
      } catch {
        /* sub-vendor not character-readable → catalog still listed, costs blank */
      }
    }

    const derived = (preview.derivedItemCategories || []).flatMap((c) => c.items || [])
    for (const { itemHash } of derived) {
      if (!itemHash || seen.has(itemHash)) continue
      seen.add(itemHash)
      let def
      try {
        def = await getItemDef(itemHash)
      } catch {
        continue
      }
      if (def?.inventory?.tierTypeName !== 'Exotic') continue
      const kind = classifyGear(def)
      if (!kind) continue
      const item = { ...shapeItem(def), costs: await resolveCosts(costByItem.get(itemHash) || [], costCache) }
      if (kind === 'weapon') weapons.push(item)
      else armor.push(item)
    }
  }
  return { present, weapons, armor }
}

export async function resolveMonument() {
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    vendor: {
      label: 'Monument to Lost Lights',
      location: 'The Tower (Tower North, by the vault)',
      present: false,
      weapons: [],
      armor: []
    }
  }

  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    const cat = await monumentCatalog(access_token, character)
    result.vendor = { ...result.vendor, present: cat.present, weapons: cat.weapons, armor: cat.armor }
    result.source = 'live'
  } catch (err) {
    result.error = err.message // token/network failure → catalog unknown
  }

  return result
}
