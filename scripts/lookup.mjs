// =============================================================================
// scripts/lookup.mjs — Manifest hash lookup utility.
//
// Finds itemHash / activityHash values by name, straight from the downloaded
// Manifest SQLite DB. Use it to author dropRates.json entries.
//
//   node scripts/lookup.mjs "Touch of Malice"
//   node scripts/lookup.mjs "Spire of the Watcher" "Heartshadow"
//   node scripts/lookup.mjs --items "Long Arm"        (weapons only)
//   node scripts/lookup.mjs --activities "Duality"    (activities only)
//   npm run lookup -- "Touch of Malice"               (same, via package script)
//
// better-sqlite3 is built against Electron's ABI, not the system Node's, so this
// script self-relaunches under Electron (ELECTRON_RUN_AS_NODE) when started with
// plain `node`. That makes both `node scripts/lookup.mjs` and `npm run lookup`
// work without any extra flags.
// =============================================================================
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// --- Self-relaunch shim: re-exec under Electron-as-Node if needed ----------
if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  const electronPath = require('electron') // resolves to the Electron binary path
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync(electronPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(res.status ?? 0)
}

const { default: Database } = await import('better-sqlite3')

const dbPath = path.join(
  process.env.APPDATA || path.join(process.env.HOME || '', 'AppData/Roaming'),
  'ghost-companion',
  'manifest',
  'world_content.sqlite'
)
if (!fs.existsSync(dbPath)) {
  console.error(`Manifest DB not found at:\n  ${dbPath}\nRun the app once to download it.`)
  process.exit(1)
}

const args = process.argv.slice(2)
let mode = 'both'
if (args[0] === '--items') { mode = 'items'; args.shift() }
else if (args[0] === '--activities') { mode = 'activities'; args.shift() }
else if (args[0] === '--vendors') { mode = 'vendors'; args.shift() }
if (!args.length) {
  console.error('Usage: node scripts/lookup.mjs [--items|--activities|--vendors] "name" ["name2" ...]')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
const terms = args.map((t) => t.toLowerCase())

function scan(table, pick) {
  const out = []
  for (const { json } of db.prepare(`SELECT json FROM ${table}`).all()) {
    let def
    try { def = JSON.parse(json) } catch { continue }
    const name = def?.displayProperties?.name
    if (!name || def.redacted) continue
    const lower = name.toLowerCase()
    if (!terms.some((t) => lower.includes(t))) continue
    out.push(pick(def, name))
  }
  return out
}

if (mode === 'both' || mode === 'items') {
  const items = scan('DestinyInventoryItemDefinition', (def, name) => ({
    itemHash: def.hash,
    name,
    rarity: def.inventory?.tierTypeName || '',
    type: def.itemTypeDisplayName || ''
  }))
    // Surface real gear first (weapons/armor), skip dummies with no type.
    .filter((i) => i.type)
    .sort((a, b) => a.name.localeCompare(b.name))
  console.log(`\n=== ITEMS (${items.length}) ===`)
  for (const i of items) console.log(`${String(i.itemHash).padEnd(12)} ${i.rarity.padEnd(10)} ${i.type.padEnd(22)} ${i.name}`)
}

if (mode === 'both' || mode === 'activities') {
  const acts = scan('DestinyActivityDefinition', (def, name) => ({
    activityHash: def.hash,
    name,
    light: def.activityLightLevel || 0,
    place: def.destinationHash || 0
  })).sort((a, b) => a.name.localeCompare(b.name))
  console.log(`\n=== ACTIVITIES (${acts.length}) ===`)
  for (const a of acts) console.log(`${String(a.activityHash).padEnd(12)} light:${String(a.light).padEnd(5)} ${a.name}`)
}

if (mode === 'vendors') {
  const vendors = scan('DestinyVendorDefinition', (def, name) => ({
    vendorHash: def.hash,
    name,
    subtitle: def.displayProperties?.subtitle || ''
  })).sort((a, b) => a.name.localeCompare(b.name))
  console.log(`\n=== VENDORS (${vendors.length}) ===`)
  for (const v of vendors) console.log(`${String(v.vendorHash).padEnd(12)} ${v.name}${v.subtitle ? ' — ' + v.subtitle : ''}`)
}

db.close()
