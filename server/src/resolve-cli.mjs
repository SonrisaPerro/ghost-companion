// =============================================================================
// resolve-cli.mjs — run the Xûr resolver once and print the result.
// Useful for validating presence + stock against a live token:
//   BUNGIE_API_KEY=... BUNGIE_CLIENT_ID=... BUNGIE_CLIENT_SECRET=... \
//   BUNGIE_REFRESH_TOKEN=... npm run resolve
// =============================================================================
import { resolveXur } from './xur.js'

const r = await resolveXur()
console.log(JSON.stringify(r, null, 2))
if (r.error) {
  console.error('\n[note] Xûr lookup degraded to fallback (presence unknown):', r.error)
}
