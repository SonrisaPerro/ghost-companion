// =============================================================================
// manifest.js
// Downloads, caches, version-checks, and queries the Destiny 2 Manifest — the
// giant content database that maps hashes (itemHash, activityHash, ...) to
// human-readable definitions (names, icons, descriptions, sources).
//
// We use the SQLite "MobileWorldContent" path because better-sqlite3 lets us
// query it on demand without loading the whole multi-hundred-MB JSON into RAM.
// =============================================================================

import { app } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import AdmZip from 'adm-zip'
import Database from 'better-sqlite3'
import fetch from 'node-fetch'

const BUNGIE_ROOT = 'https://www.bungie.net'
const MANIFEST_INFO_URL = `${BUNGIE_ROOT}/Platform/Destiny2/Manifest/`

// Which manifest tables we query. DestinyInventoryItemDefinition holds weapons,
// armor, and most "items"; we read others lazily for source resolution.
const ITEM_TABLE = 'DestinyInventoryItemDefinition'

let db = null // open better-sqlite3 handle (lazy)

/** Absolute paths for our cached manifest + version marker inside userData. */
function paths() {
  const dir = path.join(app.getPath('userData'), 'manifest')
  return {
    dir,
    dbFile: path.join(dir, 'world_content.sqlite'),
    versionFile: path.join(dir, 'version.txt')
  }
}

function apiKey() {
  const key = process.env.BUNGIE_API_KEY
  if (!key || key === 'your_bungie_api_key_here') {
    throw new Error('BUNGIE_API_KEY is not set — required to download the Manifest.')
  }
  return key
}

/**
 * Asks Bungie for current manifest metadata and returns the English SQLite
 * world-content path plus the version string.
 */
async function fetchManifestInfo() {
  const res = await fetch(MANIFEST_INFO_URL, { headers: { 'X-API-Key': apiKey() } })
  const json = await res.json()
  if (json.ErrorCode !== 1) {
    throw new Error(`Manifest metadata error ${json.ErrorCode}: ${json.Message}`)
  }
  const info = json.Response
  const contentPath = info.mobileWorldContentPaths?.en
  if (!contentPath) throw new Error('No English world-content path in manifest metadata.')
  return { version: info.version, contentPath }
}

/**
 * Returns the locally cached manifest version, or null if none.
 */
async function readLocalVersion() {
  try {
    return (await fsp.readFile(paths().versionFile, 'utf8')).trim()
  } catch {
    return null
  }
}

/**
 * Downloads the manifest SQLite database. Bungie's `.content` file is a ZIP
 * archive (PKZIP) containing a single SQLite database entry — we stream it to a
 * temp file, extract that entry, and swap it into place.
 */
async function downloadManifest(contentPath, version) {
  const { dir, dbFile, versionFile } = paths()
  await fsp.mkdir(dir, { recursive: true })

  const url = `${BUNGIE_ROOT}${contentPath}`
  const res = await fetch(url, { headers: { 'X-API-Key': apiKey() } })
  if (!res.ok) throw new Error(`Manifest download failed: HTTP ${res.status}`)

  // Stream the ZIP to disk first (it's hundreds of MB — avoid buffering twice).
  const tmpZip = `${dbFile}.zip`
  await pipeline(res.body, createWriteStream(tmpZip))

  // The archive holds exactly one entry: the SQLite world-content database.
  const zip = new AdmZip(tmpZip)
  const entry = zip.getEntries().find((e) => !e.isDirectory)
  if (!entry) throw new Error('Manifest archive contained no database entry.')

  const data = zip.readFile(entry)
  if (!data) throw new Error('Failed to read SQLite entry from manifest archive.')

  // Close any open handle before overwriting the database file.
  closeDb()
  await fsp.writeFile(dbFile, data)
  await fsp.writeFile(versionFile, version, 'utf8')
  await fsp.rm(tmpZip, { force: true })
}

