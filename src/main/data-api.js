// =============================================================================
// data-api.js — talks to the Ghost Companion data API (the Railway service).
//
// Two pieces of remote data, both cached in-memory:
//   • /xur   — Xûr's live weekly exotic stock + authoritative presence.
//   • /paths — community acquisition-path data, merged under the user's own.
//
// Everything is best-effort: if the API URL is unset or unreachable, callers get
// null/empty and the app keeps working on bundled data alone.
// =============================================================================

import fetch from 'node-fetch'

const TTL_MS = 60 * 60 * 1000 // cache remote data for an hour
const cache = {}

function baseUrl(store) {
  let url = (process.env.GHOST_DATA_API_URL || store.get('dataApiUrl') || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url // tolerate a bare host (no scheme)
  return url.replace(/\/+$/, '') // trim trailing slash
}

async function getJson(url) {
  const res = await fetch(url, { timeout: 8000 })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Factory for the standard cached-endpoint pattern:
// check URL → check TTL → try fetch → catch with stale fallback → return.
function cachedEndpoint(key, urlPath, fallback) {
  return async function (store, { force = false } = {}) {
    const url = baseUrl(store)
    if (!url) return typeof fallback === 'function' ? fallback() : fallback
    const atKey = key + 'At'
    if (!force && cache[key] && (cache[atKey] || 0) + TTL_MS > Date.now()) return cache[key]
    try {
      cache[key] = await getJson(`${url}/${urlPath}`)
      cache[atKey] = Date.now()
    } catch (err) {
      console.error(`[data-api] ${key} fetch failed:`, err.message)
      if (!cache[key]) return typeof fallback === 'function' ? fallback() : fallback
    }
    return cache[key]
  }
}

export const getXur            = cachedEndpoint('xur',      'xur',      null)
export const getEververse      = cachedEndpoint('eververse','eververse', null)
export const getBanshee        = cachedEndpoint('banshee',  'banshee',  null)
export const getWeekly         = cachedEndpoint('weekly',   'weekly',   null)
export const getCommunityGuides = cachedEndpoint('guides',  'guides',   () => ({ count: 0, packages: [] }))
export const getCommunityPaths  = cachedEndpoint('paths',   'paths',    () => ({}))

/**
 * Fetches one full guide package from the library by id. Not cached (it's a
 * one-shot fetch the importer immediately re-validates and merges). The id is
 * slug-constrained before it ever hits the URL. Returns the package object, or
 * null if unreachable / not found.
 */
export async function getCommunityGuidePackage(store, id) {
  const url = baseUrl(store)
  if (!url) return null
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.length > 128) {
    return null
  }
  try {
    return await getJson(`${url}/guides/${encodeURIComponent(id)}`)
  } catch (err) {
    console.error('[data-api] guide package fetch failed:', err.message)
    return null
  }
}
