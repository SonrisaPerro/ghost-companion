// =============================================================================
// eververse.js — checks whether tracked weapon ornaments are FOR SALE right now
// in the Eververse store (Tess Everis).
//
// Some weapon ornaments have no activity/quest source — their only acquisition is
// Eververse, where they rotate in and out for Bright Dust (grindable) or Silver
// (real money). The Manifest can't tell us whether a given ornament is buyable
// *today*, so we read the live vendor sales (the THREE Tess screens) and match
// them against our tracked-ornament registry (data/ornaments.json).
//
// Same auth path as the Xûr / Monument resolvers (one service account's refresh
// token, global read):
//   - source 'live'     → authoritative read of the Eververse sales
//   - source 'fallback' → token/network failure; shop state unknown
//
// Payload tells the client which tracked ornaments are IN the shop (with cost +
// currency, so it can say "go buy it — 1500 Bright Dust") and which are not.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  refreshAccessToken,
  getPrimaryCharacter,
  getVendorSales,
  getItemDef
} from './bungie.js'
import { EVERVERSE_VENDOR_HASHES } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ORN_FILE = path.join(__dirname, '..', 'data', 'ornaments.json')

/** Loads the tracked-ornament registry (kept identical with the client copy). */
function loadTracked() {
  try {
    const json = JSON.parse(fs.readFileSync(ORN_FILE, 'utf8'))
    return Array.isArray(json.trackedOrnaments) ? json.trackedOrnaments : []
  } catch (e) {
    console.error('[eververse] failed to load ornaments.json:', e.message)
    return []
  }
}

// Known Eververse currencies — lets us label a cost as grindable vs real-money
// without a def lookup. Anything else falls back to the resolved item name.
const CURRENCY = new Map([
  [2817410917, { name: 'Bright Dust', kind: 'bright_dust' }],
  [3147280338, { name: 'Silver', kind: 'silver' }],
  [3159615086, { name: 'Glimmer', kind: 'glimmer' }]
])

/** Resolves a sale's costs to readable names + a currency classification. */
async function resolveCosts(costs, cache) {
  const out = []
  for (const c of costs) {
    const known = CURRENCY.get(c.itemHash)
    let name = known?.name
    const kind = known?.kind || 'other'
    if (!name) {
      if (!cache.has(c.itemHash)) {
        let n = `#${c.itemHash}`
        try {
          const d = await getItemDef(c.itemHash)
          n = d?.displayProperties?.name || n
        } catch {
          /* leave the hash placeholder */
        }
        cache.set(c.itemHash, n)
      }
      name = cache.get(c.itemHash)
    }
    out.push({ name, quantity: c.quantity, kind })
  }
  return out
}

/**
 * Reads all Eververse screens and builds a map: itemHash → { costs, vendorHash }.
 * Eververse can list a cosmetic directly as a sale item; if a "sale" is actually a
 * category container (itemType 0 with a preview, like the Monument), we also follow
 * its previewVendorHash sub-vendor and fold those sales in, so a direct itemHash
 * match works either way.
 */
async function readShop(accessToken, character) {
  const byItem = new Map()
  const vendorsSeen = []
  let anyReadable = false

  async function fold(vendorHash) {
    let res
    try {
      res = await getVendorSales(accessToken, character, vendorHash)
    } catch (e) {
      vendorsSeen.push({ hash: vendorHash, readable: false, saleCount: 0, error: e.message })
      return
    }
    anyReadable = true
    vendorsSeen.push({ hash: vendorHash, readable: true, present: res.present, saleCount: res.sales.length })
    for (const s of res.sales) {
      if (!byItem.has(s.itemHash)) byItem.set(s.itemHash, { costs: s.costs, vendorHash })
      // Follow category containers (preview sub-vendor), mirroring the Monument.
      let def
      try {
        def = await getItemDef(s.itemHash)
      } catch {
        continue
      }
      const sub = def?.preview?.previewVendorHash
      if (sub) await fold(sub)
    }
  }

  for (const h of EVERVERSE_VENDOR_HASHES) await fold(h)
  return { byItem, vendorsSeen, anyReadable }
}

export async function resolveEververse() {
  const tracked = loadTracked()
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'fallback',
    vendor: { label: 'Eververse (Tess Everis)', location: 'The Tower (Tower North)', present: false },
    anyInShop: false,
    inShop: [], // tracked ornaments buyable right now (with cost)
    notInShop: [], // tracked ornaments not currently offered
    diagnostics: { trackedCount: tracked.length }
  }

  try {
    const { access_token } = await refreshAccessToken()
    const character = await getPrimaryCharacter(access_token)
    const { byItem, vendorsSeen, anyReadable } = await readShop(access_token, character)
    if (!anyReadable) throw new Error('No Eververse screen was readable.')

    const costCache = new Map()
    for (const orn of tracked) {
      const hit = byItem.get(orn.itemHash)
      if (hit) {
        const cost = await resolveCosts(hit.costs || [], costCache)
        result.inShop.push({ ...orn, cost, vendorHash: hit.vendorHash })
      } else {
        result.notInShop.push(orn)
      }
    }
    result.anyInShop = result.inShop.length > 0
    result.vendor.present = vendorsSeen.some((v) => v.present)
    result.source = 'live'
    result.diagnostics.vendors = vendorsSeen
    result.diagnostics.totalSaleItems = byItem.size
  } catch (err) {
    result.error = err.message // token/network failure → shop state unknown
    result.notInShop = tracked // honest default: unknown ⇒ don't claim anything's for sale
  }

  return result
}
