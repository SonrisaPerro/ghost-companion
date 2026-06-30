// probe-milestones.mjs — one-off feasibility probe for the "This Week" concierge.
// Hits the PUBLIC milestones endpoint (API-key only, no OAuth) to see what weekly
// rotating activities Bungie still exposes post-Edge of Fate. Never prints the key.
//
//   node server/scripts/probe-milestones.mjs
// Reads BUNGIE_API_KEY from process.env or the app's root .env.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = 'https://www.bungie.net/Platform'

function apiKey() {
  if (process.env.BUNGIE_API_KEY) return process.env.BUNGIE_API_KEY
  // fall back to the app's root .env (gitignored)
  const envPath = path.resolve(__dirname, '../../.env')
  const txt = fs.readFileSync(envPath, 'utf8')
  const m = txt.match(/^BUNGIE_API_KEY=(.+)$/m)
  if (!m) throw new Error('BUNGIE_API_KEY not found in env or .env')
  return m[1].trim()
}

const KEY = apiKey()
async function get(p) {
  const res = await fetch(`${ROOT}${p}`, { headers: { 'X-API-Key': KEY, Accept: 'application/json' } })
  const j = await res.json()
  if (j.ErrorCode && j.ErrorCode !== 1) throw new Error(`${p} → ${j.ErrorCode} ${j.ErrorStatus}`)
  return j.Response
}

const ms = await get('/Destiny2/Milestones/')
const hashes = Object.keys(ms)
console.log(`\n=== PUBLIC MILESTONES: ${hashes.length} active ===\n`)

for (const h of hashes) {
  const m = ms[h]
  let name = '(no def)'
  let type = ''
  try {
    const def = await get(`/Destiny2/Manifest/DestinyMilestoneDefinition/${h}/`)
    name = def?.displayProperties?.name || '(unnamed)'
    type = def?.milestoneType != null ? `type=${def.milestoneType}` : ''
  } catch {}
  // surface activity variants (raid/dungeon/nightfall rotators expose activityHashes here)
  const acts = m.activities || []
  const actInfo = acts.length ? `activities=${acts.length}` : ''
  const av = m.availableQuests ? `quests=${m.availableQuests.length}` : ''
  const end = m.endDate ? `ends=${m.endDate}` : ''
  console.log(`• ${name}  [${h}]  ${type} ${actInfo} ${av} ${end}`.replace(/\s+/g, ' ').trim())

  // for the first few activity-bearing milestones, dump activity names to spot
  // the farmable raid/dungeon + any rewards still attached
  if (acts.length && acts.length <= 12) {
    for (const a of acts.slice(0, 12)) {
      try {
        const ad = await get(`/Destiny2/Manifest/DestinyActivityDefinition/${a.activityHash}/`)
        const an = ad?.displayProperties?.name || a.activityHash
        const place = ad?.activityTypeHash ? '' : ''
        console.log(`      ↳ ${an} [${a.activityHash}]${a.phases ? ` phases=${a.phases.length}` : ''}`)
      } catch {}
    }
  }
}
console.log('\n=== done ===')
