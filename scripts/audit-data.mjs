// =============================================================================
// scripts/audit-data.mjs — verify dropRates.json against the live Manifest.
//
// Checks every item against the current Manifest:
//   • itemHash still resolves, and its name matches the JSON key
//   • whether the item is craftable (so "craftable" paths can be sanity-checked)
//   • every sourceActivityHash still resolves to a real activity
//
// Catches content that was vaulted/reissued by recent patches. Run:
//   npm run audit
//
// Self-relaunches under Electron-as-Node (same trick as lookup.mjs).
// =============================================================================
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

if (!process.versions.electron) {
  const require = createRequire(import.meta.url)
  const electronPath = require('electron')
  const { spawnSync } = await import('node:child_process')
  const res = spawnSync(electronPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(res.status ?? 0)
}

const { default: Database } = await import('better-sqlite3')
const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

const dataPath = path.join(__dirname, '..', 'src', 'data', 'dropRates.json')
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

const db = new Database(dbPath, { readonly: true, fileMustExist: true })

// Build lookup maps once.
const items = new Map()
for (const { json } of db.prepare('SELECT json FROM DestinyInventoryItemDefinition').all()) {
  let def
  try { def = JSON.parse(json) } catch { continue }
  if (def?.hash != null) items.set(def.hash, def)
}
const acts = new Map()
for (const { json } of db.prepare('SELECT json FROM DestinyActivityDefinition').all()) {
  let def
  try { def = JSON.parse(json) } catch { continue }
  if (def?.hash != null) acts.set(def.hash, def)
}
db.close()

const isCraftable = (def) =>
  // A craftable weapon carries an inventory.recipeItemHash pointing at its pattern.
  !!(def?.inventory?.recipeItemHash && def.inventory.recipeItemHash !== 0)

let problems = 0
const note = (msg) => { problems++; console.log('  ⚠ ' + msg) }

console.log(`\nAuditing ${Object.keys(data).filter(k => !k.startsWith('_')).length} items against the Manifest\n`)

for (const [name, entry] of Object.entries(data)) {
  if (name.startsWith('_')) continue
  console.log(`■ ${name}`)

  const def = items.get(entry.itemHash)
  if (!def) {
    note(`itemHash ${entry.itemHash} NOT FOUND in Manifest (vaulted or changed?)`)
  } else {
    const liveName = def.displayProperties?.name || ''
    if (liveName !== name) note(`name mismatch: JSON "${name}" vs Manifest "${liveName}"`)
    const craftableNow = isCraftable(def)
    for (const p of entry.acquisitionPaths || []) {
      if (p.pathType === 'craftable' && !craftableNow) {
        note(`path "${p.id}" is marked craftable, but Manifest shows no recipe (changed?)`)
      }
    }
    console.log(`    ✓ ${liveName} — ${def.inventory?.tierTypeName || '?'} ${def.itemTypeDisplayName || ''}${craftableNow ? ' [craftable]' : ''}`)
  }

  // Activity hashes.
  for (const p of entry.acquisitionPaths || []) {
    for (const h of p.sourceActivityHashes || []) {
      const a = acts.get(h)
      if (!a) note(`path "${p.id}" activityHash ${h} NOT FOUND (vaulted?)`)
    }
  }
}

console.log(`\n${problems === 0 ? '✓ No problems found.' : `⚠ ${problems} problem(s) flagged above.`}\n`)
process.exit(problems === 0 ? 0 : 1)
