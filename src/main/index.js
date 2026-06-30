// =============================================================================
// index.js — Electron main process
// Creates the frameless, always-on-top overlay window, the system tray, wires
// up every IPC channel, and starts the auto-tracker.
// =============================================================================

import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, shell, dialog } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

import * as bungie from './bungie-api.js'
import * as manifest from './manifest.js'
import * as dataApi from './data-api.js'
import * as packages from './packages.js'
import { AutoTracker, TRACKER_STORE_KEYS } from './auto-tracker.js'
import { Notifier } from './notifier.js'

// --- ESM shims (no __dirname in ESM) ---------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// electron-store is CommonJS; load it via require so it works in our ESM bundle.
const Store = require('electron-store')

// electron-updater (also CommonJS) pulls new releases from GitHub Releases. The
// publish target is baked into app-update.yml by electron-builder; we only kick
// off the check. Runs in packaged builds only — never in `npm run dev`.
const { autoUpdater } = require('electron-updater')

// Load environment variables from .env located at the project/app root.
dotenv.config({ path: path.join(app.getAppPath(), '.env') })

// ---------------------------------------------------------------------------
// Persistent store. Defaults define the on-disk schema for first launch.
// ---------------------------------------------------------------------------
const store = new Store({
  defaults: {
    window: { bounds: null, alwaysOnTop: true },
    [TRACKER_STORE_KEYS.tracked]: [],
    runCounts: {}, // { "<itemKey>::<pathId>": number }
    userDropRates: {}, // user-authored acquisition data, keyed by itemHash
    trackedOrnaments: [], // user-tracked Eververse ornaments (drives the shop alert panel)
    guides: [], // imported guide/secret-chest packages (see packages.js)
    notificationsEnabled: true, // desktop alerts for vendor hits + weekly reset
    // Base URL of the Ghost Companion data API (Railway). Defaulted to the public
    // service so Xûr/Eververse/community paths work on first launch; the user can
    // clear it in Account to run on bundled data only, or point at their own host.
    dataApiUrl: 'https://ghost-companion-production.up.railway.app'
  }
})

let mainWindow = null
let tray = null
let tracker = null
let notifier = null

const WINDOW_WIDTH = 460
const DEFAULT_HEIGHT = 900 // tall sidebar, but not the full monitor by default
const MIN_HEIGHT = 480
const OPACITY = 0.92

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
// True only if `b`'s top strip (the draggable header) is actually reachable on
// some connected display. Guards against stale saved bounds that land in a
// monitor gap or on a disconnected display — those leave the window invisible
// and ungrabbable (the header is the only drag handle).
function isReachable(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number') return false
  const HEADER_H = 48 // approx. header height; its top must be on-screen to grab
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    const overlapX = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x)
    const headerTopVisible = b.y >= wa.y && b.y <= wa.y + wa.height - HEADER_H
    return overlapX >= 100 && headerTopVisible // ≥100px wide and header on-screen
  })
}

function createWindow() {
  // Pin to the right edge of the primary display, full height.
  const display = screen.getPrimaryDisplay()
  const { width: screenW, height: screenH, x: screenX, y: screenY } = display.workArea

  // Default to a tall sidebar pinned to the top-right — but cap the height so a
  // fresh launch isn't full-monitor-tall (the user can still drag it taller).
  const defaultHeight = Math.min(screenH, DEFAULT_HEIGHT)
  const defaultBounds = {
    x: screenX + screenW - WINDOW_WIDTH,
    y: screenY,
    width: WINDOW_WIDTH,
    height: defaultHeight
  }

  const saved = store.get('window.bounds')
  // Only honor saved bounds if they're still reachable on the current monitor
  // layout; otherwise reset to the pinned-right default and forget the bad ones.
  let bounds = defaultBounds
  if (isReachable(saved)) {
    // Honor the saved position, but re-assert the locked width. Earlier builds
    // always defaulted to full-monitor height, so a near-full saved height was
    // never a deliberate choice — collapse that back to the new capped default.
    // Otherwise keep the user's real resize, clamped to a sane range.
    const wasFullHeightDefault = saved.height >= screenH - 4
    const h = wasFullHeightDefault
      ? defaultHeight
      : Math.max(MIN_HEIGHT, Math.min(saved.height, screenH))
    bounds = { ...saved, width: WINDOW_WIDTH, height: h }
  } else if (saved) {
    store.set('window.bounds', null)
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    width: WINDOW_WIDTH, // width is locked (right-edge sidebar); see WINDOW_WIDTH
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false, // frameless overlay
    // NOTE: transparent:true is intentionally OFF. On Windows a transparent
    // window can't be edge-resized and often ignores the -webkit-app-region
    // drag handle. The see-through effect comes from setOpacity() below, and the
    // layout fills the window with a solid bg, so transparency added nothing
    // visible while breaking move/resize.
    transparent: false,
    resizable: true, // height is adjustable; width is locked above
    skipTaskbar: false,
    alwaysOnTop: store.get('window.alwaysOnTop'),
    backgroundColor: '#05080F', // matches the renderer's C.bg (no black gaps)
    icon: trayImage(),
    webPreferences: {
      // electron-vite emits the preload as .mjs because package.json is ESM.
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Window-level opacity gives the "see the game beneath" effect.
  mainWindow.setOpacity(OPACITY)
  if (store.get('window.alwaysOnTop')) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
  }

  // Persist position/size as the user moves the overlay.
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    store.set('window.bounds', mainWindow.getBounds())
  }
  mainWindow.on('moved', persistBounds)
  mainWindow.on('resized', persistBounds)

  // Hide to tray instead of quitting when the user closes the window.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // Open external links (e.g. the Bungie OAuth fallback) in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load Vite dev server in dev, built files in production.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function trayImage() {
  // Bundled tray icon; falls back to an empty image if missing so the app still
  // launches. Replace resources/tray.png with your own 32x32 icon.
  const iconPath = path.join(__dirname, '../../resources/tray.png')
  const img = nativeImage.createFromPath(iconPath)
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

function createTray() {
  tray = new Tray(trayImage())
  tray.setToolTip('Ghost Companion')

  const toggle = () => {
    if (!mainWindow) return
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
  }

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggle },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', toggle)
}

