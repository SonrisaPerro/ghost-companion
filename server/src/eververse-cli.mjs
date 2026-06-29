// =============================================================================
// eververse-cli.mjs — run the Eververse ornament-shop check once and print it.
// Needs a live token in env (same vars as `npm run resolve`):
//   BUNGIE_API_KEY=... BUNGIE_CLIENT_ID=... BUNGIE_CLIENT_SECRET=... \
//   BUNGIE_REFRESH_TOKEN=... npm run eververse
// Without creds it degrades to source:'fallback' (shop state unknown).
// =============================================================================
import { resolveEververse } from './eververse.js'

const r = await resolveEververse()
console.log(JSON.stringify(r, null, 2))
if (r.error) {
  console.error('\n[note] Eververse lookup degraded to fallback (shop unknown):', r.error)
}