/**
 * Ensures a current manifest exists locally. Downloads on first launch or when
 * the cached version is stale. Call this once during app startup.
 *
 * @returns {Promise<{version: string, updated: boolean}>}
 */
export async function ensureManifest() {
  const { dbFile } = paths()
  const { version, contentPath } = await fetchManifestInfo()
  const localVersion = await readLocalVersion()
  const haveFile = fs.existsSync(dbFile)

  if (!haveFile || localVersion !== version) {
    await downloadManifest(contentPath, version)
    return { version, updated: true }
  }
  return { version, updated: false }
}

/** Lazily opens (and memoizes) the SQLite handle in read-only mode. */
function getDb() {
  if (db) return db
  const { dbFile } = paths()
  if (!fs.existsSync(dbFile)) {
    throw new Error('Manifest not downloaded yet. Call ensureManifest() first.')
  }
  db = new Database(dbFile, { readonly: true, fileMustExist: true })
  return db
}

/** Closes the SQLite handle (used before replacing the file on update). */
export function closeDb() {
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
  }
}

/**
 * In the Bungie SQLite manifest each definition table has two columns:
 *   id   — a SIGNED 32-bit version of the hash
 *   json — the definition as a JSON string
 * This helper decodes the row JSON.
 */
function parseRow(row) {
  if (!row) return null
  try {
    return JSON.parse(row.json)
  } catch {
    return null
  }
}

/**
 * Full-text-ish search over DestinyInventoryItemDefinition by display name.
 * Backs the "search-manifest" IPC channel.
 *
 * Note: the manifest has no name index, so we scan and filter in JS. We cap the
 * scan with a reasonable LIMIT after JSON filtering to stay responsive.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{name,description,icon,itemHash,collectibleHash,sources}>}
 */
export function searchManifest(query, limit = 40) {
  const term = (query || '').trim().toLowerCase()
  if (term.length < 2) return []

  const rows = getDb().prepare(`SELECT json FROM ${ITEM_TABLE}`).all()
  const results = []

  for (const row of rows) {
    const def = parseRow(row)
    const name = def?.displayProperties?.name
    if (!name) continue
    if (!name.toLowerCase().includes(term)) continue

    // Skip "redacted"/dummy entries that have no real presentation.
    if (def.redacted) continue

    results.push(formatItem(def))

    if (results.length >= limit) break
  }

  // Prefer exact/prefix matches first for a nicer UX.
  results.sort((a, b) => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    const score = (n) => (n === term ? 0 : n.startsWith(term) ? 1 : 2)
    return score(an) - score(bn) || an.localeCompare(bn)
  })

  return results
}

/**
 * Shapes a raw DestinyInventoryItemDefinition into the renderer "item card"
 * used by search results and by-hash lookups.
 */
function formatItem(def) {
  return {
    itemHash: def.hash,
    name: def.displayProperties?.name || '',
    description: def.displayProperties?.description || '',
    icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : null,
    collectibleHash: def.collectibleHash || null,
    itemType: def.itemTypeDisplayName || '',
    // tierTypeName is "Exotic" / "Legendary" / "Rare" / ... — used for rarity coloring.
    tierTypeName: def.inventory?.tierTypeName || '',
    // `sourceString` (if present) is a human-readable acquisition hint.
    sources: def.collectibleHash ? resolveSources(def.collectibleHash) : []
  }
}

/**
 * Returns a single item card by unsigned itemHash, or null. Backs the
 * "get-item-by-hash" IPC channel (lets users add/scan items by raw hash).
 */
export function getItemCard(itemHash) {
  const def = getItemByHash(itemHash)
  return def ? formatItem(def) : null
}

/**
 * Searches DestinyActivityDefinition by name. Backs "search-activities", used
 * by the in-app add-path form so users can pick a source activity (and capture
 * its hash) without hand-looking-up numbers. Returns { activityHash, name }.
 */