// ---------------------------------------------------------------------------
// IPC channels
// ---------------------------------------------------------------------------
function registerIpc() {
  // --- Auth ---------------------------------------------------------------
  ipcMain.handle('bungie-login', async () => {
    const profile = await bungie.login(store)
    startTracker() // begin polling now that we have a session
    return { loggedIn: true, displayName: profile.displayName }
  })

  ipcMain.handle('bungie-logout', async () => {
    bungie.logout(store)
    if (tracker) tracker.stop()
    return { loggedIn: false, displayName: null }
  })

  ipcMain.handle('get-auth-status', async () => bungie.getAuthStatus(store))

  // Player collection ownership (drives the COLLECTED/MISSING badge). Tries a
  // live read; falls back to the last cached one so the badge still renders
  // offline or if Bungie is briefly unreachable.
  ipcMain.handle('get-collection-status', async (_e, { force } = {}) => {
    if (!bungie.getAuthStatus(store).loggedIn) return { hashes: [], fetchedAt: 0, loggedIn: false }
    const cached = bungie.getCachedCollectibles(store)
    if (!force && cached.fetchedAt) return { ...cached, loggedIn: true }
    try {
      const fresh = await bungie.getOwnedCollectibles(store)
      return { ...fresh, loggedIn: true }
    } catch (err) {
      console.error('[collection] fetch failed:', err.message)
      return { ...cached, loggedIn: true } // graceful fallback to last good read
    }
  })

  // Open an external URL in the user's real browser (light.gg / DIM / Bungie
  // deep links). Restricted to http(s) so a bad payload can't launch anything.
  ipcMain.handle('open-external', async (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return true
    }
    return false
  })

  // --- Manifest -----------------------------------------------------------
  ipcMain.handle('search-manifest', async (_e, query) => {
    return manifest.searchManifest(query)
  })

  ipcMain.handle('get-item-by-hash', async (_e, itemHash) => {
    return manifest.getItemCard(Number(itemHash))
  })

  ipcMain.handle('search-activities', async (_e, query) => {
    return manifest.searchActivities(query)
  })

  // Eververse ornaments available on a scanned weapon (walked from its sockets),
  // so the renderer can offer "track any of these?" on the weapon card.
  ipcMain.handle('get-weapon-ornaments', async (_e, weaponHash) => {
    return manifest.getWeaponOrnaments(Number(weaponHash))
  })

  // Factual catalyst + per-column perk pool for a scanned weapon (NOT a god-roll
  // recommendation — those are community opinion; see the light.gg deep link).
  ipcMain.handle('get-weapon-perks', async (_e, weaponHash) => {
    return manifest.getWeaponPerks(Number(weaponHash))
  })

  // --- User-authored acquisition data (keyed by itemHash) -----------------
  ipcMain.handle('get-user-drop-rates', async () => store.get('userDropRates') || {})

  ipcMain.handle('save-user-drop-rate', async (_e, { itemHash, entry }) => {
    const all = store.get('userDropRates') || {}
    all[String(itemHash)] = entry
    store.set('userDropRates', all)
    return all
  })

  ipcMain.handle('delete-user-drop-rate', async (_e, itemHash) => {
    const all = store.get('userDropRates') || {}
    delete all[String(itemHash)]
    store.set('userDropRates', all)
    return all
  })

  // --- Data API (Xûr live stock + community paths) ------------------------
  ipcMain.handle('get-xur', async (_e, { force } = {}) => dataApi.getXur(store, { force }))
  ipcMain.handle('get-eververse', async (_e, { force } = {}) => dataApi.getEververse(store, { force }))
  ipcMain.handle('get-weekly', async (_e, { force } = {}) => dataApi.getWeekly(store, { force }))
  ipcMain.handle('get-community-paths', async (_e, { force } = {}) =>
    dataApi.getCommunityPaths(store, { force })
  )

  // Community guide library: browse index + one-click import. The fetched
  // package runs through the SAME validate+merge path as a dragged-in file, so
  // re-importing updates existing guides (dedupe by id) rather than duplicating.
  ipcMain.handle('get-community-guides', async (_e, { force } = {}) =>
    dataApi.getCommunityGuides(store, { force })
  )
  ipcMain.handle('import-community-guide', async (_e, id) => {
    const pkg = await dataApi.getCommunityGuidePackage(store, id)
    if (!pkg) return { ok: false, message: 'Could not fetch that package from the library.' }
    return importGuideFromText(JSON.stringify(pkg))
  })
  ipcMain.handle('get-data-api-url', async () => store.get('dataApiUrl') || '')
  ipcMain.handle('set-data-api-url', async (_e, url) => {
    store.set('dataApiUrl', (url || '').trim())
    return store.get('dataApiUrl')
  })

  // --- Activity / tracking ------------------------------------------------
  ipcMain.handle('get-activity-history', async (_e, { characterId, count, mode } = {}) => {
    const profile = bungie.getCachedProfile(store)
    if (!profile) return []
    const id = characterId || profile.characterIds[0]
    return bungie.getActivityHistory(store, { characterId: id, count, mode })
  })

  // Tracked-item management used by the renderer to add/remove farm targets.
  ipcMain.handle('get-tracked-items', async () => store.get(TRACKER_STORE_KEYS.tracked) || [])

  ipcMain.handle('set-tracked-items', async (_e, items) => {
    store.set(TRACKER_STORE_KEYS.tracked, items || [])
    return store.get(TRACKER_STORE_KEYS.tracked)
  })

  // User-tracked Eververse ornaments (drives the Eververse shop-alert panel).
  ipcMain.handle('get-tracked-ornaments', async () => store.get('trackedOrnaments') || [])

  ipcMain.handle('set-tracked-ornaments', async (_e, list) => {
    store.set('trackedOrnaments', list || [])
    return store.get('trackedOrnaments')
  })

  // Run counts (auto-incremented by the tracker, also editable by the user).
  ipcMain.handle('get-run-counts', async () => store.get('runCounts') || {})

  ipcMain.handle('set-run-count', async (_e, { itemKey, pathId, value }) => {
    const counts = store.get('runCounts') || {}
    counts[`${itemKey}::${pathId}`] = value
    store.set('runCounts', counts)
    return counts
  })

  // --- Guide packages -----------------------------------------------------
  ipcMain.handle('get-guides', async () => store.get('guides') || [])

  // Create a guide in-app (the Create Guide form). Wraps the single guide in a
  // package envelope and runs the same validate+merge path, so a hand-authored
  // guide is held to the identical limits as an imported one. Generates a stable
  // slug id from the title when the form doesn't supply one.
  ipcMain.handle('add-guide', async (_e, guide) => {
    if (!guide || typeof guide !== 'object') return { ok: false, message: 'No guide data.' }
    const id = (guide.id && String(guide.id)) || slugId(guide.title)
    if (!id) return { ok: false, message: 'A title is required.' }
    const envelope = {
      ghostPackage: packages.SCHEMA_VERSION,
      name: 'My guides',
      guides: [{ ...guide, id }]
    }
    return importGuideFromText(JSON.stringify(envelope))
  })

  // Import from a file chosen via the OS picker.
  ipcMain.handle('import-guide-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Ghost Companion guide package',
      filters: [{ name: 'Ghost package', extensions: ['ghostpkg.json', 'ghostpkg', 'json'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths?.[0]) return { canceled: true }
    try {
      return importGuideFromText(await fsp.readFile(res.filePaths[0], 'utf8'))
    } catch (err) {
      return { ok: false, message: `Could not read file: ${err.message}` }
    }
  })

  // Import from raw text (drag-and-drop reads the file in the renderer).
  ipcMain.handle('import-guide-text', async (_e, text) => importGuideFromText(text))

  ipcMain.handle('export-guides', async () => {
    const guides = store.get('guides') || []
    if (!guides.length) return { ok: false, message: 'No guides to export yet.' }
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export guides',
      defaultPath: 'ghost-guides.ghostpkg.json',
      filters: [{ name: 'Ghost package', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { canceled: true }
    try {
      await fsp.writeFile(res.filePath, JSON.stringify(packages.buildExport(guides), null, 2), 'utf8')
      return { ok: true, count: guides.length, path: res.filePath }
    } catch (err) {
      return { ok: false, message: `Could not write file: ${err.message}` }
    }
  })

  ipcMain.handle('delete-guide', async (_e, id) => {
    const next = (store.get('guides') || []).filter((g) => g.id !== id)
    store.set('guides', next)
    return next
  })

  // --- Notifications ------------------------------------------------------
  ipcMain.handle('get-notifications-enabled', async () => store.get('notificationsEnabled') !== false)
  ipcMain.handle('set-notifications-enabled', async (_e, on) => {
    store.set('notificationsEnabled', !!on)
    if (on) notifier?.start()
    else notifier?.stop()
    return store.get('notificationsEnabled')
  })

  // --- Window controls (frameless window needs its own buttons) -----------
  ipcMain.handle('toggle-always-on-top', async () => {
    const next = !store.get('window.alwaysOnTop')
    store.set('window.alwaysOnTop', next)
    mainWindow.setAlwaysOnTop(next, next ? 'screen-saver' : 'normal')
    return next
  })

  ipcMain.handle('get-always-on-top', async () => store.get('window.alwaysOnTop'))
  ipcMain.handle('minimize-window', async () => mainWindow?.minimize())
  ipcMain.handle('hide-window', async () => mainWindow?.hide())
}

// ---------------------------------------------------------------------------
// Guide-package import (shared by the file-picker and drag-and-drop channels)
// ---------------------------------------------------------------------------
// Turns a free-text title into a safe, unique-ish slug id (matches packages.js's
// ID_RE charset). Appends a short random suffix so two same-titled guides don't
// collide. Returns '' if the title has no usable characters.
function slugId(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!base) return ''
  return `${base}-${Math.random().toString(36).slice(2, 7)}`
}

function importGuideFromText(text) {
  if (!packages.withinSizeLimit(text)) {
    return { ok: false, message: 'That file is too large to be a guide package.' }
  }
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' }
  }
  const v = packages.validatePackage(obj)
  if (!v.ok) return { ok: false, message: v.errors.join(' ') }
  const merged = packages.mergeGuides(store.get('guides') || [], v.guides)
  store.set('guides', merged.guides)
  return {
    ok: true,
    name: v.name,
    added: merged.added,
    updated: merged.updated,
    total: merged.guides.length
  }
}

