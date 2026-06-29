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

  // --- Manifest search ----------------------------------------------------
  searchManifest: (query) => ipcRenderer.invoke('search-manifest', query),
  getItemByHash: (itemHash) => ipcRenderer.invoke('get-item-by-hash', itemHash),
  searchActivities: (query) => ipcRenderer.invoke('search-activities', query),

  // --- User-authored acquisition data ------------------------------------
  getUserDropRates: () => ipcRenderer.invoke('get-user-drop-rates'),
  saveUserDropRate: (payload) => ipcRenderer.invoke('save-user-drop-rate', payload),
  deleteUserDropRate: (itemHash) => ipcRenderer.invoke('delete-user-drop-rate', itemHash),

  // --- Data API (Xûr live stock + community paths) -----------------------
  getXur: (opts) => ipcRenderer.invoke('get-xur', opts || {}),
  getCommunityPaths: (opts) => ipcRenderer.invoke('get-community-paths', opts || {}),
  getDataApiUrl: () => ipcRenderer.invoke('get-data-api-url'),
  setDataApiUrl: (url) => ipcRenderer.invoke('set-data-api-url', url),

  // --- Activity history ---------------------------------------------------
  getActivityHistory: (opts) => ipcRenderer.invoke('get-activity-history', opts),

  // --- Tracked items + run counts ----------------------------------------
  getTrackedItems: () => ipcRenderer.invoke('get-tracked-items'),
  setTrackedItems: (items) => ipcRenderer.invoke('set-tracked-items', items),
  getRunCounts: () => ipcRenderer.invoke('get-run-counts'),
  setRunCount: (payload) => ipcRenderer.invoke('set-run-count', payload),

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
  }
}

contextBridge.exposeInMainWorld('api', api)
