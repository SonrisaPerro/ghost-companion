// =============================================================================
// data-api.js — talks to the Ghost Companion data API (the Railway service).
//
// Two pieces of remote data, both cached in-memory:
//   • /rotation — this week's global Nightfall/Trials featured weapon + the
//                 activity-hash pools that count as a run.
//   • /paths    — community acquisition-path data, merged under the user's own.
//
// Everything is best-effort: if the API URL is unset or unreachable, callers get
// null/empty and the app keeps working on bundled data alone.
// =============================================================================

import fetch from 'node-fetch'

const TTL_MS = 60 * 60 * 1000 // cache remote data for an hour
const cache = { rotation: null, rotationAt: 0, paths: null, pathsAt: 0 }

function baseUrl(store) {
  const url = process.env.GHOST_DATA_API_URL || store.get('dataApiUrl') || ''
  return url.replace(/\/+$/, '') // trim trailing slash
}

async function getJson(url) {
  const res = await fetch(url, { timeout: 8000 })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Returns the cached rotation, fetching if stale. null if no URL / unreachable. */
export async function getRotation(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return null
  if (!force && cache.rotation && Date.now() - cache.rotationAt < TTL_MS) return cache.rotation
  try {
    cache.rotation = await getJson(`${url}/rotation`)
    cache.rotationAt = Date.now()
  } catch (err) {
    console.error('[data-api] rotation fetch failed:', err.message)
    if (!cache.rotation) return null // nothing cached to fall back on
  }
  return cache.rotation
}

/** Returns community paths (keyed by item name), or {} if unavailable. */
export async function getCommunityPaths(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return {}
  if (!force && cache.paths && Date.now() - cache.pathsAt < TTL_MS) return cache.paths
  try {
    cache.paths = await getJson(`${url}/paths`)
    cache.pathsAt = Date.now()
  } catch (err) {
    console.error('[data-api] paths fetch failed:', err.message)
    if (!cache.paths) return {}
  }
  return cache.paths
}
