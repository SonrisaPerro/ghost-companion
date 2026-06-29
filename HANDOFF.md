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
- **Verify server:** `GET /health`, `/xur` (hourly cache, `?force=1`),
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
- `src/main/data-api.js` — fetches `/xur` + `/paths` from Railway; in-memory
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
  - **10 verified-craftable weapons** with a `craftable` path (Enclave): Zaouli's
    Bane, Apex Predator, Fatebringer, Vision of Confluence, Hezen Vengeance,
    Corrective Measure, Found Verdict, Praedyth's Revenge, plus the two exotic
    mission weapons **Vexcalibur** (pattern 4223953031) and **Wish-Keeper**
    (pattern 682995262), added 2026-06-29 after the audit fix surfaced them.
- **`npm run audit` is now clean and checks craftability BOTH ways**: it flags a
  `craftable` path with no Manifest recipe AND an item the Manifest marks
  craftable that has no `craftable` path. `isCraftable()` scans all same-named
  variants (not the single stored hash) — that was the false-negative bug. No
  craftable gaps remain across the 34.

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
1. **Window drag — RESOLVED 2026-06-29.** Off-screen launch fix (stale bounds at
   `x:2645` in the monitor gap between DISPLAY1 [0–2560] and DISPLAY2 [3840+], now
   clamped to pinned-right default) shipped in `2199f61`, and the user has now
   **confirmed the header bar drags the window correctly**. No further action.
2. **Set-piece enumeration is impossible via the manifest.** Vanguard Tactician
   set nodes are itemType-0 with no gearset/derivedItemCategories/
   previewVendorHash/equippableItemSetHash/displaySource. Set-level entries are the
   honest ceiling unless a new data source appears.
3. **Rotation feature — RESOLVED 2026-06-29.** Edge of Fate removed the targetable
   Nightfall/Trials featured weapon (random drops; API exposes none), so the ritual
   rotation was **deleted**. The server endpoint `/rotation` → **`/xur`** now
   resolves ONLY Xûr's live exotic stock (the one still-targetable vendor).
   Presence is authoritative: `getVendorState()` reads the Vendors `enabled` flag
   and treats Bungie `1627` as a definitive "away"; payload is `source:'live'` only
   on an authoritative read. The client's `XurPanel` renders **only** when
   `source==='live' && xur.present` — never a stale "IN TOWN". (Removed: server
   `RITUALS`/`ACTIVITY_POOLS`/`rotation.js`; client `RitualsPanel`/`RitualRow`/
   `ritualState`/`toggleRitual`/`bumpRitual`.)

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
- `a72bdaf` — audit now flags the inverse craftable gap (Manifest-craftable but
  no `craftable` path). Sweep clean across the 34 (client-only).
- `c3f1fdc` — added `craftable` paths for Vexcalibur + Wish-Keeper (deployed; both
  files kept identical; `/paths` verified live).
- `457041d` — fixed audit false negatives: `isCraftable()` scans all same-named
  variants for the itemType-30 `crafting` block (client-only).
- `050e2f4` — removed the dead Nightfall/Trials ritual rotation; `/rotation`→`/xur`
  resolves only Xûr's live exotic stock with authoritative presence (Vendors
  `enabled` + 1627=away); client `XurPanel` present-gated. **Deployed + verified
  live (`source:"live"`).**
- `2199f61` — window bounds validation + `transparent:false` + bare-host URL
  tolerance (client-only).
- `6d28333` — deployed 34-item data set (Vanguard Tactician + 8 craftable paths)
  and the `SOURCE: Source:` dedup fix.
