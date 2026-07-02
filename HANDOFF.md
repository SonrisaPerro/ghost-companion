# Ghost Companion — Session Handoff

_Last updated: 2026-07-02 (v1.1.0). Read this first when resuming work on this tool._

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
- **AUTO-PUBLISH (as of v1.0.6, 2026-07-01):** `build.publish` in `package.json`
  now sets `"releaseType": "release"`, so a tagged CI build publishes the release
  directly — **no manual draft-publish step**. Verified live on v1.0.6.
  - _Historical gotcha (pre-v1.0.6):_ electron-builder's default `releaseType` is
    `draft`, so v1.0.0–v1.0.5 each published as a DRAFT that had to be published by
    hand on the Releases page before the friend could download / auto-update could
    see it. That manual step is gone now; kept here only so the old commits make sense.
- **⚠️ VERIFICATION TRAP — the unauthenticated GitHub releases API only returns
  PUBLISHED releases; drafts are invisible without a token.** So a `curl` of
  `/releases` that shows every version "published" is NOT evidence the pipeline
  auto-publishes — you're only seeing the ones already published by hand. Don't
  conclude "auto-publish" from that call. To check draft state, use an
  authenticated request (`gh`/PAT) or the Releases page in the browser.
- **To ship a change:** bump `version` in `package.json`, commit to `main`,
  `git tag -a vX.Y.Z && git push origin main --tags`, wait for green, publish the
  draft. Secrets must already exist before tagging (else a credential-less binary).
- **Shipped:** `v1.0.0`–`v1.0.7` all live (published). **`v1.0.7` (2026-07-01) is
  the current latest** = live catalyst/pattern progress on item cards + "CHASE
  WEAPONS HERE" rotation join (WEEK tab) + the Xûr schedule-window presence fix
  (see the two dedicated sections below). `v1.0.6` = sustainable rotation pipeline
  (seed + auto-refresh), notifier cache-efficiency, and the `releaseType:"release"`
  auto-publish flip. `v1.0.5` = This Week concierge Stages 1–4. `/releases/latest`
  resolves to v1.0.7 (auto-published; workflow run went green + not-draft, verified).
  Hand friends
  `github.com/SonrisaPerro/ghost-companion/releases/latest` → grab the Setup .exe →
  "More info → Run anyway" past SmartScreen (app is unsigned).
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

## This Week concierge (`/weekly`) — Stages 1–4 (2026-06-30)
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
- **Stage 2 (rotations — `src/rotations.js` + `src/rotations-source.js` +
  `data/rotations.json`):** the featured raid pair, featured dungeon pair, and weekly
  **Grandmaster Alert** (post-Edge-of-Fate name for the old "GM Nightfall"; see below)
  are NOT in any Bungie endpoint. **Two honest layers, no forward extrapolation:**
  - **SEED** — hand-verified per-week entries in `data/rotations.json` (schema 2),
    keyed by weekly-reset ISO (Tue 17:00 UTC), `verified:true`, `source:"seed"`.
    Take precedence over fetched data.
  - **AUTO-REFRESH (2026-07-01, #7)** — for a current week NOT seeded, `ensureRotations()`
    fetches raids/dungeons **once** from a **vetted community source** (Kyber's Corner
    stable page, `rotations-source.js`) and caches in-memory (`verified:false`,
    `source:"kyberscorner"`). Coalesced + 30-min negative cache. **Four safety rails**
    so a scrape only ever ADDS data, never wrong data: stable URL; **gate on the page's
    `article:modified_time` ≥ this week's reset** (Kyber's updates the featured titles
    but leaves the visible date text STALE, so trust the freshness metadata, not the
    on-page date); scraped titles must match known raid/dungeon POOLS; require ≥1 of
    each. Any failure → `source:'unknown'` → WEEK tab hides the card.
  - **No modular extrapolation** — verified no source publishes a full ordered cycle
    (Shacknews stale; Blueberries 403s bots; Kyber's dedicated pages show only the
    current week). Extrapolating would be plausible-but-unprovable, so we don't.
  - `resolveRotations()` = sync read of current known state; `ensureRotations()` =
    async (fetch-if-missing) used by `/weekly`. **12 node:test cases** pin the
    2026-06-30 seed ground truth + the parser rails (fixture-based, no network).
  - **GM Alert weapon:** `fetchGmWeapon()` (`rotations-source.js`) now attempts a
    best-effort parallel scrape of Kyber's GM page (`GM_SOURCE_URL`). Extracts the
    `(Adept)` weapon name with staleness rail + plausibility check; null on any failure
    (safe). Merged into the `fetchWeek()` result automatically — `rotations.js` needs
    no changes. Will populate `grandmasterAlert.weapon` when Kyber's page has data.
  - **Refresh weeks:** `node scripts/refresh-rotations.mjs [--write] [--week ISO]`
    (dry-run prints, `--write` upserts raids/dungeons; add `grandmasterAlert` by hand;
    refuses to overwrite a `verified` seed). Or just let the runtime auto-refresh fill
    it. `?force=1` on `/weekly` also reloads `rotations.json`.