// ---------------------------------------------------------------------------
// Auto-tracker wiring
// ---------------------------------------------------------------------------
function startTracker() {
  if (!tracker) {
    tracker = new AutoTracker(store, (payload) => {
      // Auto-increment the matching path's run count...
      const counts = store.get('runCounts') || {}
      const key = `${payload.itemKey}::${payload.pathId}`
      counts[key] = (counts[key] || 0) + 1
      store.set('runCounts', counts)

      // ...then push the event to the renderer so the UI updates live.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-completion-detected', {
          ...payload,
          newCount: counts[key]
        })
      }
    })
  }
  if (bungie.getAuthStatus(store).loggedIn) tracker.start()
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
// Single-instance lock so the tray/overlay doesn't get duplicated.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Windows shows notifications under this identity; without it toasts from a
  // dev/unpackaged Electron run may not appear.
  if (process.platform === 'win32') app.setAppUserModelId('com.ghostcompanion.app')

  app.whenReady().then(async () => {
    registerIpc()
    createWindow()
    createTray()

    // Check for and silently download a newer release, then prompt to restart.
    // Only meaningful in a packaged build with a publish target; guarded so dev
    // runs are untouched.
    if (app.isPackaged) {
      autoUpdater.autoDownload = true
      autoUpdater.checkForUpdatesAndNotify().catch((err) =>
        console.error('[updater] check failed:', err.message)
      )
    }

    // Desktop notifications run independently of Bungie login (vendor data is
    // public via the data API). Gated by the user's notificationsEnabled pref.
    notifier = new Notifier(store, () => mainWindow)
    if (store.get('notificationsEnabled') !== false) notifier.start()

    // Make sure the Manifest is present/current before the renderer searches it.
    try {
      const { version, updated } = await manifest.ensureManifest()
      console.log('[manifest] ready (version %s, updated=%s)', version, updated)
    } catch (err) {
      console.error('[manifest] failed to prepare:', err.message)
    }

    // Resume an existing session (refreshes profile + starts polling).
    if (bungie.getAuthStatus(store).loggedIn) {
      try {
        await bungie.loadProfile(store)
      } catch (err) {
        console.error('[startup] could not refresh profile:', err.message)
      }
      startTracker()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Keep running in the tray on Windows/Linux; only quit explicitly.
    if (process.platform !== 'darwin' && app.isQuitting) app.quit()
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    if (tracker) tracker.stop()
    if (notifier) notifier.stop()
    manifest.closeDb()
  })
}
