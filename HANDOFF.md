# Ghost Companion — Session Handoff

_Last updated: 2026-06-30. Read this first when resuming work on this tool._

## What this is
An always-on-top Destiny 2 loot-farming overlay.
- **Client:** Electron + React, frameless / pinned to the right edge of the
  primary display, width locked to **420px**, see-through via `setOpacity(0.92)`.
  Dev runs via `npm run dev` (electron-vite). **As of 2026-06-30 it is ALSO
  packaged + distributed** as a Windows NSIS installer via GitHub Releases with
  electron-updater auto-update — see "## Distribution / releases". Client-side
  fixes are "live" the moment the dev app reloads; they never go through Railway,
  but to reach end users they must be cut into a **new tagged release**.
- **Server:** a small Express data-API deployed on **Railway**
  (`ghost-companion-production.up.railway.app`). Railway **root dir = `server`**,
  **auto-deploys on `git push` to `main`**.

## How to run / deploy
- **Dev app:** `npm run dev` (from repo root). Renderer at `localhost:5173`,
  Electron main loads it. Manifest + auto-tracker start automatically.
- **Deploy server:** `git push origin main` → Railway redeploys (watch uptime
  reset on `/health`). Only `server/**` changes need a deploy.
- **Verify server:** `GET /health`, `/xur` (hourly cache, `?force=1`),
  `/monument` (6h cache, `?force=1`), `/paths` (`?reload=1` reloads file
  server-side), `/`.

## Distribution / releases (set up 2026-06-30)
- **Repo is PUBLIC:** `github.com/SonrisaPerro/ghost-companion`. Friend installs
  with no collaborator invite; electron-updater can reach `latest.yml` without a
  token (which is why public beats private here).
- **Release pipeline:** push a `v*` tag to `main` → `.github/workflows/release.yml`
  (windows-latest) runs `npm ci` → `electron-vite build` → `electron-builder
  --publish always`. The two Actions secrets (`BUNGIE_API_KEY`, `BUNGIE_CLIENT_ID`)
  are baked in at build time via the Vite `define` in `electron.vite.config.js`.
  Output: `Ghost-Companion-Setup-<ver>.exe` + `.blockmap` + `latest.yml` attached
  to a GitHub Release.
- **⚠️ GOTCHA — electron-builder publishes the release as a DRAFT.** After the
  Actions run goes green you MUST go to the Releases page and **publish the draft**,
  or the friend can't download it and auto-update won't see it.
- **To ship a change:** bump `version` in `package.json`, commit to `main`,
  `git tag -a vX.Y.Z && git push origin main --tags`, wait for green, publish the
  draft. Secrets must already exist before tagging (else a credential-less binary).
- **Shipped:** `v1.0.0` (live), `v1.0.1` (SmileCo installer branding — in progress
  / publish the draft when green).
- **SmileCo branding (v1.0.1):** `build.win.publisherName:"SmileCo"` +
  `build.copyright` + `nsis.uninstallDisplayName` → "SmileCo" shows in File
  Properties (Company/Copyright), the UAC prompt, and Add/Remove Programs. It does
  **NOT** change the SmartScreen "Unknown publisher" banner — that needs an
  Authenticode cert. Removing the warning entirely = **EV code-signing cert**
  (~$400–700/yr, instant SmartScreen trust); OV cert warms up over downloads.
  Staying unsigned (friend clicks "More info → Run anyway") is fine for now.

## Monument to Lost Lights (`/monument` live read)
- Vendor hash **4230408743** ("Exotic Archive"), confirmed via
  `npm run lookup -- --vendors monument`. **Not** 3990434998 (an old hash).