export function searchActivities(query, limit = 25) {
  const term = (query || '').trim().toLowerCase()
  if (term.length < 2) return []

  const rows = getDb().prepare(`SELECT json FROM DestinyActivityDefinition`).all()
  const results = []
  for (const row of rows) {
    const def = parseRow(row)
    const name = def?.displayProperties?.name
    if (!name || def.redacted) continue
    if (!name.toLowerCase().includes(term)) continue
    results.push({
      activityHash: def.hash,
      name,
      light: def.activityLightLevel || 0
    })
  }

  results.sort((a, b) => {
    const an = a.name.toLowerCase()
    const bn = b.name.toLowerCase()
    const score = (n) => (n === term ? 0 : n.startsWith(term) ? 1 : 2)
    return score(an) - score(bn) || an.localeCompare(bn)
  })
  return results.slice(0, limit)
}

/**
 * Resolves a collectible's human-readable source string(s) from the
 * DestinyCollectibleDefinition table. Returns an array (often length 1).
 */
function resolveSources(collectibleHash) {
  try {
    const signed = collectibleHash | 0 // to signed 32-bit, matching the `id` column
    const row = getDb()
      .prepare(`SELECT json FROM DestinyCollectibleDefinition WHERE id = ?`)
      .get(signed)
    const def = parseRow(row)
    // Bungie's sourceString usually starts with "Source:" — strip it so the UI's
    // own "SOURCE:" label doesn't render "SOURCE: Source: …".
    const sourceString = (def?.sourceString || '').replace(/^\s*source:\s*/i, '').trim()
    return sourceString ? [sourceString] : []
  } catch {
    return []
  }
}

/**
 * Looks up a single item definition by its unsigned itemHash.
 */
export function getItemByHash(itemHash) {
  const signed = itemHash | 0
  const row = getDb().prepare(`SELECT json FROM ${ITEM_TABLE} WHERE id = ?`).get(signed)
  return parseRow(row)
}

/**
 * Returns the weapon ornaments available for a given weapon, by walking its
 * "WEAPON COSMETICS" socket → reusable plug set → plug items, keeping only real
 * weapon ornaments (`traitIds` includes `item.ornament.weapon`).
 *
 * This is the same socket walk that was Manifest-verified for the Eververse
 * tracker (it reproduces The Last Word's four ornaments exactly). Returns [] for
 * non-weapons or weapons with no cosmetic socket, so the renderer panel self-hides.
 *
 * Each entry: { itemHash, name, icon, plugCategory, source, eververse }.
 * `source` is the collectible sourceString (e.g. "Eververse"); `eververse` is a
 * convenience flag for the ones the Eververse shop tracker can alert on.
 */
export function getWeaponOrnaments(weaponHash) {
  const weapon = getItemByHash(weaponHash)
  if (!weapon?.sockets) return []

  // Resolve which socket indexes belong to the "WEAPON COSMETICS" category.
  const db = getDb()
  const cosmeticIdx = new Set()
  for (const sc of weapon.sockets.socketCategories || []) {
    const catRow = db
      .prepare(`SELECT json FROM DestinySocketCategoryDefinition WHERE id = ?`)
      .get(sc.socketCategoryHash | 0)
    const cat = parseRow(catRow)
    if ((cat?.displayProperties?.name || '').toUpperCase() === 'WEAPON COSMETICS') {
      for (const i of sc.socketIndexes || []) cosmeticIdx.add(i)
    }
  }
  if (cosmeticIdx.size === 0) return []

  const entries = weapon.sockets.socketEntries || []
  const out = []
  const seen = new Set()
  for (const idx of cosmeticIdx) {
    const entry = entries[idx]
    if (!entry?.reusablePlugSetHash) continue
    const psRow = db
      .prepare(`SELECT json FROM DestinyPlugSetDefinition WHERE id = ?`)
      .get(entry.reusablePlugSetHash | 0)
    const plugSet = parseRow(psRow)
    for (const p of plugSet?.reusablePlugItems || []) {
      const def = getItemByHash(p.plugItemHash)
      if (!(def?.traitIds || []).includes('item.ornament.weapon')) continue
      if (seen.has(def.hash)) continue
      seen.add(def.hash)
      const source = def.collectibleHash ? resolveSources(def.collectibleHash)[0] || '' : ''
      out.push({
        itemHash: def.hash,
        name: def.displayProperties?.name || '',
        icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : null,
        plugCategory: def.plug?.plugCategoryIdentifier || null,
        source,
        eververse: /eververse/i.test(source)
      })
    }
  }
  return out
}