- **Stage 3 (live Banshee-44 — `src/banshee.js` + `/banshee`):** Banshee's weekly
  legendary weapon rotation (buyable = targetable). `resolveBanshee()` reuses the
  verified `getVendorSales` path (vendor hash **672118013**, confirmed offline via
  `scripts/probe-vendors.mjs`), filters sales to Legendary/Exotic weapons,
  exotics-first. Folded into `/weekly` as `banshee`; WEEK tab has a collapsible blue
  **BansheeSection** (each weapon scannable). **Verified live** (6 weapons:
  Compass Rose, Indebted Kindness, Multimach CCX, Rose, The Hothead Adept, VS Chill
  Inhibitor). Needs the confidential token (per-character vendor read) → verify by
  curling the deployed Railway endpoint, not locally.
  - **GM Nightfall reward — PROBED, dead end:** no Bungie endpoint exposes the weekly
    featured GM reward. Static activity defs carry only generic engram/tier rewards
    (467 nightfall-named defs share the same reward hashes); public milestones omit
    GM entirely. So it lives in the `rotations.json` table (Stage 2), not an API read.
  - **Ada-1 (350061650) left out:** sells shaders/transmog (Material Exchange) —
    cosmetic, out of scope for a loot overlay. Hash is known if ever wanted.