- Structure gotcha: the top-level vendor sells **3 itemType-0 category
  containers** ("Light and Dark Saga Exotics", "Fate Saga Exotics", "Legacy
  Gear"), NOT the exotics directly. Each container's `preview.previewVendorHash`
  is a sub-vendor and `preview.derivedItemCategories[].items[]` lists the child
  exotic hashes. `monument.js` follows the containers, enumerates the derived
  items, filters to Exotic weapons/armor (`gear.js`), and pulls costs from the
  sub-vendor when readable (usually it isn't → costs blank).
- **Finding (2026-06-29):** catalog = **51 non-raid legacy exotic weapons, 0
  armor**. Raid/dungeon exotics are *absent* (pulled once they became farmable);
  exotic armor moved to Rahool focusing. So Monument paths apply to NEW legacy
  exotics, never to our raid/dungeon items.

## Eververse ornament tracker (`/eververse` live read)
- **Why:** some weapon ornaments have NO activity/quest source — their only
  acquisition is Eververse (Bright Dust = grindable, or Silver = real money), and
  availability **rotates**. The Manifest can't say "is it buyable today", so we read
  the live shop and report which tracked ornaments are for sale right now + cost.
- **Registry:** `server/data/ornaments.json` (+ identical `src/data/ornaments.json`
  mirror), `trackedOrnaments[]` keyed by `itemHash`. **Expanded 2026-06-29** from The
  Last Word's 4 to a **curated iconic exotic-weapon set: 20 weapons / 80 ornaments**
  (Last Word, Thorn, Ace of Spades, Hawkmoon, Whisper, Sleeper, Vex Mythoclast,
  Outbreak Perfected, Monte Carlo, Trinity Ghoul, Touch of Malice, Xenophage, The
  Lament, Le Monarque, Sunshot, Riskrunner, MIDA, One Thousand Voices, Witherhoard,
  Graviton Lance). Every `itemHash` + weapon association is **Manifest-verified** by
  walking each weapon's `WEAPON COSMETICS` socket → `reusablePlugSetHash` → plug items
  with `traitIds` incl. `item.ornament.weapon`, filtered to collectible `sourceString`
  "Source: Eververse" (the walker reproduces the 4 known Last Word ornaments exactly).
  The full master list is **131 exotic weapons / 354 Eververse ornaments** if ever
  broadening past the curated set. Read the local app Manifest offline with Node 24's
  built-in `node:sqlite` (`%APPDATA%/ghost-companion/manifest/world_content.sqlite`) —
  the app's `better-sqlite3` is built for Electron's ABI and won't load under system
  node.
- **Vendor hashes (`config.js EVERVERSE_VENDOR_HASHES`):** `[3361454721,
  3790213143, 788270413]` (`lookup --vendors "tess"`). **Only 3361454721 is
  character-readable** (the others return Bungie `1622`); it carries the full ~224
  cosmetic sales directly — ornaments included — so a **plain itemHash match** is
  enough. **No category-container following** (that's a Monument-only thing; here it
  just caused failing 1622 sub-vendor reads + 224 redundant def lookups — removed).
- **`resolveEververse()`** (`eververse.js`): reads each screen's sales, matches
  tracked itemHashes, classifies cost currency (`bright_dust`/`silver`/`glimmer`).
  Returns `{ source:'live'|'fallback', vendor.present, anyInShop, inShop[] (with
  cost), notInShop[], diagnostics }`. `source:'live'` only on an authoritative read;
  on token/network failure → `fallback` and everything goes to `notInShop` (never
  falsely claims something's for sale). `/eververse` route, 1h cache, `?force=1`.
  CLI: `npm run eververse` (needs creds in env).
- **Client UI (wired 2026-06-29):** `EverversePanel` in `GhostCompanion.jsx` pings
  `/eververse` on mount (via `window.api.getEververse` → IPC `get-eververse` →
  `data-api.getEververse`, 1h cache + `{force:true}` on API-URL save, same plumbing
  as Xûr). Lists each in-shop tracked ornament (weapon, ornament name, cost coloured
  by currency: Bright Dust blue / Silver gold / Glimmer green) with a "grab them
  before the shop rotates" nudge; clicking an entry scans the parent weapon. Renders
  **only on `source:'live'` + `anyInShop` + ≥1 `inShop`** — same fail-closed discipline
  as `XurPanel` (never on fallback/unknown). App isn't packaged, so it shows on
  `npm run dev`.
- **Verified live 2026-06-29:** after the expand+deploy, `/eververse` `source:live`,
  `trackedCount:80`, **27 of the tracked ornaments in shop** (all 700 Silver — a
  freshly-rotated batch incl. End of an Era, Essentialism (Thorn), Gilded Cage
  (Whisper), 3× Vex Mythoclast, etc.).
- **"Activity-earned-only" ornaments** would live as a static `ornaments[]` on the
  weapon's paths entry — none of the curated weapons surfaced any (all their ornaments
  are Eververse), so nothing static was added.

## This Week concierge (`/weekly`) — Stages 1–2 (2026-06-30)
- **What:** one-fetch Tower concierge aggregating everything a player checks each
  reset. Client **WEEK tab** (`ThisWeekPanel` in `GhostCompanion.jsx`) renders it.
  Server `getWeekly()` in `server/index.js` composes sub-sources; 15-min edge cache,
  `?force=1` bypasses (and reloads `rotations.json`).
- **Stage 1 (live API sources), each self-gated by its own `source` flag:**
  - **Xûr** (`/xur` resolver) — live stock + presence.
  - **Eververse** (`trimEververse` of `/eververse`) — tracked ornaments in shop.
    WEEK-tab list is **collapsible** (`WeekSection collapsible`), count in header.
  - **Activities** (`resolveActivities`, `src/milestones.js`) — raids/dungeons from
    the PUBLIC milestones (API-key only, no OAuth). Lists which raids are *available*
    + reset end time; the public API does NOT expose *featured/farmable*.
- **Stage 2 (deterministic rotations — `src/rotations.js` + `data/rotations.json`):**
  the featured raid pair, featured dungeon pair, and GM Nightfall (+reward) are NOT
  in any Bungie endpoint. `resolveRotations()` reads an **explicit per-week lookup
  table** keyed by weekly-reset ISO (Tue 17:00 UTC) — deliberately **no forward
  extrapolation** until a verified community ordered-list exists (honest-over-clever:
  a fabricated ordering looks right for one week then silently drifts). Returns
  `source:'computed'` for entered weeks, `'unknown'` otherwise. Folded into `/weekly`
  as `rotations`; WEEK tab shows a **"Featured · Farmable This Week"** section
  (`FeaturedRow` chips + GM line), self-hiding when unknown. **7 node:test cases**
  (`server/scripts/rotations.test.mjs`, `node --test`) pin the 2026-06-30 ground
  truth (Crota's End + Vault of Glass / Warlord's Ruin + Grasp of Avarice / Sunless
  Cell → Null Composure) incl. reset-boundary math. Verified live on Railway.
  - **To add a week:** append an entry to `server/data/rotations.json` (verify the
    values first), `git push` → Railway. No code change.
- **OAuth is now TWO apps (hard-won):** desktop = PUBLIC client 53408 (no refresh
  token). The Railway server uses a SEPARATE **CONFIDENTIAL** app (client_id +
  secret + refresh_token + api_key, all same app) that MUST have the "Read your
  Destiny vendor and advisor data" scope or vendor reads 2108. Minting + error
  decoder documented in the `ghost_companion_bungie_oauth_architecture` memory.

## Architecture quick map
- `src/main/index.js` — Electron main: creates the overlay window, tray, IPC,
  starts AutoTracker. **Window bounds now validated against connected displays
  on launch** (`isReachable()`); `transparent:false` (see Known Issues).
- `src/main/bungie-api.js` — OAuth refresh-token grant (**PUBLIC client** as of
  2026-06-30 — no `client_secret`; `postToken()` adds HTTP Basic auth ONLY when a
  secret is present, else sends `client_id` in the body, so the public flow works),
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
- **Current state: 49 items each.** Includes:
  - **15 Monument to Lost Lights exotics** (added 2026-06-29) — Ace of Spades,
    Thorn, The Last Word, Witherhoard, Izanagi's Burden, Jötunn, Truth, Sleeper
    Simulant, Le Monarque, Ticuu's Divination, Lorentz Driver, Lumina, Bad Juju,
    Polaris Lance, Eriana's Vow. Each is a single `vendor` path (Exotic Archive),
    doubly verified: live `/monument` read **and** the Manifest collectible
    `sourceString` "Source: Exotic Archive at the Tower". Original quests are
    vaulted (noted in `notes` as historical), so the Monument is the real source.
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
4. **Next-dev-batch plan (`tranquil-growing-peacock.md`) is BUILT + committed.**
   All three builds landed (the plan file is now historical):
   - Build 1 hide-to-tray + always-on-top **PIN** toggle — `7b75d41` (renderer
     header buttons ~`GhostCompanion.jsx:1679`/`:1691`).
   - Build 2 ornaments-on-card — `7b75d41`: `getWeaponOrnaments` in `manifest.js`,
     IPC + `trackedOrnaments` store, `OrnamentsPanel` (`:918`), server `shopSales`
     in `server/src/eververse.js:112`, shop-cost merge (`:1590`).
   - Build 3 data-packages — `3f8badd` went **past** the "design only" scope:
     `src/main/packages.js` (validate/merge/export, pure), import via
     `dialog.showOpenDialog` + text import + **drag-and-drop** onto the window
     (`:1479`), export via `showSaveDialog`, `GuidesPanel` (`:1014`) on item cards
     + a list in the Account panel.
   - `npm run build` compiles all three clean (verified 2026-06-30).
5. **Guide-package follow-up batch — BUILT 2026-06-30 (uncommitted at time of
   writing).** Three additions on top of Build 3:
   - **Hard limits / safety (`src/main/packages.js`):** `LIMITS` + `MAX`
     constants, `withinSizeLimit()` byte gate (512 KB), slug-only ids, per-field
     length + count caps. Reject-not-truncate. Enforced at BOTH import boundaries
     (`importGuideFromText` in `src/main/index.js`; renderer drag-drop pre-read
     guard). **15 unit tests** in `test/packages.test.js` (`npm test`).
   - **Community library (Build A):** server loads/validates
     `server/data/guides/*.ghostpkg.json` via `server/src/guides.js`; **`GET
     /guides`** (index) + **`GET /guides/:id`** (full package, slug-guarded →
     400/404). Client: `data-api.getCommunityGuides` / `getCommunityGuidePackage`,
     IPC `get-community-guides` / `import-community-guide`, `CommunityLibrary`
     browser in the Account panel. Re-import UPDATES via id-merge (no dupes) —
     verified end-to-end. First curated pack:
     `server/data/guides/vespers-host-secret-chests.ghostpkg.json` (3 guides,
     3.6 KB; one linked to Ice Breaker `1111334348`).
   - **Create Guide form (Build B):** `CreateGuideForm` in the Account panel
     (title, type, item-search link, activity, dynamic steps, notes) → IPC
     `add-guide` → slug id + same validate/merge path.
   - **Server LIMITS mirror:** `server/src/guides.js` duplicates the caps from
     `packages.js` (separate deploy root — keep the two in sync).
   - **Deploy note:** the `/guides` endpoints need a Railway redeploy
     (`git push` → Railway) before the client library browser shows anything.
   **Reminder: shipping any client change now requires a new tagged release**
   (bump version → tag → publish draft).
6. **v1.0.1 draft** — publish it live once its Actions run is green (SmileCo
   installer branding). Same draft-publish step as v1.0.0.

## SECURITY — do not slip on this
- **Bungie secret rotation — DONE 2026-06-30.** Resolved by switching the Bungie
  app to a **PUBLIC OAuth client** (client_id `53408`, no secret exists anymore)
  and **regenerating the API key** (login verified working under the new key).
  The leaked old `client_secret`/key are dead (regeneration invalidates the old
  key; a public client has no secret). New `BUNGIE_API_KEY` + `BUNGIE_CLIENT_ID`
  live in the gitignored client `.env` AND as **GitHub Actions repo secrets**
  (baked into CI builds). **Never** put these in source. Note: the API key IS
  extractable from the shipped `.exe` — inherent to any client-side app and
  acceptable for a public client; if ever abused, regenerate the key + ship a new
  release. Git history was scanned 2026-06-30: real `.env` was never committed
  (only `.env.example` templates), so making the repo public exposed no secrets.
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
- _(this session, 2026-06-30)_ — **This Week concierge Stages 1–2.** `/weekly`
  aggregator (Xûr + Eververse + activities + rotations); collapsible Eververse list;
  window-sizing fix (width 460, capped default height, wrapping header); **Stage 2**
  deterministic rotation resolver + table + 7 tests + WEEK-tab Featured section
  (`d4d8256`). All deployed + verified live on Railway.
- **`v1.0.1`** — brand Windows installer as **SmileCo** (`build.win.publisherName`,
  `copyright`, `nsis.uninstallDisplayName`); version bump. Release workflow.
- **`v1.0.0`** — first distributed release. Public Bungie OAuth client + regenerated
  API key baked via CI; electron-builder NSIS + electron-updater; repo made public.
- _(this session)_ — added **15 Monument exotics** to the data (49 items total);
  built the **`/monument` live-read endpoint** (resolver + shared `gear.js` +
  `getVendorSales`). Deployed + verified.
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
