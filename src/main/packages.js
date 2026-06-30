// =============================================================================
// packages.js — guide / secret-chest data packages
// Pure (no I/O) validation + merge logic for shareable "*.ghostpkg.json" files,
// so it can be unit-tested in isolation. A package bundles one or more guides;
// each guide can be linked to an item (by itemHash) so it surfaces on that
// item's card, or stand alone as an activity walkthrough.
//
// SECURITY: packages can arrive from anywhere — a dragged-in file, a file
// picker, or the community library endpoint. This module is the trust boundary:
// it REJECTS anything past the hard limits below so a hostile/huge file can't
// blow up the renderer or balloon the on-disk store. Strings are length-capped,
// counts are bounded, and ids must be slugs (they become Map/store keys).
// Reject-not-truncate keeps behaviour predictable and surfaces a clear error.
// NOTE: the data API server enforces an identical mirror of LIMITS in
// server/src/guides.js — keep the two in sync if you change anything here.
// =============================================================================

export const SCHEMA_VERSION = 1

// Hard caps. Generous enough for real community packs (the bundled Vesper's Host
// example is ~2 KB / 3 guides), tight enough to bound memory + store growth.
export const LIMITS = {
  PACKAGE_BYTES: 512 * 1024, // raw JSON text — enforced at the import boundary
  GUIDES: 200, // guides per package
  STEPS: 60, // steps per guide
  ID: 128, // guide id length
  NAME: 200, // package / step title / item / activity
  TITLE: 200, // guide title
  STEP_TITLE: 200,
  STEP_DESC: 2000,
  NOTES: 4000
}

// Guide ids become store keys and Map keys, so constrain them to a safe slug
// charset (no path separators, no control chars, no whitespace surprises).
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** True if raw package text is within the byte cap. Cheap pre-parse gate. */
export function withinSizeLimit(text) {
  // Byte length, not char length — multibyte content shouldn't sneak past.
  return Buffer.byteLength(String(text ?? ''), 'utf8') <= LIMITS.PACKAGE_BYTES
}

/** Trims a value to a string and reports whether it exceeds `max`. */
function str(v) {
  return v == null ? '' : String(v)
}

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

  const name = str(obj.name).trim()
  if (name.length > LIMITS.NAME) {
    errors.push(`Package "name" exceeds ${LIMITS.NAME} characters.`)
  }
  if (Array.isArray(obj.guides) && obj.guides.length > LIMITS.GUIDES) {
    errors.push(`Package has too many guides (max ${LIMITS.GUIDES}).`)
  }

  const guides = []
  const seenIds = new Set()
  const rawGuides = Array.isArray(obj.guides) ? obj.guides.slice(0, LIMITS.GUIDES) : []
  for (const [i, g] of rawGuides.entries()) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) {
      errors.push(`Guide ${i}: not an object.`)
      continue
    }
    const id = str(g.id).trim()
    if (!id) {
      errors.push(`Guide ${i}: missing a string "id".`)
      continue
    }
    if (id.length > LIMITS.ID || !ID_RE.test(id)) {
      errors.push(`Guide "${id.slice(0, 32)}": invalid id (letters/digits/.-_ only, max ${LIMITS.ID}).`)
      continue
    }
    const title = str(g.title).trim()
    if (!title) {
      errors.push(`Guide "${id}": missing a "title".`)
      continue
    }
    if (title.length > LIMITS.TITLE) {
      errors.push(`Guide "${id}": title exceeds ${LIMITS.TITLE} characters.`)
      continue
    }
    if (seenIds.has(id)) {
      errors.push(`Guide "${id}": duplicate id within the package.`)
      continue
    }

    // Bounded fields.
    if (str(g.notes).length > LIMITS.NOTES) {
      errors.push(`Guide "${id}": notes exceed ${LIMITS.NOTES} characters.`)
      continue
    }
    for (const [field, cap] of [['item', LIMITS.NAME], ['activity', LIMITS.NAME]]) {
      if (str(g[field]).length > cap) {
        errors.push(`Guide "${id}": ${field} exceeds ${cap} characters.`)
      }
    }
    if (Array.isArray(g.steps) && g.steps.length > LIMITS.STEPS) {
      errors.push(`Guide "${id}": too many steps (max ${LIMITS.STEPS}).`)
      continue
    }

    let stepErr = false
    const steps = Array.isArray(g.steps)
      ? g.steps
          .filter((s) => s && typeof s === 'object')
          .map((s) => {
            const t = str(s.title)
            const d = str(s.description)
            if (t.length > LIMITS.STEP_TITLE || d.length > LIMITS.STEP_DESC) stepErr = true
            return { title: t, description: d }
          })
      : []
    if (stepErr) {
      errors.push(`Guide "${id}": a step exceeds the length limit.`)
      continue
    }

    if (errors.length) continue // a non-step error above flagged this guide
    seenIds.add(id)
    guides.push({
      id,
      title,
      type: g.type === 'secret_chest' ? 'secret_chest' : 'guide',
      itemHash: toHashOrNull(g.itemHash),
      item: g.item ? str(g.item) : null,
      activity: g.activity ? str(g.activity) : null,
      activityHash: toHashOrNull(g.activityHash),
      steps,
      notes: g.notes ? str(g.notes) : null,
      source: name || null
    })
  }

  if (errors.length) return { ok: false, errors }
  return { ok: true, name: name || 'Imported package', guides }
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
