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
import { refreshAccessToken, getPrimaryCharacter, getVendorSales, getItemDef } from './bungie.js'
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
 * Reads each Eververse screen's live sales and builds a map: itemHash → { costs,
 * vendorHash }. Verified 2026-06-29: the main Tess screen (3361454721) lists every
 * cosmetic — ornaments included — directly as sale items (~224 of them), so a plain
 * itemHash match is enough; no category-container following is needed (unlike the
 * Monument). Screens that aren't character-readable just fail closed and are noted
 * in diagnostics.
 */
async function readShop(accessToken, character) {
  const byItem = new Map()
  const vendorsSeen = []
  let anyReadable = false

  for (const vendorHash of EVERVERSE_VENDOR_HASHES) {
    let res
    try {
      res = await getVendorSales(accessToken, character, vendorHash)
    } catch {
      vendorsSeen.push({ hash: vendorHash, readable: false, saleCount: 0 })
      continue
    }
    anyReadable = true
    vendorsSeen.push({ hash: vendorHash, readable: true, present: res.present, saleCount: res.sales.length })
    for (const s of res.sales) {
      if (!byItem.has(s.itemHash)) byItem.set(s.itemHash, { costs: s.costs, vendorHash })
    }
  }
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
    shopSales: [], // ALL current sale items { itemHash, cost } — lets the client match
    //               user-tracked ornaments (not just the curated registry) against the shop
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

    // Every current sale with its resolved cost, so the client can match its own
    // user-tracked ornaments (which the server doesn't know about) against the live
    // shop. Currencies are the 3 known ones (no def lookups), so this stays cheap.
    for (const [itemHash, hit] of byItem) {
      const cost = await resolveCosts(hit.costs || [], costCache)
      result.shopSales.push({ itemHash, cost })
    }
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
