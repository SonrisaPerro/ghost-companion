// =============================================================================
// monument-cli.mjs — run the Monument resolver once and print the catalog.
// Needs a live token in env (same vars as `npm run resolve`):
//   BUNGIE_API_KEY=... BUNGIE_CLIENT_ID=... BUNGIE_CLIENT_SECRET=... \
//   BUNGIE_REFRESH_TOKEN=... npm run monument
// Without creds it degrades to source:'fallback' (catalog unknown).
// =============================================================================
import { resolveMonument } from './monument.js'

const r = await resolveMonument()
console.log(JSON.stringify(r, null, 2))
if (r.error) {
  console.error('\n[note] Monument lookup degraded to fallback (catalog unknown):', r.error)
}
