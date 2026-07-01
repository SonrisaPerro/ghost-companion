// =============================================================================
// rotations.js — resolves the weekly rotators the Bungie API does NOT expose:
// the featured raid pair, the featured dungeon pair, and the weekly Grandmaster
// Alert (+ its farmable weapon). These are community-tracked; Bungie's public
// milestones list which raids are *available* (see milestones.js) but not which
// are *featured/farmable* this week, and dungeons/GM aren't surfaced at all.
//
// Two layers, both honest (never fabricate an ordering we can't prove):
//   1. SEED — an explicit per-week table (data/rotations.json), keyed by the
//      weekly-reset ISO. Hand-verified entries (verified:true) take precedence.
//   2. AUTO-REFRESH — for a current week that's NOT seeded, we fetch it once
//      from a vetted community source (rotations-source.js), validate it hard,
//      and cache it in-memory. Failures leave source:'unknown' (UI hides the
//      card) — a scrape can only ever add data, never wrong data.
// We do NOT extrapolate future weeks (no verifiable ordered cycle exists).
//
//   - source 'computed' → this week is known (seeded or successfully fetched)
//   - source 'unknown'  → not yet known for this reset week; caller hides/softens
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastResetISO } from './config.js'
import { fetchWeek } from './rotations-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROTATIONS_FILE = path.join(__dirname, '..', 'data', 'rotations.json')

// Don't re-hit the source more than this often after a miss/failure for a given
// week — bounds load and avoids hammering on a persistent parse failure.
const RETRY_AFTER_MS = 30 * 60 * 1000

let table = null
const inFlight = new Map() // weekOf -> Promise (coalesces concurrent fetches)
const lastAttempt = new Map() // weekOf -> ms of last fetch attempt (negative cache)

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

/** A week's GM Alert, tolerating the pre-Edge-of-Fate `grandmasterNightfall` key. */
function gmOf(wk) {
  return wk.grandmasterAlert || wk.grandmasterNightfall || null
}

/**
 * Resolve this week's featured rotators from whatever is currently known
 * (seed table + any already-fetched week). Synchronous — does NOT fetch; call
 * ensureRotations() first if you want the auto-refresh to run.
 * @param {Date} [now] — clock to resolve against (injectable for tests).
 * @returns {{ source:'computed'|'unknown', weekOf:string, verified:boolean,
 *             featuredRaids:string[], featuredDungeons:string[],
 *             grandmasterAlert:{activity:string,weapon:string}|null,
 *             origin:'seed'|'kyberscorner'|null }}
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
      grandmasterAlert: null,
      origin: null
    }
  }

  return {
    source: 'computed',
    weekOf,
    verified: wk.verified === true,
    featuredRaids: wk.featuredRaids || [],
    featuredDungeons: wk.featuredDungeons || [],
    grandmasterAlert: gmOf(wk),
    origin: wk.source || 'seed'
  }
}

/**
 * Fetch the given week from the vetted source and upsert it into the in-memory
 * table (kept in-memory only; the committed rotations.json stays the seed).
 * Coalesced + negative-cached so we hit the source at most once per RETRY window.
 */
async function ensureWeek(weekOf) {
  if (inFlight.has(weekOf)) return inFlight.get(weekOf)
  const last = lastAttempt.get(weekOf) || 0
  if (Date.now() - last < RETRY_AFTER_MS) return null

  const p = (async () => {
    lastAttempt.set(weekOf, Date.now())
    const week = await fetchWeek(weekOf)
    if (week) {
      const t = table || loadRotations()
      t.weeks = t.weeks || {}
      t.weeks[weekOf] = week
      console.log('[rotations] fetched featured week', weekOf, 'from', week.source)
    }
    return week
  })().finally(() => inFlight.delete(weekOf))

  inFlight.set(weekOf, p)
  return p
}

/**
 * Like resolveRotations(), but first triggers an auto-refresh from the vetted
 * source when the current week isn't seeded. Await this from request handlers.
 */
export async function ensureRotations(now = new Date()) {
  const weekOf = lastResetISO(now)
  const t = table || loadRotations()
  if (!(t.weeks && t.weeks[weekOf])) {
    await ensureWeek(weekOf)
  }
  return resolveRotations(now)
}

// Warm the table on import so the first request doesn't pay the read.
loadRotations()
