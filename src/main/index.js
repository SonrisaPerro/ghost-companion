// =============================================================================
// index.js — Electron main process
// Creates the frameless, always-on-top overlay window, the system tray, wires
// up every IPC channel, and starts the auto-tracker.
// =============================================================================

import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

import * as bungie from './bungie-api.js'
import * as manifest from './manifest.js'
import * as dataApi from './data-api.js'
import { AutoTracker, TRACKER_STORE_KEYS } from './auto-tracker.js'

// --- ESM shims (no __dirname in ESM) ---------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// electron-store is CommonJS; load it via require so it works in our ESM bundle.
const Store = require('electron-store')

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
    dataApiUrl: '' // base URL of the Ghost Companion data API (Railway); empty = off
  }
})

let mainWindow = null
let tray = null
let tracker = null

const WINDOW_WIDTH = 420
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

  const defaultBounds = {
    x: screenX + screenW - WINDOW_WIDTH,
    y: screenY,
    width: WINDOW_WIDTH,
    height: screenH
  }

  const saved = store.get('window.bounds')
  // Only honor saved bounds if they're still reachable on the current monitor
  // layout; otherwise reset to the pinned-right default and forget the bad ones.
  let bounds = defaultBounds
  if (isReachable(saved)) {
    bounds = { ...saved, width: WINDOW_WIDTH }
  } else if (saved) {
    store.set('window.bounds', null)
  }

  mainWindow = new BrowserWindow({
    ...bounds,
    width: WINDOW_WIDTH, // width is fixed by spec
    minWidth: WINDOW_WIDTH,
    maxWidth: WINDOW_WIDTH,
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
  ipcMain.handle('get-community-paths', async (_e, { force } = {}) =>
    dataApi.getCommunityPaths(store, { force })
  )
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

  // Run counts (auto-incremented by the tracker, also editable by the user).
  ipcMain.handle('get-run-counts', async () => store.get('runCounts') || {})

  ipcMain.handle('set-run-count', async (_e, { itemKey, pathId, value }) => {
    const counts = store.get('runCounts') || {}
    counts[`${itemKey}::${pathId}`] = value
    store.set('runCounts', counts)
    return counts
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

  app.whenReady().then(async () => {
    registerIpc()
    createWindow()
    createTray()

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
    manifest.closeDb()
  })
}
