// =============================================================================
// notifier.js — desktop notifications
// Turns the data the app already fetches into push alerts:
//   • a tracked Eververse ornament rotating into Tess Everis' shop,
//   • Xûr arriving in town (once per weekly visit), regardless of tracked items,
//   • a tracked item showing up in Xûr's weekly stock,
//   • a tracked item in Banshee-44's weekly weapon rotation,
//   • the Tuesday weekly reset.
// (The daily Lost Sector is intentionally NOT covered: post-Edge-of-Fate no
//  Bungie endpoint exposes it, so there's nothing authoritative to poll.)
// All vendor data comes from the public Railway data API (no Bungie auth), so
// the notifier runs independently of login. Everything is gated by the user's
// `notificationsEnabled` preference and de-duplicated so a given rotation only
// alerts once.
// =============================================================================

import { Notification } from 'electron'
import * as dataApi from './data-api.js'

const CHECK_INTERVAL_MS = 30 * 60 * 1000 // poll vendors every 30 minutes
const NOTIFIED_KEY = 'notify.sentKeys' // ring buffer of rotation keys already alerted
const MAX_NOTIFIED = 200

export class Notifier {
  /**
   * @param {import('electron-store')} store
   * @param {() => Electron.BrowserWindow | null} getWindow  resolves the main
   *        window lazily so a notification click can restore/focus it.
   */
  constructor(store, getWindow) {
    this.store = store
    this.getWindow = getWindow
    this.vendorTimer = null
    this.resetTimer = null
  }

  enabled() {
    return this.store.get('notificationsEnabled') !== false
  }

  start() {
    if (!Notification.isSupported()) {
      console.log('[notifier] desktop notifications unsupported on this platform')
      return
    }
    this.stop()
    // One check shortly after launch, then on a steady interval.
    this.checkVendors().catch((e) => console.error('[notifier] vendor check failed:', e.message))
    this.vendorTimer = setInterval(() => {
      this.checkVendors().catch((e) => console.error('[notifier] vendor check failed:', e.message))
    }, CHECK_INTERVAL_MS)
    this.scheduleReset()
    console.log('[notifier] started (interval %dms)', CHECK_INTERVAL_MS)
  }

  stop() {
    if (this.vendorTimer) clearInterval(this.vendorTimer)
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.vendorTimer = null
    this.resetTimer = null
  }

