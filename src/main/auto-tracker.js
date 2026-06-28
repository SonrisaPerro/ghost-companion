// =============================================================================
// auto-tracker.js
// Polls GetActivityHistory for every character on a fixed interval. When it
// sees an activity completion it has not seen before AND that completion's
// activity matches a tracked item's sourceActivity, it emits a renderer event
// so the matching acquisition path's run count can be incremented automatically.
// =============================================================================

import { getActivityHistory, getCachedProfile } from './bungie-api.js'
import { getItemByHash } from './manifest.js'

const POLL_INTERVAL_MS = 60 * 1000 // spec: poll every 60 seconds

// electron-store keys owned by the tracker.
const STORE_KEYS = {
  tracked: 'tracking.items', // array of tracked item descriptors (see below)
  seen: 'tracking.seenInstances' // map characterId -> last seen activity instanceId
}

/**
 * A tracked item looks like:
 * {
 *   key: "Hierarchy of Needs",        // dropRates.json key (name or itemHash)
 *   itemHash: 1339362514,             // optional, for manifest lookups
 *   paths: [                          // acquisition paths the user is farming
 *     { id: "path_1", sourceActivityHash: 1801496203, sourceActivityName: "Spire of the Watcher" }
 *   ]
 * }
 */

export class AutoTracker {
  /**
   * @param {import('electron-store')} store
   * @param {(payload: object) => void} onCompletion  invoked when a new, matching
   *        completion is detected — wire this to push the "new-completion-detected"
   *        IPC event to the renderer.
   */
  constructor(store, onCompletion) {
    this.store = store
    this.onCompletion = onCompletion
    this.timer = null
    this.running = false
  }

  /** Begins polling. Safe to call multiple times. */
  start() {
    if (this.timer) return
    // Kick off one immediate poll, then settle into the interval.
    this.poll().catch((err) => console.error('[auto-tracker] initial poll failed:', err.message))
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error('[auto-tracker] poll failed:', err.message))
    }, POLL_INTERVAL_MS)
    console.log('[auto-tracker] started (interval %dms)', POLL_INTERVAL_MS)
  }

  /** Stops polling. */
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    console.log('[auto-tracker] stopped')
  }

  /** Returns the set of activity hashes we currently care about. */
  trackedActivityHashes() {
    const tracked = this.store.get(STORE_KEYS.tracked) || []
    const map = new Map() // activityHash -> { item, path }
    for (const item of tracked) {
      for (const p of item.paths || []) {
        // A path may declare a single sourceActivityHash or an array of
        // sourceActivityHashes (e.g. Standard + Master variants of a dungeon).
        const hashes = [
          ...(p.sourceActivityHash != null ? [p.sourceActivityHash] : []),
          ...(Array.isArray(p.sourceActivityHashes) ? p.sourceActivityHashes : [])
        ]
        for (const h of hashes) map.set(String(h), { item, path: p })
      }
    }
    return map
  }

  /**
   * One polling cycle: for each character, fetch recent activities, and emit a
   * completion event for any *new* completed activity that matches a tracked
   * activity hash. We de-dup using the per-character last-seen instanceId.
   */
  async poll() {
    if (this.running) return // avoid overlapping polls on slow networks
    this.running = true
    try {
      const profile = getCachedProfile(this.store)
      if (!profile) return // not logged in yet

      const wanted = this.trackedActivityHashes()
      if (wanted.size === 0) return // nothing tracked → nothing to do

      const seen = this.store.get(STORE_KEYS.seen) || {}

      for (const characterId of profile.characterIds) {
        const activities = await getActivityHistory(this.store, { characterId, count: 25 })
        if (!activities.length) continue

        // Activities come newest-first. Find anything newer than what we've
        // already processed for this character.
        const lastSeenId = seen[characterId]
        const fresh = []
        for (const a of activities) {
          const instanceId = a.activityDetails?.instanceId
          if (instanceId === lastSeenId) break // reached previously-seen territory
          fresh.push(a)
        }

        // Record the newest instance id as "seen" for next cycle.
        const newestId = activities[0]?.activityDetails?.instanceId
        if (newestId) seen[characterId] = newestId

        // Process oldest-of-the-fresh first so counts increment in real order.
        for (const a of fresh.reverse()) {
          const completed = a.values?.completed?.basic?.value === 1
          if (!completed) continue

          const activityHash = String(a.activityDetails?.referenceId ?? '')
          const directorHash = String(a.activityDetails?.directorActivityHash ?? '')

          // A character can run a variant whose referenceId differs from the
          // director hash listed in dropRates; check both.
          const match = wanted.get(activityHash) || wanted.get(directorHash)
          if (!match) continue

          this.emitCompletion({ characterId, activity: a, match })
        }
      }

      this.store.set(STORE_KEYS.seen, seen)
    } finally {
      this.running = false
    }
  }

  /** Builds and dispatches the completion payload. */
  emitCompletion({ characterId, activity, match }) {
    const payload = {
      itemKey: match.item.key,
      pathId: match.path.id,
      characterId,
      activityName: match.path.sourceActivityName || '',
      instanceId: activity.activityDetails?.instanceId,
      completedAt: activity.period, // ISO timestamp from Bungie
      // Optional manifest enrichment for nicer notifications.
      activityHash: activity.activityDetails?.referenceId
    }
    console.log('[auto-tracker] completion detected:', payload.itemKey, payload.pathId)
    try {
      this.onCompletion(payload)
    } catch (err) {
      console.error('[auto-tracker] onCompletion handler threw:', err.message)
    }
  }
}

export { STORE_KEYS as TRACKER_STORE_KEYS }
