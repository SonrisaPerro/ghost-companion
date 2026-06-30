// =============================================================================
// milestones.js — resolves this week's raid/dungeon slate from the PUBLIC
// milestones endpoint (API-key only, no OAuth, global/shared).
//
// Edge of Fate reality (verified via probe-milestones.mjs): the public milestones
// expose every available raid as a weekly milestone (with Standard/Master
// variants + the reset endDate), but NOT dungeons, NOT the daily Lost Sector, and
// NOT a "featured/farmable" flag. So this resolver answers "which raids are up and
// when does the week end" — the FEATURED rotator + Lost Sector come from the
// deterministic rotation table (added in stage 2), not from here.
//
//   - source 'live'     → authoritative read of the milestones
//   - source 'fallback' → network failure; slate unknown
// =============================================================================

import { getPublicMilestones, getDef } from './bungie.js'

const RAID_RE = /raid/i
const DUNGEON_RE = /dungeon/i

/**
 * Returns { generatedAt, source, endsAt, raids[], dungeons[] }.
 * Each entry: { name, milestoneHash, endsAt, master } where `master` flags that a
 * Master difficulty variant is currently active.
 */
export async function resolveActivities() {
  const result = { generatedAt: new Date().toISOString(), source: 'fallback', endsAt: null, raids: [], dungeons: [] }

  try {
    const ms = await getPublicMilestones()
    const typeNameCache = new Map() // activityTypeHash → display name

    for (const key of Object.keys(ms)) {
      const m = ms[key]
      const acts = m.activities || []
      if (!acts.length) continue // clan engrams / quest-only milestones carry no activities

      // milestone display name (the activity's friendly title, e.g. "King's Fall")
      let mname = ''
      try {
        const md = await getDef('DestinyMilestoneDefinition', key)
        mname = md?.displayProperties?.name || ''
      } catch { /* fall back to variant names below */ }

      // classify by the activity TYPE (Raid / Dungeon) via the first variant
      let typeName = ''
      try {
        const ad = await getDef('DestinyActivityDefinition', acts[0].activityHash)
        const th = ad?.activityTypeHash
        if (th != null) {
          if (!typeNameCache.has(th)) {
            let tn = ''
            try {
              const td = await getDef('DestinyActivityTypeDefinition', th)
              tn = td?.displayProperties?.name || ''
            } catch { /* leave blank */ }
            typeNameCache.set(th, tn)
          }
          typeName = typeNameCache.get(th)
        }
      } catch { /* unclassifiable → skip below */ }

      const isRaid = RAID_RE.test(typeName)
      const isDungeon = DUNGEON_RE.test(typeName)
      if (!isRaid && !isDungeon) continue

      // resolve variant names to detect an active Master difficulty
      let master = false
      let firstVariant = ''
      for (const a of acts) {
        try {
          const ad = await getDef('DestinyActivityDefinition', a.activityHash)
          const name = ad?.displayProperties?.name || ''
          if (!firstVariant) firstVariant = name
          if (/master/i.test(name)) master = true
        } catch { /* ignore one bad variant */ }
      }

      if (m.endDate && !result.endsAt) result.endsAt = m.endDate
      const entry = {
        name: mname || firstVariant.replace(/:\s*(Standard|Normal)$/i, '') || `#${key}`,
        milestoneHash: Number(key),
        endsAt: m.endDate || null,
        master
      }
      ;(isRaid ? result.raids : result.dungeons).push(entry)
    }

    result.raids.sort((a, b) => a.name.localeCompare(b.name))
    result.dungeons.sort((a, b) => a.name.localeCompare(b.name))
    result.source = 'live'
  } catch (err) {
    result.error = err.message
  }

  return result
}
