# Ghost Companion — Session Handoff

_Last updated: 2026-06-29. Read this first when resuming work on this tool._

## What this is
An always-on-top Destiny 2 loot-farming overlay.
- **Client:** Electron + React, frameless / pinned to the right edge of the
  primary display, width locked to **420px**, see-through via `setOpacity(0.92)`.
  Runs **only** via `npm run dev` (electron-vite) — it is *not* packaged or
  distributed. Client-side fixes are "live" the moment the app reloads; they
  never go through Railway.
- **Server:** a small Express data-API deployed on **Railway**
  (`ghost-companion-production.up.railway.app`). Railway **root dir = `server`**,
  **auto-deploys on `git push` to `main`**.

## How to run / deploy
- **Dev app:** `npm run dev` (from repo root). Renderer at `localhost:5173`,
  Electron main loads it. Manifest + auto-tracker start automatically.
- **Deploy server:** `git push origin main` → Railway redeploys (watch uptime
  reset on `/health`). Only `server/**` changes need a deploy.
- **Verify server:** `GET /health`, `/rotation` (hourly cache, `?force=1`),
  `/paths` (`?reload=1` reloads file server-side), `/`.

## Architecture quick map
- `src/main/index.js` — Electron main: creates the overlay window, tray, IPC,
  starts AutoTracker. **Window bounds now validated against connected displays
  on launch** (`isReachable()`); `transparent:false` (see Known Issues).
- `src/main/bungie-api.js` — OAuth refresh-token grant (confidential client),
  profile, activity history. Tokens persisted in electron-store.
- `src/main/manifest.js` — better-sqlite3 **read-only** Manifest queries via an
  Electron-as-Node self-relaunch shim (`ELECTRON_RUN_AS_NODE=1`). Manifest at
  `%APPDATA%/ghost-companion/manifest/world_content.sqlite`.
- `src/main/data-api.js` — fetches `/rotation` + `/paths` from Railway; in-memory
  1h cache. `baseUrl()` tolerates a bare host (prepends `https://`).
- `src/main/auto-tracker.js` — polls activity history, auto-increments run counts.
- `src/renderer/src/GhostCompanion.jsx` — the whole UI. Header drag region (~line
  1126) uses `WebkitAppRegion:"drag"`; buttons use `"no-drag"`. `C.bg = #05080F`.
  ACCT button opens the Account panel with the **"Data API URL (optional)"** field.

## Data files (keep these two IDENTICAL — same content, different homes)
- `src/data/dropRates.json` — bundled into the renderer (client).
- `server/data/paths.json` — served by the API (`/paths`).
- Both keyed by item **NAME**, each with `acquisitionPaths[]`. Drop rates are
  community estimates (explicitly disclaimed in the UI).
- **Current state: 34 items each.** Includes:
  - Two set-level vendor entries: **Vanguard Tactician Armor** (hash 4252280581)
    and **Vanguard Tactician Arsenal** (hash 1616736576) — `vendor` path, focus at
    Commander Zavala. Note: the API does **not** expose individual set-piece names
    (see Investigations), so these are set-level with an honest caveat in `notes`.
  - **8 verified-craftable weapons** with a `craftable` path (Enclave): Zaouli's
    Bane, Apex Predator, Fatebringer, Vision of Confluence, Hezen Vengeance,
    Corrective Measure, Found Verdict, Praedyth's Revenge.

## Manifest gotchas (hard-won — don't relearn these)
- **Craftability lives on the itemType-30 "pattern" variant**, NOT the itemType-3
  weapon. Check craftability by **scanning all same-named variants** for a
  top-level `crafting` block (`crafting.outputItemHash`). Filtering to `itemType
  === 3` gives false negatives.
- itemType: 3 = equippable Weapon; 30 = pattern (carries `crafting`); 0 = armor-set
  container / exotic class items.
- **Vendor pools are dynamic.** Live Bungie reads beat the manifest's stale
  `displaySource`. Zavala's *current* pool is Vanguard Tactician (manifest said
  "Vigil of Heroes" — stale). Hawthorne (queryable hash **3347378076**, not
  3278482180) exposes only raid banners / legacy gear — **no Portal-gear focusing**.

## Known issues / open threads
1. **Window drag — VERIFY ON NEXT LAUNCH.** Off-screen launch is fixed (stale
   bounds at `x:2645` sat in the monitor gap between DISPLAY1 [0–2560] and
   DISPLAY2 [3840+]; now clamped to pinned-right default, confirmed at rect
   L2140,T0,R2560,B1392). User had not yet confirmed the header drag actually
   moves the window after the fix — **ask them to test dragging the top bar.** If
   it still resists with the window fully on-screen, investigate the renderer
   header `WebkitAppRegion:"drag"` region and whether a "loading" state delays the
   header rendering.
2. **Set-piece enumeration is impossible via the manifest.** Vanguard Tactician
   set nodes are itemType-0 with no gearset/derivedItemCategories/
   previewVendorHash/equippableItemSetHash/displaySource. Set-level entries are the
   honest ceiling unless a new data source appears.
3. **Edge of Fate loot reality** (see memory): no Nightfall/Trials weekly featured
   weapon to target anymore (random drops) — this kills the rotation feature's
   value; Portal gear only via Hawthorne clan engrams. Worth reconsidering what
   `/rotation` should surface.

## SECURITY — do not slip on this
- **Bungie secret rotation was DUE 2026-06-29 (today).** The leaked
  `client_secret` and API key were pasted in chat in a prior session and must be
  regenerated in the Bungie dev portal. See memory `rotate_bungie_secrets.md`.
  When rotating: new values go **only** to the gitignored client `.env` and
  Railway env vars — **never** into source. A client_secret embedded in a
  distributed desktop app can't stay secret (acceptable here only because this is
  run-from-source, single-user).
- Live OAuth tokens (incl. refreshToken) live in
  `%APPDATA%/ghost-companion/config.json`. Never commit or echo them into tracked
  files.

## Store / config notes
- electron-store at `%APPDATA%/ghost-companion/config.json` (single store for the
  run-from-source app). Keys: `window.bounds`, `window.alwaysOnTop`, `dataApiUrl`,
  tracked items, `runCounts`, `userDropRates`.
- If you ever hand-edit this file from PowerShell, **write UTF-8 *without* BOM**
  (`[System.IO.File]::WriteAllText` with `UTF8Encoding($false)`). PS 5.1's
  `Set-Content -Encoding utf8` adds a BOM that crashes electron-store's JSON parse.

## Recent commits
- `2199f61` — window bounds validation + `transparent:false` + bare-host URL
  tolerance (client-only, **may be unpushed** — check `git status`).
- `6d28333` — deployed 34-item data set (Vanguard Tactician + 8 craftable paths)
  and the `SOURCE: Source:` dedup fix.
