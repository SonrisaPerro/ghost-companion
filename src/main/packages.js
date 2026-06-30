// =============================================================================
// packages.js — guide / secret-chest data packages
// Pure (no I/O) validation + merge logic for shareable "*.ghostpkg.json" files,
// so it can be unit-tested in isolation. A package bundles one or more guides;
// each guide can be linked to an item (by itemHash) so it surfaces on that
// item's card, or stand alone as an activity walkthrough.
// =============================================================================

export const SCHEMA_VERSION = 1

/**
 * Validates and normalizes a parsed package object.
 * @returns {{ ok: true, name: string, guides: object[] } | { ok: false, errors: string[] }}
 */
export function validatePackage(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['File is not a JSON object.'] }
  }

  const errors = []
  if (obj.ghostPackage !== SCHEMA_VERSION) {
    errors.push(`Unsupported or missing "ghostPackage" version (expected ${SCHEMA_VERSION}).`)
  }
  if (!Array.isArray(obj.guides)) {
    errors.push('Package is missing a "guides" array.')
  }

  const guides = []
  const seenIds = new Set()
  const rawGuides = Array.isArray(obj.guides) ? obj.guides : []
  for (const [i, g] of rawGuides.entries()) {
    if (!g || typeof g !== 'object') {
      errors.push(`Guide ${i}: not an object.`)
      continue
    }
    if (typeof g.id !== 'string' || !g.id.trim()) {
      errors.push(`Guide ${i}: missing a string "id".`)
      continue
    }
    if (typeof g.title !== 'string' || !g.title.trim()) {
      errors.push(`Guide "${g.id}": missing a "title".`)
      continue
    }
    if (seenIds.has(g.id)) {
      errors.push(`Guide "${g.id}": duplicate id within the package.`)
      continue
    }
    seenIds.add(g.id)

    const steps = Array.isArray(g.steps)
      ? g.steps
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({ title: String(s.title || ''), description: String(s.description || '') }))
      : []

    guides.push({
      id: g.id.trim(),
      title: g.title.trim(),
      type: g.type === 'secret_chest' ? 'secret_chest' : 'guide',
      itemHash: toHashOrNull(g.itemHash),
      item: g.item ? String(g.item) : null,
      activity: g.activity ? String(g.activity) : null,
      activityHash: toHashOrNull(g.activityHash),
      steps,
      notes: g.notes ? String(g.notes) : null,
      source: obj.name ? String(obj.name) : null
    })
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, name: obj.name ? String(obj.name) : 'Imported package', guides }
}

function toHashOrNull(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Merges incoming guides into the existing set, deduped by id (incoming wins).
 * @returns {{ guides: object[], added: number, updated: number }}
 */
export function mergeGuides(existing, incoming) {
  const map = new Map((existing || []).map((g) => [g.id, g]))
  let added = 0
  let updated = 0
  for (const g of incoming || []) {
    if (map.has(g.id)) updated++
    else added++
    map.set(g.id, g)
  }
  return { guides: [...map.values()], added, updated }
}

/** Wraps a guide list in the on-disk package envelope for export. */
export function buildExport(guides, name = 'Ghost Companion export') {
  return {
    ghostPackage: SCHEMA_VERSION,
    name,
    createdAt: new Date().toISOString(),
    guides: guides || []
  }
}
