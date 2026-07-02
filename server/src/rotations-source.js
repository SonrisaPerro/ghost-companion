// =============================================================================
// rotations-source.js — the "vetted community source" half of the rotation
// pipeline. Fetches the current week's featured raids/dungeons from Kyber's
// Corner (a well-maintained community tracker) and returns a VALIDATED week
// object, or null if anything looks off.
//
// Why this shape (and not the alternatives we ruled out):
//   • Bungie's API does NOT expose which raid/dungeon is *featured/farmable* this
//     week — only which are *available*. So the data must come from elsewhere.
//   • There is no machine-readable community API/dataset for it (verified: the
//     trackers publish HTML articles only; some, e.g. Blueberries, 403 bots).
//   • No source publishes a full forward-ordered cycle we could verify, so we do
//     NOT extrapolate future weeks with modular arithmetic — that would be
//     plausible-but-unprovable. We only ever read the CURRENT week.
//
// Safety rails (so a scrape can never yield WRONG data — only missing data):
//   1. We fetch the STABLE page URL (per-week article slugs are inconsistent).
//   2. We require the page's article:modified_time to be at/after the current
//      weekly reset. Kyber's updates the featured TITLES but leaves the on-page
//      DATE text stale, so we trust the page's freshness metadata instead: if it
//      was edited this reset week, its titles are for this week — otherwise we
//      reject rather than key last week's set under this week.
//   3. Scraped titles must match the known raid/dungeon POOLS or they're dropped.
//   4. We require >=1 known raid AND >=1 known dungeon, else return null.
// On any failure the caller keeps source:'unknown' and the UI simply hides the
// "Featured" card — graceful, never incorrect.
// =============================================================================

// Stable pages used as sources.
export const SOURCE_URL    = 'https://kyberscorner.com/destiny2/weekly-featured-raids-and-dungeons/'
export const GM_SOURCE_URL = 'https://kyberscorner.com/destiny2/grandmaster-nightfall/'
export const SOURCE_NAME   = 'kyberscorner'

// Known activity pools, used only to CLASSIFY/VALIDATE scraped titles (a title
// is emitted only if it appears on the page AND is a recognized activity).
// Deliberately generous — over-inclusion is harmless (nothing off-page is ever
// emitted); under-inclusion would drop a real featured title. Apostrophes are
// stored straight; scraped titles are normalized to straight before matching.
export const RAID_POOL = new Set([
  'Last Wish', 'Garden of Salvation', 'Deep Stone Crypt', 'Vault of Glass',
  "Vow of the Disciple", "King's Fall", 'Root of Nightmares', "Crota's End",
  "Salvation's Edge", 'Desert Perpetual', 'Scourge of the Past', 'Crown of Sorrow',
  'Leviathan'
])
export const DUNGEON_POOL = new Set([
  'Shattered Throne', 'Pit of Heresy', 'Prophecy', 'Grasp of Avarice', 'Duality',
  'Spire of the Watcher', 'Ghosts of the Deep', "Warlord's Ruin", 'Vesper\'s Host',
  'Sundered Doctrine', 'Equilibrium'
])

