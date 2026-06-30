// =============================================================================
// guides.js — community guide-package library (read-only).
//
// Loads every server/data/guides/*.ghostpkg.json file we ship, sanity-checks it
// against the same hard limits the client enforces, and exposes:
//   • getGuidesIndex() — lightweight metadata list for the browse view.
//   • getGuidePackage(id) — the full package envelope for one library entry.
//
// These packages are CURATED by us and committed to the repo — the endpoint is
// read-only and never ingests user uploads. The desktop client still re-runs its
// own validatePackage() on whatever it fetches (defense in depth), so this loader
// is a build-time sanity gate, not the trust boundary.
//
// LIMITS mirrors src/main/packages.js — keep the two in sync. (The client lives
// in a different deploy root, so we can't share the module directly.)
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'

export const LIMITS = {
  PACKAGE_BYTES: 512 * 1024,
  GUIDES: 200,
  STEPS: 60,
  ID: 128,
  NAME: 200,
  TITLE: 200,
  STEP_TITLE: 200,
  STEP_DESC: 2000,
  NOTES: 4000
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

let index = [] // [{ id, name, description, author, guideCount, bytes, updatedAt }]
const packagesById = new Map() // id -> full envelope { ghostPackage, name, ..., guides }

/** Shallow check that a parsed package is structurally sane and within limits. */
function packageIsSane(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  if (obj.ghostPackage !== 1) return false
  if (!Array.isArray(obj.guides) || obj.guides.length > LIMITS.GUIDES) return false
  for (const g of obj.guides) {
    if (!g || typeof g !== 'object') return false
    if (typeof g.id !== 'string' || g.id.length > LIMITS.ID || !ID_RE.test(g.id)) return false
    if (typeof g.title !== 'string' || !g.title.trim() || g.title.length > LIMITS.TITLE) return false
    if (Array.isArray(g.steps) && g.steps.length > LIMITS.STEPS) return false
  }
  return true
}

/**
 * (Re)loads all packages from `dir`. Malformed or oversized files are skipped
 * with a console warning so one bad file never takes down the endpoint.
 * @returns {number} count of packages loaded.
 */
export function loadGuides(dir) {
  const nextIndex = []
  packagesById.clear()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.ghostpkg.json'))
  } catch {
    index = []
    return 0
  }

  for (const file of files) {
    const full = path.join(dir, file)
    try {
      const stat = fs.statSync(full)
      if (stat.size > LIMITS.PACKAGE_BYTES) {
        console.warn(`[guides] skipping ${file}: exceeds size cap`)
        continue
      }
      const text = fs.readFileSync(full, 'utf8')
      const obj = JSON.parse(text)
      if (!packageIsSane(obj)) {
        console.warn(`[guides] skipping ${file}: failed sanity check`)
        continue
      }
      // The library id is the filename slug — stable, URL-safe, decoupled from
      // the human-readable package name.
      const id = file.replace(/\.ghostpkg\.json$/, '')
      if (!ID_RE.test(id) || packagesById.has(id)) {
        console.warn(`[guides] skipping ${file}: bad or duplicate id`)
        continue
      }
      const envelope = {
        ghostPackage: 1,
        name: String(obj.name || id),
        description: obj.description ? String(obj.description).slice(0, LIMITS.NOTES) : null,
        author: obj.author ? String(obj.author).slice(0, LIMITS.NAME) : null,
        guides: obj.guides
      }
      packagesById.set(id, envelope)
      nextIndex.push({
        id,
        name: envelope.name,
        description: envelope.description,
        author: envelope.author,
        guideCount: obj.guides.length,
        bytes: Buffer.byteLength(text, 'utf8'),
        updatedAt: obj.createdAt || stat.mtime.toISOString()
      })
    } catch (e) {
      console.warn(`[guides] skipping ${file}: ${e.message}`)
    }
  }

  nextIndex.sort((a, b) => a.name.localeCompare(b.name))
  index = nextIndex
  return index.length
}

/** Lightweight metadata list for the browse view (no steps). */
export function getGuidesIndex() {
  return { count: index.length, packages: index }
}

/** Full package envelope for one library id, or null. */
export function getGuidePackage(id) {
  return packagesById.get(id) || null
}
