// =============================================================================
// index.js — Ghost Companion data API (Express).
//
// Endpoints:
//   GET /health    — liveness probe
//   GET /rotation  — this week's global Nightfall/Trials rotation (cached)
//   GET /paths     — community acquisition-path data (read-only)
//
// Designed for Railway: binds to process.env.PORT. The rotation is resolved once
// and cached (it's identical for everyone until the weekly reset), so client
// fan-out never hits Bungie directly.
// =============================================================================

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveRotation, debugXur } from './src/rotation.js'

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

// --- /rotation : cached weekly resolve --------------------------------------
const ROTATION_TTL_MS = 60 * 60 * 1000 // re-resolve at most hourly
let rotationCache = null
let rotationAt = 0
let rotationInFlight = null

async function getRotation(force = false) {
  const fresh = Date.now() - rotationAt < ROTATION_TTL_MS
  if (!force && rotationCache && fresh) return rotationCache
  if (rotationInFlight) return rotationInFlight // coalesce concurrent refreshes
  rotationInFlight = resolveRotation()
    .then((r) => {
      rotationCache = r
      rotationAt = Date.now()
      return r
    })
    .finally(() => {
      rotationInFlight = null
    })
  // If we have a stale cache, serve it rather than waiting (only block on cold start).
  return rotationCache && !force ? rotationCache : rotationInFlight
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), rotationCachedAt: rotationAt || null })
})

app.get('/rotation', async (req, res) => {
  try {
    const data = await getRotation(req.query.force === '1')
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

app.get('/debug/xur', async (_req, res) => {
  try {
    res.json(await debugXur())
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

app.get('/', (_req, res) => {
  res.json({ service: 'ghost-companion-data-api', endpoints: ['/health', '/rotation', '/paths'] })
})

app.listen(PORT, () => {
  console.log(`[data-api] listening on :${PORT}`)
  // Warm the rotation cache on boot (non-fatal if it fails).
  getRotation(true).catch((e) => console.error('[rotation] warm failed:', e.message))
})
