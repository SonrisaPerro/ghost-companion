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
    const sourceString = def?.sourceString
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