- **Stage 4 (notifier — `src/main/notifier.js`):** added **"Xûr has arrived"** (once
  per weekly visit, deduped by `weekOf`, independent of tracked items) and a
  **Banshee tracked-weapon** alert (tracked items vs `dataApi.getBanshee()`). Daily
  **Lost Sector intentionally uncovered** — no API source post-Edge-of-Fate (same
  finding as the GM probe). Existing coverage unchanged (Eververse ornament, Xûr
  tracked item, Tuesday reset). Main-process change → needs a `npm run dev` restart.
  - **Efficiency (2026-07-01, #9):** the vendor checks no longer pass `{force:true}`
    — they respect data-api's 1h cache, so a 30-min poll is a cache hit every other
    tick and piggybacks on UI fetches (weekly/daily rotations never miss an alert in
    an hour). Stops each install hammering Railway every 30 min.
- **OAuth is now TWO apps (hard-won):** desktop = PUBLIC client 53408 (no refresh
  token). The Railway server uses a SEPARATE **CONFIDENTIAL** app (client_id +
  secret + refresh_token + api_key, all same app) that MUST have the "Read your
  Destiny vendor and advisor data" scope or vendor reads 2108. Minting + error
  decoder documented in the `ghost_companion_bungie_oauth_architecture` memory.

## Live progress + chase weapons (v1.0.7, 2026-07-01)
- **Live catalyst & pattern progress (item cards):** on scan, the renderer reads
  the player's **profile Records (component 900)** and shows real numbers instead
  of a static "has a catalyst" note.
  - **Foundation (`src/main/bungie-api.js`):** `getPlayerRecords(store,{force})`
    fetches component 900 (profile + character records, best-progress wins),
    in-memory **10-min cache**; `lookupRecords(hashes)` returns
    `{objectives:[{objectiveHash,progress,completionValue,complete}],complete}`.
    IPC `get-record-progress` (`index.js`) → preload `getRecordProgress`.
  - **Manifest (`src/main/manifest.js`):** `resolveCatalyst()` now also emits
    `recordHash` + per-objective `objectiveHash` (the join keys into 900).
    `getPatternIndex()`/`resolvePattern(name)` = a lazily-built, **collision-free**
    map (183 records, unique names, verified) of craftable **pattern** records —
    a record named exactly the weapon whose objective progressDescription is
    "Pattern progress" (target usually 5, or 1 for exotic-mission weapons).
    `getWeaponPerks()` returns `{catalyst, pattern, intrinsic, columns}`.
  - **UI (`WeaponPerksPanel` in `GhostCompanion.jsx`):** catalyst card shows live
    `x/y` + bars + ✓ COMPLETE; a new purple **Craftable Pattern** card shows `x/5`
    + bar / ✓ UNLOCKED. **Fail-safe:** logged-out/uncached falls back to the static
    target + "sign in to track" — it never shows a wrong number.
- **Chase weapons (Theme 2, WEEK tab):** pure client-side join (`featuredChaseItems`
  in `GhostCompanion.jsx`) of the weekly featured raid/dungeon rotation to the drop
  catalog by `location`; renders a **"CHASE WEAPONS HERE"** block grouped by activity
  with **tracked items starred**. No server change (renderer already has both the
  catalog and `weeklyData.rotations`).

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
- **Current state: 79 items each (expanded v1.0.8, hashes verified v1.0.9, further additions + full accuracy pass v1.1.0).** Includes:
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
   - **PRESENCE SCHEDULE-GATE (v1.0.7, 2026-07-01):** the `enabled` flag alone is
     NOT sufficient — Bungie leaves it `true` and keeps serving Xûr's *last
     appearance's* stock during his absence window, so the app showed "The Tower"
     with full stock on a Wednesday when he isn't there. `resolveXur` now also
     requires `isXurInWindow()` (`server/src/xur.js`): he's in-world **Fri 17:00 →
     Tue 17:00 UTC** (arrives Fri daily reset, departs Tue weekly reset; resets are
     DST-independent so a UTC day/hour gate is exact). `present = stock.present &&
     isXurInWindow()`. The notifier reads the same `present`, so no false
     "Xûr has arrived" on Wed/Thu. Location label corrected "near Ikora" → "The
     Tower (Hangar)". Verified: live `/xur` flipped to `present:false` post-deploy.
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
6. **All releases through v1.1.0 are published + live — nothing pending.** Auto-publish
   has been reliable since v1.0.6. No known open build work. The only structural dead-end
   is #2 (set-piece enumeration), which no data source can satisfy.

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
- **`v1.1.0`** (2026-07-02, live) — data: 4 new items (Wicked Implement at Monument
  Light & Dark Saga, Techeun Force craftable from Last Wish, Ashes to Assets mod from
  Ada-1, Reaper mod from Ada-1); Legendary Shards / Ascendant material cost references
  removed across all entries (removed in The Final Shape, June 2024); full July 2026
  accuracy pass: Touch of Malice Pantheon note removed (event ended 2024), One Thousand
  Voices farming note corrected (fully repeatable, no weekly lockout), Centrifuse exotic-
  archive path cost cleaned, quest-exotic `weeklyLimitPerCharacter: 1` → `null` on
  one-time paths (Gjallarhorn, Vexcalibur, Divinity, Wish-Keeper, The Navigator).
  `npm run audit` clean at 79/79.
- **`v1.0.9`** (2026-07-02, live) — data fix: 7 wrong item hashes corrected against
  the Manifest (`npm run audit`); 3 weapon-type descriptions wrong (Naeem's Lance:
  linear fusion → sniper rifle; Dragoncult Sickle: glaive → sword; Greasy Luck: SMG →
  glaive); Lost Signal was missing its craftable path (Manifest marks it craftable).
  `resetHunt` reviewed — no code bug; `itemRef.current` is always `itemData` (line 812),
  which always has `acquisitionPaths`. Both data files re-synced and verified identical.
- **`v1.0.8`** (2026-07-02, live) — monolith extraction + new-hunt flow + catalog
  expansion + GM scraper + cold-start UX. Details:
  - `GhostCompanion.jsx` 2278 → 1638 lines: `GuidePanels.jsx`
    (CommunityLibrary/CreateGuideForm/GuidesPanel/Guides) + `ThisWeekPanel.jsx`
    extracted; `inputStyle` moved to `theme.js`; `data-api.js` 161→74 lines via
    `cachedEndpoint()` factory.
  - **ResetConfirm** two-step reset button (arm→confirm) on CombinedSummary + single-path
    acquired button — zeroes all `pathRuns` + clears acquired for a fresh hunt, no
    `window.confirm()`.
  - **ThisWeekPanel cold-start** now distinguishes unconfigured ("OPEN ACCOUNT SETTINGS →")
    from unreachable ("↻ RETRY").
  - **Catalog expanded** to 60 items: 6 DSC legendaries (Trustee/Heritage/Succession/
    Posterity/Bequest/Commemoration, all craftable + encounter-drop paths) + 5 Warlord's
    Ruin legendaries (Lost Signal/Naeem's Lance/Indebted Kindness/Dragoncult Sickle/Greasy
    Luck, weekly-locked). Both files kept identical.
  - **GM scraper:** `fetchGmWeapon()` in `rotations-source.js` fires in parallel inside
    `fetchWeek()`; null-safe on any failure.
- _(session, 2026-07-02)_ — **Code quality pass (not a release — no user-facing change):**
  `d08e7f9` split the 2729-line `GhostCompanion.jsx` monolith into `theme.js`,
  `format.js`, `components/primitives.jsx`, `components/VendorPanels.jsx`,
  `components/WeaponPerksPanel.jsx`; deleted orphaned `TrackedCard.jsx` /
  `SearchResult.jsx`; perf: SQL LIKE prefilter in `searchManifest` /
  `searchActivities` (C-side scan over ~39k rows instead of full-JS parse),
  single-pass `buildRecordIndexes()` for catalyst + pattern indexes, 300ms debounce
  on both search inputs. `b8dfeb5` added ESLint (flat config, react-hooks plugin,
  `no-undef` as error — catches dead refs esbuild silently bundles; `npm run lint`
  clean) + prepared-statement cache (`stmt()` in `manifest.js`) + lint-driven
  cleanup of unused imports/variables across 5 files. **2 commits ahead of
  `origin/main`, not yet pushed.** No version bump — these are internal; ship next
  time there's a user-visible fix or feature.
- **`v1.0.7`** (2026-07-01, live) — bump `8b773a3`/`006b379`, tag pushed, CI green +
  auto-published. Contents: `6ae92cb` feat — live catalyst/pattern progress (profile
  Records 900) + "CHASE WEAPONS HERE" rotation join; `8b773a3` fix(xur) — presence
  gated on his Fri–Tue schedule window (+ "The Tower (Hangar)" label). Server fix
  deployed to Railway (live `/xur` verified `present:false`); client features reach
  users via this tagged release.
- **`v1.0.6`** (2026-07-01, live) — sustainable rotation pipeline (seed +
  auto-refresh from Kyber's Corner behind 4 safety rails), notifier
  cache-efficiency (respects data-api's 1h cache; no 30-min force refetch), and
  `build.publish.releaseType:"release"` so tags **auto-publish** (no manual draft).
  All client + server pieces verified live on Railway.
- **`v1.0.5`** (2026-07-01, live) — **This Week concierge Stages 1–4 released.**
  (Earlier note said these client changes were held to batch one release — that tag
  was cut as v1.0.5, then v1.0.6 followed. Nothing is held anymore.)
- _(session, 2026-06-30)_ — **This Week concierge Stages 1–4.** `/weekly`
  aggregator; collapsible Eververse list; window-sizing fix (width 460, capped
  default height, wrapping header); **Stage 2** rotation resolver + table + 7 tests
  + Featured section (`d4d8256`); **Stage 3** live Banshee-44 weapons (`/banshee`,
  `9542d08`) + WEEK-tab section (`871d3f0`) + GM-reward dead-end finding; **Stage 4**
  notifier Xûr-arrived + Banshee tracked-weapon alerts (`e4333b4`). Server pieces
  deployed + verified live on Railway. **Released as v1.0.5** (and superseded by
  v1.0.6) — no longer held.
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
