// =============================================================================
// rotations.js — resolves the weekly rotators the Bungie API does NOT expose:
// the featured raid pair, the featured dungeon pair, and the Grand Master
// Nightfall (+ its farmable reward). These are community-tracked; Bungie's
// public milestones list which raids are *available* (see milestones.js) but not
// which are *featured/farmable* this week, and dungeons/GM aren't surfaced at all.
//
// Design (deliberately honest over clever): this reads an EXPLICIT per-week
// lookup table (data/rotations.json) keyed by the weekly-reset ISO. It only
// answers for weeks that have been verified and entered — it never extrapolates
// an ordering it can't prove. When a verified ordered-list + anchor exists, the
// lookup here can be swapped for modular arithmetic without touching callers.
//
//   - source 'computed' → this week is present in the table (verified data)
//   - source 'unknown'  → no entry for this reset week; caller should hide/soften
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastResetISO } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROTATIONS_FILE = path.join(__dirname, '..', 'data', 'rotations.json')

let table = null

/** Load (or reload) the rotations table from disk. Returns the parsed object. */
export function loadRotations() {
  try {
    table = JSON.parse(fs.readFileSync(ROTATIONS_FILE, 'utf8'))
  } catch (e) {
    console.error('[rotations] failed to load:', e.message)
    table = { schema: 1, weeks: {} }
  }
  return table
}

/**
 * Resolve this week's featured rotators.
 * @param {Date} [now] — clock to resolve against (injectable for tests).
 * @returns {{ source:'computed'|'unknown', weekOf:string, verified:boolean,
 *             featuredRaids:string[], featuredDungeons:string[],
 *             grandmasterNightfall:{activity:string,weapon:string}|null }}
 */
export function resolveRotations(now = new Date()) {
  const weekOf = lastResetISO(now)
  const t = table || loadRotations()
  const wk = t.weeks && t.weeks[weekOf]

  if (!wk) {
    return {
      source: 'unknown',
      weekOf,
      verified: false,
      featuredRaids: [],
      featuredDungeons: [],
      grandmasterNightfall: null
    }
  }

  return {
    source: 'computed',
    weekOf,
    verified: wk.verified === true,
    featuredRaids: wk.featuredRaids || [],
    featuredDungeons: wk.featuredDungeons || [],
    grandmasterNightfall: wk.grandmasterNightfall || null
  }
}

// Warm the table on import so the first request doesn't pay the read.
loadRotations()
