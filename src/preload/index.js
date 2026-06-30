// =============================================================================
// preload/index.js
// Runs in an isolated context with access to a limited Node surface. We use
// contextBridge to expose a small, safe `window.api` to the React renderer —
// the renderer never touches ipcRenderer or Node directly.
// =============================================================================

import { contextBridge, ipcRenderer } from 'electron'

// All renderer-facing methods. Each maps to an ipcMain.handle channel in
// src/main/index.js, except the event subscriptions at the bottom.
const api = {
  // --- Auth ---------------------------------------------------------------
  login: () => ipcRenderer.invoke('bungie-login'),
  logout: () => ipcRenderer.invoke('bungie-logout'),
  getAuthStatus: () => ipcRenderer.invoke('get-auth-status'),
  getCollectionStatus: (opts) => ipcRenderer.invoke('get-collection-status', opts || {}),

  // --- External links (light.gg / DIM / Bungie) --------------------------
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // --- Manifest search ----------------------------------------------------
  searchManifest: (query) => ipcRenderer.invoke('search-manifest', query),
  getItemByHash: (itemHash) => ipcRenderer.invoke('get-item-by-hash', itemHash),
  searchActivities: (query) => ipcRenderer.invoke('search-activities', query),
  getWeaponOrnaments: (weaponHash) => ipcRenderer.invoke('get-weapon-ornaments', weaponHash),

  // --- User-authored acquisition data ------------------------------------
  getUserDropRates: () => ipcRenderer.invoke('get-user-drop-rates'),
  saveUserDropRate: (payload) => ipcRenderer.invoke('save-user-drop-rate', payload),
  deleteUserDropRate: (itemHash) => ipcRenderer.invoke('delete-user-drop-rate', itemHash),

  // --- Data API (Xûr live stock + community paths) -----------------------
  getXur: (opts) => ipcRenderer.invoke('get-xur', opts || {}),
  getEververse: (opts) => ipcRenderer.invoke('get-eververse', opts || {}),
  getCommunityPaths: (opts) => ipcRenderer.invoke('get-community-paths', opts || {}),
  getDataApiUrl: () => ipcRenderer.invoke('get-data-api-url'),
  setDataApiUrl: (url) => ipcRenderer.invoke('set-data-api-url', url),

  // --- Activity history ---------------------------------------------------
  getActivityHistory: (opts) => ipcRenderer.invoke('get-activity-history', opts),

  // --- Tracked items + run counts ----------------------------------------
  getTrackedItems: () => ipcRenderer.invoke('get-tracked-items'),
  setTrackedItems: (items) => ipcRenderer.invoke('set-tracked-items', items),
  getTrackedOrnaments: () => ipcRenderer.invoke('get-tracked-ornaments'),
  setTrackedOrnaments: (list) => ipcRenderer.invoke('set-tracked-ornaments', list),
  getRunCounts: () => ipcRenderer.invoke('get-run-counts'),
  setRunCount: (payload) => ipcRenderer.invoke('set-run-count', payload),

  // --- Guide / secret-chest data packages --------------------------------
  getGuides: () => ipcRenderer.invoke('get-guides'),
  importGuideFile: () => ipcRenderer.invoke('import-guide-file'),
  importGuideText: (text) => ipcRenderer.invoke('import-guide-text', text),
  exportGuides: () => ipcRenderer.invoke('export-guides'),
  deleteGuide: (id) => ipcRenderer.invoke('delete-guide', id),

  // --- Desktop notifications ---------------------------------------------
  getNotificationsEnabled: () => ipcRenderer.invoke('get-notifications-enabled'),
  setNotificationsEnabled: (on) => ipcRenderer.invoke('set-notifications-enabled', on),

  // --- Frameless window controls -----------------------------------------
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),

  // --- Push events from main → renderer ----------------------------------
  // Returns an unsubscribe function so React effects can clean up.
  onCompletionDetected: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('new-completion-detected', listener)
    return () => ipcRenderer.removeListener('new-completion-detected', listener)
  },
  // Fired when the user clicks a desktop notification — payload is a search
  // string the renderer can feed straight into scan().
  onNotificationScan: (callback) => {
    const listener = (_event, query) => callback(query)
    ipcRenderer.on('notification-scan', listener)
    return () => ipcRenderer.removeListener('notification-scan', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
