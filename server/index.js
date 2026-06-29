// =============================================================================
// index.js — Ghost Companion data API (Express).
//
// Endpoints:
//   GET /health    — liveness probe
//   GET /xur       — Xûr's live weekly exotic stock + presence (cached)
//   GET /paths     — community acquisition-path data (read-only)
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

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), xurCachedAt: xurAt || null })
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

app.get('/paths', (req, res) => {
  if (req.query.reload === '1') loadPaths()
  res.set('Cache-Control', 'public, max-age=3600')
  res.json(pathsCache || {})
})

app.get('/', (_req, res) => {
  res.json({ service: 'ghost-companion-data-api', endpoints: ['/health', '/xur', '/paths'] })
})

app.listen(PORT, () => {
  console.log(`[data-api] listening on :${PORT}`)
  // Warm the Xûr cache on boot (non-fatal if it fails).
  getXur(true).catch((e) => console.error('[xur] warm failed:', e.message))
})