// Plug categories that aren't real "perks" (empty sockets, kill/memento trackers,
// shaders, crafting bookkeeping) — filtered out of the perk-pool walk.
const NON_PERK_PLUG = /empty_socket|tracker|memento|shader|deprecated|masterworks\.stat/i

/**
 * Lazily-built index of exotic *catalyst* Triumph records, keyed by the lowercased
 * weapon name (records are named "<Weapon> Catalyst"). Built once per process from
 * DestinyRecordDefinition — the catalyst's source/effect and completion objectives
 * live on the Triumph, not on the weapon's masterwork plug.
 */
let catalystIndex = null
function getCatalystIndex() {
  if (catalystIndex) return catalystIndex
  catalystIndex = new Map()
  try {
    const rows = getDb().prepare(`SELECT json FROM DestinyRecordDefinition`).all()
    for (const row of rows) {
      const d = parseRow(row)
      const name = d?.displayProperties?.name || ''
      const m = /^(.+) Catalyst$/.exec(name)
      if (!m || !(d.objectiveHashes || []).length) continue
      catalystIndex.set(m[1].toLowerCase(), d)
    }
  } catch {
    /* leave the (possibly partial) index; lookups just miss */
  }
  return catalystIndex
}

/** Resolves an exotic weapon's catalyst (record description + objectives), or null. */
function resolveCatalyst(weaponName) {
  const rec = getCatalystIndex().get((weaponName || '').toLowerCase())
  if (!rec) return null
  const db = getDb()
  const objectives = []
  for (const oh of rec.objectiveHashes || []) {
    const o = parseRow(db.prepare(`SELECT json FROM DestinyObjectiveDefinition WHERE id = ?`).get(oh | 0))
    if (!o) continue
    // valueStyle 2 = Checkbox — a binary step (e.g. "Insert the Catalyst"), not a
    // counter, so its completionValue is meaningless to display as a number.
    const checkbox = o.valueStyle === 2 || o.completedValueStyle === 2
    objectives.push({
      description: (o.progressDescription || '').trim() || 'Progress',
      target: o.completionValue || 0,
      checkbox
    })
  }
  return {
    name: rec.displayProperties.name,
    description: (rec.displayProperties.description || '').trim(),
    icon: rec.displayProperties.icon ? `${BUNGIE_ROOT}${rec.displayProperties.icon}` : null,
    objectives
  }
}

/** Shapes a plug item def into a perk-pool entry, or null if it's not a real perk. */
function perkEntry(def) {
  if (!def) return null
  const pci = def.plug?.plugCategoryIdentifier || ''
  const name = def.displayProperties?.name || ''
  if (!name || /^empty /i.test(name) || NON_PERK_PLUG.test(pci)) return null
  return {
    itemHash: def.hash,
    name,
    description: (def.displayProperties?.description || '').trim(),
    icon: def.displayProperties?.icon ? `${BUNGIE_ROOT}${def.displayProperties.icon}` : null,
    category: pci
  }
}