  /** Fires a toast, wiring a click to restore the overlay (and optionally scan). */
  notify(title, body, payload) {
    if (!this.enabled() || !Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    n.on('click', () => {
      const w = this.getWindow?.()
      if (w && !w.isDestroyed()) {
        w.show()
        w.focus()
        if (payload?.scan) w.webContents.send('notification-scan', payload.scan)
      }
    })
    n.show()
  }

  /**
   * Returns the subset of `keys` not previously alerted, recording them as sent.
   * Bounds the stored set so it can't grow without limit.
   */
  filterUnsent(keys) {
    const sent = this.store.get(NOTIFIED_KEY) || []
    const sentSet = new Set(sent)
    const fresh = keys.filter((k) => !sentSet.has(k))
    if (fresh.length) {
      const next = [...sent, ...fresh].slice(-MAX_NOTIFIED)
      this.store.set(NOTIFIED_KEY, next)
    }
    return new Set(fresh)
  }

  /** Cross-references tracked ornaments/items against the live vendor payloads. */
  async checkVendors() {
    if (!this.enabled()) return

    // --- Eververse: tracked ornaments for sale right now ---------------------
    const trackedOrnaments = this.store.get('trackedOrnaments') || []
    if (trackedOrnaments.length) {
      const evv = await dataApi.getEververse(this.store, { force: true })
      if (evv?.source === 'live') {
        const onSale = new Set([
          ...(evv.shopSales || []).map((s) => s.itemHash),
          ...(evv.inShop || []).map((o) => o.itemHash)
        ])
        const day = new Date().toISOString().slice(0, 10) // Eververse rotates daily
        const hits = trackedOrnaments.filter((t) => onSale.has(t.itemHash))
        const fresh = this.filterUnsent(hits.map((h) => `evv:${day}:${h.itemHash}`))
        for (const h of hits) {
          if (!fresh.has(`evv:${day}:${h.itemHash}`)) continue
          this.notify(
            'Eververse — tracked ornament in stock',
            `${h.name}${h.weapon ? ` (${h.weapon})` : ''} is for sale at Tess Everis right now.`,
            { scan: h.weapon || h.name }
          )
        }
      }
    }

    // --- Xûr: arrival + tracked items in his weekly stock --------------------
    const trackedItems = this.store.get('tracking.items') || []
    const xd = await dataApi.getXur(this.store, { force: true })
    if (xd?.source === 'live' && xd.xur?.present) {
      const week = xd.weekOf || ''

      // "Xûr has arrived" — fire once per weekly visit, independent of tracking.
      // He arrives Friday and stays until the Tuesday reset, so one alert per
      // weekOf is exactly one per visit.
      if (this.filterUnsent([`xur-arrived:${week}`]).has(`xur-arrived:${week}`)) {
        const loc = xd.xur.location ? ` (${xd.xur.location})` : ''
        this.notify('Xûr has arrived', `Xûr is in town this weekend${loc}. Check his exotic stock.`)
      }

      if (trackedItems.length) {
        const stock = [...(xd.xur.weapons || []), ...(xd.xur.armor || [])]
        const stockByHash = new Map(stock.map((s) => [Number(s.itemHash), s]))
        const hits = trackedItems.filter((t) => stockByHash.has(Number(t.itemHash)))
        const fresh = this.filterUnsent(hits.map((h) => `xur:${week}:${h.itemHash}`))
        for (const h of hits) {
          if (!fresh.has(`xur:${week}:${h.itemHash}`)) continue
          const s = stockByHash.get(Number(h.itemHash))
          const name = h.name || s?.name || 'A tracked item'
          this.notify('Xûr has a tracked item', `${name} is in Xûr's stock this week.`, {
            scan: name
          })
        }
      }
    }

    // --- Banshee-44: tracked item in his weekly weapon rotation --------------
    if (trackedItems.length) {
      const bd = await dataApi.getBanshee(this.store, { force: true })
      if (bd?.source === 'live' && bd.present) {
        const stockByHash = new Map((bd.weapons || []).map((w) => [Number(w.itemHash), w]))
        const week = bd.weekOf || new Date().toISOString().slice(0, 10)
        const hits = trackedItems.filter((t) => stockByHash.has(Number(t.itemHash)))
        const fresh = this.filterUnsent(hits.map((h) => `banshee:${week}:${h.itemHash}`))
        for (const h of hits) {
          if (!fresh.has(`banshee:${week}:${h.itemHash}`)) continue
          const s = stockByHash.get(Number(h.itemHash))
          const name = h.name || s?.name || 'A tracked item'
          this.notify('Banshee-44 has a tracked weapon', `${name} is for sale at Banshee-44 this week.`, {
            scan: name
          })
        }
      }
    }
  }

  /** Schedules a one-shot reminder for the next Tuesday 17:00 UTC weekly reset. */
  scheduleReset() {
    const now = new Date()
    const next = new Date(now)
    next.setUTCHours(17, 0, 0, 0)
    // Advance day-by-day to the next Tuesday (UTC day 2) strictly in the future.
    while (next.getUTCDay() !== 2 || next <= now) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    const ms = next - now // always < 7 days, well within setTimeout's range
    this.resetTimer = setTimeout(() => {
      this.notify(
        'Destiny 2 weekly reset',
        'New weekly challenges, activity rotations, and vendor inventories are live.'
      )
      this.scheduleReset() // re-arm for the following week
    }, ms)
  }
}
