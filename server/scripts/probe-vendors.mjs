// probe-vendors.mjs — OFFLINE Manifest probe for Stage 3 (Banshee/Ada + GM Nightfall).
// Reads the desktop app's local Manifest SQLite with Node 24's built-in node:sqlite
// (no creds, no network). Answers three questions before we write any resolver:
//   1) the exact DestinyVendorDefinition hashes for Banshee-44 and Ada-1
//   2) what each of those vendors is described as selling (categories / groups)
//   3) whether Nightfall / Grand Master activity defs carry a static reward we could
//      surface, or whether the current GM reward is live-only (rotation-table territory)
//
//   node server/scripts/probe-vendors.mjs
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

const DB = path.join(os.homedir(), 'AppData', 'Roaming', 'ghost-companion', 'manifest', 'world_content.sqlite')
const db = new DatabaseSync(DB, { readOnly: true })

// Bungie stores each def as { id: signed-int32 hash, json: text }. Recover the
// unsigned hash for display.
const toHash = (id) => (id < 0 ? id + 4294967296 : id)

function rows(table) {
  return db.prepare(`SELECT id, json FROM ${table}`).all()
}

// --- tables present (sanity) ---
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
console.log('tables:', tables.map((t) => t.name).length, 'found')

// --- 1) find Banshee-44 and Ada-1 vendor defs by name ---
console.log('\n=== VENDORS matching Banshee / Ada / Gunsmith ===')
const vendorHits = []
for (const r of rows('DestinyVendorDefinition')) {
  const d = JSON.parse(r.json)
  const name = d?.displayProperties?.name || ''
  if (/banshee|\bada\b|gunsmith/i.test(name)) {
    const hash = toHash(r.id)
    vendorHits.push({ hash, name, d })
    const subtitle = d?.displayProperties?.subtitle || ''
    const groups = (d?.groups || []).map((g) => g.vendorGroupHash).join(',')
    const cats = (d?.categories || []).length
    const enabled = d?.enabled
    console.log(`• ${name} — ${subtitle}  [${hash}]  enabled=${enabled} categories=${cats} groups=[${groups}]`)
  }
}

// --- 2) for the top Banshee/Ada matches, list their category display names ---
console.log('\n=== category breakdown for the primary Banshee/Ada vendors ===')
for (const v of vendorHits) {
  if (!/banshee-44|^ada-1|ada-1/i.test(v.name)) continue
  console.log(`\n${v.name} [${v.hash}]`)
  const cats = v.d?.categories || v.d?.displayCategories || []
  for (const c of cats.slice(0, 20)) {
    const cn = c?.displayProperties?.name || c?.displayTitle || c?.identifier || '(cat)'
    console.log(`   · ${cn}`)
  }
}

// --- 3) GM / Nightfall reward feasibility from static defs ---
console.log('\n=== NIGHTFALL / GRANDMASTER activity defs (static rewards?) ===')
let nfCount = 0
for (const r of rows('DestinyActivityDefinition')) {
  const d = JSON.parse(r.json)
  const name = d?.displayProperties?.name || ''
  if (!/nightfall|grandmaster/i.test(name)) continue
  nfCount++
  if (nfCount > 25) continue
  const hash = toHash(r.id)
  const rewards = d?.rewards || []
  const rewardItems = rewards.flatMap((rw) => (rw.rewardItems || []).map((i) => i.itemHash))
  console.log(`• ${name} [${hash}] rewards=${rewards.length} items=[${rewardItems.slice(0, 6).join(',')}]`)
}
console.log(`(nightfall/grandmaster-named activity defs: ${nfCount})`)

db.close()
console.log('\n=== done ===')
