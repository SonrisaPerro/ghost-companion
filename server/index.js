// =============================================================================
// index.js — Ghost Companion data API (Express).
//
// Endpoints:
//   GET /health    — liveness probe
//   GET /xur       — Xûr's live weekly exotic stock + presence (cached)
//   GET /monument  — Monument to Lost Lights exotic archive catalog (cached)
//   GET /eververse — tracked weapon ornaments currently for sale in Eververse (cached)
//   GET /paths     — community acquisition-path data (read-only)
//   GET /guides     — community guide-package library index (read-only)
//   GET /guides/:id — one full guide package from the library
//
// Designed for Railway: binds to process.env.PORT. Xûr's stock is resolved once
// and cached (it's identical for everyone until his inventory rotates), so client
// fan-out never hits Bungie directly.
// =============================================================================

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveXur } from './src/xur.js'
import { resolveMonument } from './src/monument.js'
import { resolveEververse } from './src/eververse.js'
import { loadGuides, getGuidesIndex, getGuidePackage } from './src/guides.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// --- /paths : community acquisition data ------------------------------------
const PATHS_FILE = path.join(__dirname, 'data', 'paths.json')
let pathsCache = null
function loadPaths() {
  try {
    pathsCache = JSON.parse(fs.readFileSync(PATHS_FILE, 'utf8'))
  } catch (e) {
    console.error('[paths] failed to load:', e.message)
    pathsCache = {}
  }
  return pathsCache
}
loadPaths()

// --- /guides : community guide-package library ------------------------------
const GUIDES_DIR = path.join(__dirname, 'data', 'guides')
let guidesCount = loadGuides(GUIDES_DIR)

// --- /xur : cached live resolve ---------------------------------------------
const XUR_TTL_MS = 60 * 60 * 1000 // re-resolve at most hourly
let xurCache = null
let xurAt = 0
let xurInFlight = null

async function getXur(force = false) {
  const fresh = Date.now() - xurAt < XUR_TTL_MS
  if (!force && xurCache && fresh) return xurCache
  if (xurInFlight) return xurInFlight // coalesce concurrent refreshes
  xurInFlight = resolveXur()
    .then((r) => {
      xurCache = r
      xurAt = Date.now()
      return r
    })
    .finally(() => {
      xurInFlight = null
    })
  // If we have a stale cache, serve it rather than waiting (only block on cold start).
  return xurCache && !force ? xurCache : xurInFlight
}

// --- /monument : cached live resolve ----------------------------------------
// The Monument catalog is near-static (changes only when content rotates), so a
// longer TTL is fine; we still expose ?force=1 for on-demand re-verification.
const MONUMENT_TTL_MS = 6 * 60 * 60 * 1000 // re-resolve at most every 6h
let monumentCache = null
let monumentAt = 0
let monumentInFlight = null

async function getMonument(force = false) {
  const fresh = Date.now() - monumentAt < MONUMENT_TTL_MS
  if (!force && monumentCache && fresh) return monumentCache
  if (monumentInFlight) return monumentInFlight
  monumentInFlight = resolveMonument()
    .then((r) => {
      monumentCache = r
      monumentAt = Date.now()
      return r
    })
    .finally(() => {
      monumentInFlight = null
    })
  return monumentCache && !force ? monumentCache : monumentInFlight
}

// --- /eververse : cached live shop check ------------------------------------
// Eververse's Bright Dust offerings rotate at the DAILY reset (and the featured
// set weekly), so we keep the TTL short-ish; ?force=1 re-checks on demand.
const EVERVERSE_TTL_MS = 60 * 60 * 1000 // re-resolve at most hourly
let eververseCache = null
let eververseAt = 0
let eververseInFlight = null

async function getEververse(force = false) {
  const fresh = Date.now() - eververseAt < EVERVERSE_TTL_MS
  if (!force && eververseCache && fresh) return eververseCache
  if (eververseInFlight) return eververseInFlight
  eververseInFlight = resolveEververse()
    .then((r) => {
      eververseCache = r
      eververseAt = Date.now()
      return r
    })
    .finally(() => {
      eververseInFlight = null
    })
  return eververseCache && !force ? eververseCache : eververseInFlight
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    xurCachedAt: xurAt || null,
    monumentCachedAt: monumentAt || null,
    eververseCachedAt: eververseAt || null,
    guidePackages: guidesCount
  })
})

app.get('/xur', async (req, res) => {
  try {
    const data = await getXur(req.query.force === '1')
    res.set('Cache-Control', 'public, max-age=900') // 15 min edge cache
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/monument', async (req, res) => {
  try {
    const data = await getMonument(req.query.force === '1')
    res.set('Cache-Control', 'public, max-age=3600') // 1h edge cache
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/eververse', async (req, res) => {
  try {
    const data = await getEververse(req.query.force === '1')
    res.set('Cache-Control', 'public, max-age=900') // 15 min edge cache
    res.json(data)
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/paths', (req, res) => {
  if (req.query.reload === '1') loadPaths()
  res.set('Cache-Control', 'public, max-age=3600')
  res.json(pathsCache || {})
})

// Library index — lightweight metadata for the browse view.
app.get('/guides', (req, res) => {
  if (req.query.reload === '1') guidesCount = loadGuides(GUIDES_DIR)
  res.set('Cache-Control', 'public, max-age=3600')
  res.json(getGuidesIndex())
})

// One full package. :id is the filename slug; reject anything non-slug up front.
app.get('/guides/:id', (req, res) => {
  const { id } = req.params
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.length > 128) {
    return res.status(400).json({ error: 'bad id' })
  }
  const pkg = getGuidePackage(id)
  if (!pkg) return res.status(404).json({ error: 'not found' })
  res.set('Cache-Control', 'public, max-age=3600')
  res.json(pkg)
})

app.get('/', (_req, res) => {
  res.json({
    service: 'ghost-companion-data-api',
    endpoints: ['/health', '/xur', '/monument', '/eververse', '/paths', '/guides', '/guides/:id']
  })
})

app.listen(PORT, () => {
  console.log(`[data-api] listening on :${PORT}`)
  // Warm the Xûr cache on boot (non-fatal if it fails).
  getXur(true).catch((e) => console.error('[xur] warm failed:', e.message))
})
