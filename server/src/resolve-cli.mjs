// =============================================================================
// resolve-cli.mjs — run the rotation resolver once and print the result.
// Useful for validating the vendor heuristic against a live token:
//   BUNGIE_API_KEY=... BUNGIE_CLIENT_ID=... BUNGIE_CLIENT_SECRET=... \
//   BUNGIE_REFRESH_TOKEN=... npm run resolve
// =============================================================================
import { resolveRotation } from './rotation.js'

const r = await resolveRotation()
console.log(JSON.stringify(r, null, 2))
if (r.error) {
  console.error('\n[note] vendor lookup degraded to fallback:', r.error)
}
