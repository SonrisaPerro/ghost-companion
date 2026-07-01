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
const cache = {
  xur: null, xurAt: 0,
  paths: null, pathsAt: 0,
  eververse: null, eververseAt: 0,
  banshee: null, bansheeAt: 0,
  weekly: null, weeklyAt: 0,
  guides: null, guidesAt: 0
}

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

/** Returns the cached Xûr payload, fetching if stale. null if no URL / unreachable. */
export async function getXur(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return null
  if (!force && cache.xur && Date.now() - cache.xurAt < TTL_MS) return cache.xur
  try {
    cache.xur = await getJson(`${url}/xur`)
    cache.xurAt = Date.now()
  } catch (err) {
    console.error('[data-api] xur fetch failed:', err.message)
    if (!cache.xur) return null // nothing cached to fall back on
  }
  return cache.xur
}

/**
 * Returns the cached Eververse ornament-shop payload, fetching if stale.
 * Shape mirrors the server's /eververse: { source, vendor, anyInShop, inShop[],
 * notInShop[], ... }. null if no URL / unreachable — the panel just stays hidden.
 */
export async function getEververse(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return null
  if (!force && cache.eververse && Date.now() - cache.eververseAt < TTL_MS) return cache.eververse
  try {
    cache.eververse = await getJson(`${url}/eververse`)
    cache.eververseAt = Date.now()
  } catch (err) {
    console.error('[data-api] eververse fetch failed:', err.message)
    if (!cache.eververse) return null // nothing cached to fall back on
  }
  return cache.eververse
}

/**
 * Returns the cached Banshee-44 payload, fetching if stale. Shape mirrors the
 * server's /banshee: { source, present, location, weapons[] }. null if no URL /
 * unreachable.
 */
export async function getBanshee(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return null
  if (!force && cache.banshee && Date.now() - cache.bansheeAt < TTL_MS) return cache.banshee
  try {
    cache.banshee = await getJson(`${url}/banshee`)
    cache.bansheeAt = Date.now()
  } catch (err) {
    console.error('[data-api] banshee fetch failed:', err.message)
    if (!cache.banshee) return null // nothing cached to fall back on
  }
  return cache.banshee
}

/**
 * Returns the cached "This Week" concierge payload, fetching if stale. Shape
 * mirrors the server's /weekly: { weekOf, resetsAt, xur, eververse, activities }.
 * null if no URL / unreachable — the panel just stays hidden.
 */
export async function getWeekly(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return null
  if (!force && cache.weekly && Date.now() - cache.weeklyAt < TTL_MS) return cache.weekly
  try {
    cache.weekly = await getJson(`${url}/weekly`)
    cache.weeklyAt = Date.now()
  } catch (err) {
    console.error('[data-api] weekly fetch failed:', err.message)
    if (!cache.weekly) return null // nothing cached to fall back on
  }
  return cache.weekly
}

/**
 * Returns the community guide-library index ({ count, packages[] }), or an empty
 * index if no URL / unreachable. Cached briefly — the browse list is small.
 */
export async function getCommunityGuides(store, { force = false } = {}) {
  const url = baseUrl(store)
  if (!url) return { count: 0, packages: [] }
  if (!force && cache.guides && Date.now() - cache.guidesAt < TTL_MS) return cache.guides
  try {
    cache.guides = await getJson(`${url}/guides`)
    cache.guidesAt = Date.now()
  } catch (err) {
    console.error('[data-api] guides index fetch failed:', err.message)
    if (!cache.guides) return { count: 0, packages: [] }
  }
  return cache.guides
}

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