/** Derives a human column label from the dominant plug category of its perks. */
function columnLabel(category) {
  const c = category || ''
  if (/barrel|blade|scope|haft|bowstring|launcher_barrel|tube|sight/i.test(c)) return 'Barrel / Sight'
  if (/magazine|batter|guard|ammunition|arrow|magwell/i.test(c)) return 'Magazine'
  if (/grip|stock/i.test(c)) return 'Grip / Stock'
  if (/origin/i.test(c)) return 'Origin Trait'
  if (/intrinsic/i.test(c)) return 'Intrinsic'
  if (/frame|trait/i.test(c)) return 'Trait'
  return 'Perk'
}

/**
 * Returns the factual perk data for a weapon, for the on-card "catalyst + perks"
 * panel. NOT a god-roll recommendation (those are community opinion and live on
 * light.gg) — this is purely what the Manifest says: the weapon's intrinsic, the
 * real per-column perk pool (random rolls when present, else the fixed/curated
 * perks), and the exotic catalyst's objectives. Returns empty for non-weapons.
 *
 * @returns {{ catalyst: object|null, intrinsic: object|null, columns: Array<{label,random,perks:object[]}> }}
 */
export function getWeaponPerks(weaponHash) {
  const weapon = getItemByHash(weaponHash)
  const empty = { catalyst: null, intrinsic: null, columns: [] }
  if (!weapon || weapon.itemType !== 3 || !weapon.sockets) return empty // itemType 3 = weapon

  const db = getDb()
  // Map each socket category name → the socket indexes it owns.
  const idxByCat = {}
  for (const sc of weapon.sockets.socketCategories || []) {
    const cat = parseRow(
      db.prepare(`SELECT json FROM DestinySocketCategoryDefinition WHERE id = ?`).get(sc.socketCategoryHash | 0)
    )
    const nm = (cat?.displayProperties?.name || '').toUpperCase()
    if (nm) idxByCat[nm] = [...(idxByCat[nm] || []), ...(sc.socketIndexes || [])]
  }
  const entries = weapon.sockets.socketEntries || []

  // Resolves a socket entry to its distinct, real perks (random pool preferred).
  const perksFor = (entry) => {
    if (!entry) return []
    const setHash = entry.randomizedPlugSetHash || entry.reusablePlugSetHash
    const out = []
    const seen = new Set()
    if (setHash) {
      const ps = parseRow(db.prepare(`SELECT json FROM DestinyPlugSetDefinition WHERE id = ?`).get(setHash | 0))
      for (const p of ps?.reusablePlugItems || []) {
        if (p.currentlyCanRoll === false || seen.has(p.plugItemHash)) continue
        seen.add(p.plugItemHash)
        const e = perkEntry(getItemByHash(p.plugItemHash))
        if (e) out.push(e)
      }
    } else if (entry.singleInitialItemHash) {
      const e = perkEntry(getItemByHash(entry.singleInitialItemHash))
      if (e) out.push(e)
    }
    return out
  }

  // Intrinsic trait (the exotic's signature effect, or a legendary's frame).
  let intrinsic = null
  for (const i of idxByCat['INTRINSIC TRAITS'] || []) {
    const got = perksFor(entries[i])
    if (got.length) { intrinsic = got[0]; break }
  }

  // The selectable perk columns.
  const columns = []
  for (const i of (idxByCat['WEAPON PERKS'] || []).slice().sort((a, b) => a - b)) {
    const entry = entries[i]
    const perks = perksFor(entry)
    if (!perks.length) continue
    columns.push({ label: columnLabel(perks[0].category), random: !!entry.randomizedPlugSetHash, perks })
  }
  // Disambiguate repeated labels (e.g. the two trait columns → "Trait 1" / "Trait 2").
  const labelCounts = {}
  for (const c of columns) labelCounts[c.label] = (labelCounts[c.label] || 0) + 1
  const labelSeen = {}
  for (const c of columns) {
    if (labelCounts[c.label] > 1) {
      labelSeen[c.label] = (labelSeen[c.label] || 0) + 1
      c.label = `${c.label} ${labelSeen[c.label]}`
    }
  }

  return { catalyst: resolveCatalyst(weapon.displayProperties?.name), intrinsic, columns }
}
