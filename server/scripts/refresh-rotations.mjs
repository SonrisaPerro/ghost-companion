// =============================================================================
// refresh-rotations.mjs — manual runner for the featured-rotation pipeline.
//
//   node scripts/refresh-rotations.mjs            # fetch current week, print it
//   node scripts/refresh-rotations.mjs --write    # also upsert into rotations.json
//   node scripts/refresh-rotations.mjs --week 2026-07-07T17:00:00.000Z [--write]
//
// Fetches raids/dungeons for the target week from the vetted source and shows
// exactly what would be stored. With --write it upserts that week into the seed
// file (as source:'kyberscorner', verified:false) — review it, and add the
// grandmasterAlert by hand if you know it, before committing. Nothing is written
// unless the fetch VALIDATES, so this can't poison the seed with garbage.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lastResetISO } from '../src/config.js'
import { fetchWeek, SOURCE_URL } from '../src/rotations-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROTATIONS_FILE = path.join(__dirname, '..', 'data', 'rotations.json')

// Note: we set process.exitCode and return rather than calling process.exit(),
// which can abort mid-teardown while undici's fetch sockets are still closing
// (libuv assertion on Windows). Letting the loop drain exits cleanly.
async function main() {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const weekIdx = args.indexOf('--week')
  const weekOf = weekIdx >= 0 && args[weekIdx + 1] ? new Date(args[weekIdx + 1]).toISOString() : lastResetISO()

  console.log(`[refresh] week ${weekOf}`)
  console.log(`[refresh] source ${SOURCE_URL}`)

  const week = await fetchWeek(weekOf)
  if (!week) {
    console.error('[refresh] no validated data (network/parse/validation failed) — nothing to write.')
    process.exitCode = 1
    return
  }

  console.log('[refresh] fetched:', JSON.stringify(week, null, 2))

  if (!write) {
    console.log('[refresh] dry run — pass --write to upsert into rotations.json.')
    return
  }

  const table = JSON.parse(fs.readFileSync(ROTATIONS_FILE, 'utf8'))
  const existing = table.weeks?.[weekOf]
  if (existing?.verified) {
    console.error(`[refresh] ${weekOf} is already a VERIFIED seed entry — refusing to overwrite. Edit by hand.`)
    process.exitCode = 1
    return
  }
  // Preserve any hand-added GM Alert on a prior non-verified entry.
  if (existing?.grandmasterAlert && !week.grandmasterAlert) week.grandmasterAlert = existing.grandmasterAlert

  table.weeks = table.weeks || {}
  table.weeks[weekOf] = week
  fs.writeFileSync(ROTATIONS_FILE, JSON.stringify(table, null, 2) + '\n')
  console.log(`[refresh] wrote ${weekOf} to ${path.relative(process.cwd(), ROTATIONS_FILE)}.`)
  console.log('[refresh] review it, add grandmasterAlert if known, then commit.')
}

await main()
