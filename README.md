# Ghost Companion 👻

An always-on-top desktop overlay for **Destiny 2** that auto-tracks loot-farming
progress. It watches your activity completions via the Bungie API (free) and
increments your run counters automatically — no manual clicking.

Built with **electron-vite** (Electron + React + Vite), **better-sqlite3**
(Manifest queries), **electron-store** (persistence), and **node-fetch**.

---

## 1. Prerequisites

- Node.js 18+ and npm
- A Bungie application: https://www.bungie.net/en/Application
  - Copy your **API Key**, **OAuth client_id**, and (if "Confidential") **client_secret**
  - Set the OAuth **Redirect URL** to match `BUNGIE_REDIRECT_URL` in your `.env`
    (e.g. `https://localhost/ghost-companion/callback`)

> **Windows note:** `better-sqlite3` is a native module. If `npm install` fails to
> build it, install the build tools: `npm install --global windows-build-tools`
> or install "Desktop development with C++" via the Visual Studio Installer.

## 2. Setup

```bash
cd ghost-companion
cp .env.example .env        # then edit .env with your Bungie credentials
npm install                 # also runs electron-builder install-app-deps (rebuilds native modules)
```

## 3. Run

```bash
npm run dev      # launches the overlay with hot reload
npm run build    # production build into out/
npm run start    # preview the production build
npm run dist     # package a distributable (electron-builder)
```

On first launch the app downloads the Destiny 2 **Manifest** (~hundreds of MB)
into your user-data folder and checks the version on every subsequent launch.

---

## How it works

| Concern            | File                              |
| ------------------ | --------------------------------- |
| Window / tray / IPC| `src/main/index.js`               |
| Bungie API + OAuth | `src/main/bungie-api.js`          |
| Manifest download/query | `src/main/manifest.js`       |
| Activity polling   | `src/main/auto-tracker.js`        |
| Safe renderer bridge | `src/preload/index.js`          |
| UI (replaceable)   | `src/renderer/src/App.jsx`        |
| Drop-rate data     | `src/data/dropRates.json`         |

### Auto-tracking

Every **60 seconds** the tracker calls `GetActivityHistory` for each of your
characters. When it sees a *new completed* activity whose `referenceId` /
`directorActivityHash` matches a tracked path's `sourceActivityHash`, it:

1. increments that path's run count in `electron-store`, and
2. pushes a `new-completion-detected` event to the renderer (live UI update + toast).

De-duplication uses a per-character "last seen instanceId" so a completion is
only counted once.

### IPC surface (exposed as `window.api` in the renderer)

`login` · `logout` · `getAuthStatus` · `searchManifest` · `getActivityHistory`
· `getTrackedItems` / `setTrackedItems` · `getRunCounts` / `setRunCount`
· `toggleAlwaysOnTop` / `getAlwaysOnTop` · `minimizeWindow` / `hideWindow`
· `onCompletionDetected(cb)` (push event; returns an unsubscribe fn)

### Window behaviour

Frameless, 420px wide, full screen height, pinned to the right edge, 0.92 opacity,
always-on-top (toggle in the header), and minimizes to a system tray icon with
**Show/Hide** and **Quit**. Position/size are remembered via `electron-store`.

---

## Customizing the data

`src/data/dropRates.json` ships with 10 popular items as examples. The
`itemHash` and `sourceActivityHash` values are **placeholders** — verify them
against your local Manifest (use the in-app search, which calls `search-manifest`)
before relying on auto-tracking, since auto-tracking matches completions by
`sourceActivityHash`.

## Replacing the UI

`src/renderer/src/App.jsx` is a working placeholder that exercises every API
method. Drop in your own UI and keep calling `window.api.*`.