/** Normalize HTML entities / curly punctuation so titles compare cleanly. */
function decode(s) {
  return s
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;|[‘’]/g, "'")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;|[–—]/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The page's article:modified_time as epoch ms, or NaN if absent/unparseable. */
export function pageModifiedAt(html) {
  const m = html.match(/property=["']article:modified_time["']\s+content=["']([^"']+)["']/)
  return m ? Date.parse(m[1]) : NaN
}

/**
 * Pure parser (no network) so it's unit-testable against a saved fixture.
 * @returns validated week object, or null if the page fails any safety rail.
 */
export function parseWeek(html, resetISO, sourceUrl = SOURCE_URL) {
  if (typeof html !== 'string' || !html) return null

  // Rail 2: the page must have been edited at/after this week's reset, so its
  // (undated) featured titles are guaranteed current and not a stale carry-over.
  const modified = pageModifiedAt(html)
  if (!Number.isFinite(modified) || modified < Date.parse(resetISO)) return null

  // Titles appear in Kyber's structured `kyber-rad-title` blocks, in document
  // order (raids first, then dungeons on the current-week card).
  const titles = [...html.matchAll(/kyber-rad-title"[^>]*>([^<]+)</g)].map((m) => decode(m[1]))

  const seen = new Set()
  const featuredRaids = []
  const featuredDungeons = []
  for (const t of titles) {
    if (seen.has(t)) continue
    seen.add(t)
    if (RAID_POOL.has(t) && featuredRaids.length < 2) featuredRaids.push(t)
    else if (DUNGEON_POOL.has(t) && featuredDungeons.length < 2) featuredDungeons.push(t)
  }

  // Rail 4: need at least one recognized raid AND dungeon or we don't trust it.
  if (!featuredRaids.length || !featuredDungeons.length) return null

  return {
    weekOf: resetISO,
    verified: false, // scraped, not hand-verified — distinct from seed entries
    source: SOURCE_NAME,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    featuredRaids,
    featuredDungeons,
    // GM Alert weapon has no stable source page (Kyber's nightfall page is
    // incomplete post-Edge-of-Fate); it only lives in hand-seeded weeks.
    grandmasterAlert: null
  }
}

// ── Shared network helper ────────────────────────────────────────────────────
async function _fetchHtml(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'GhostCompanion/1.0 (+https://github.com/SonrisaPerro/ghost-companion)' },
      signal: ac.signal
    })
    if (!res.ok) { console.error('[rotations-source] HTTP', res.status, 'from', url); return null }
    return await res.text()
  } catch (e) {
    console.error('[rotations-source] fetch failed:', url, e.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── GM Nightfall weapon (best-effort) ────────────────────────────────────────

/**
 * Pure parser: extract this week's GM weapon from Kyber's GM page HTML.
 * Returns weapon name string (e.g. "Palindrome") or null.
 */
export function parseGmWeapon(html, resetISO) {
  if (typeof html !== 'string' || !html) return null
  const modified = pageModifiedAt(html)
  if (!Number.isFinite(modified) || modified < Date.parse(resetISO)) return null
  // GM weapons always drop Adept; find the name immediately before "(Adept)"
  const m = html.match(/([A-Za-z][A-Za-z0-9 ‘’’-]{1,48}?)\s*\(Adept\)/i)
  if (!m) return null
  const name = decode(m[1]).trim()
  if (!name || name.length < 3 || name.length > 50 || /<|>|http|www/.test(name)) return null
  return name
}

/**
 * Fetch + parse the current GM nightfall weapon. Best-effort; returns null on
 * any failure so callers can fire it unconditionally in Promise.all.
 */
export async function fetchGmWeapon(resetISO, opts = {}) {
  const html = await _fetchHtml(GM_SOURCE_URL, opts)
  return html ? parseGmWeapon(html, resetISO) : null
}

// ── Main featured-rotations fetch ────────────────────────────────────────────

/**
 * Fetch + parse the current week's featured rotators from the vetted source.
 * Also attempts to scrape the GM weapon in parallel; merged into the result if
 * found. Never blocks on GM failure — returns the week object either way.
 * @param {string} resetISO — the weekly-reset ISO this data will be keyed under.
 * @returns validated week object, or null on network/parse/validation failure.
 */
export async function fetchWeek(resetISO, opts = {}) {
  const [html, gmWeapon] = await Promise.all([
    _fetchHtml(SOURCE_URL, opts),
    fetchGmWeapon(resetISO, opts).catch(() => null)
  ])
  if (!html) return null
  const week = parseWeek(html, resetISO)
  if (!week) { console.error('[rotations-source] page did not validate for week', resetISO); return null }
  if (gmWeapon) week.grandmasterAlert = { weapon: gmWeapon }
  return week
}
