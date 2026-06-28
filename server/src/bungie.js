// =============================================================================
// bungie.js — server-side Bungie API helpers (Node 18+ global fetch).
//
// Unlike the desktop app, this runs with ONE service account's stored
// refresh_token. It only ever reads global data (vendor sales, item defs), so
// the same token works for everyone — the rotation is identical per week.
// =============================================================================

const ROOT = 'https://www.bungie.net/Platform'
const TOKEN_URL = `${ROOT}/App/OAuth/Token/`

export function env() {
  const apiKey = process.env.BUNGIE_API_KEY
  if (!apiKey) throw new Error('BUNGIE_API_KEY is not set.')
  return {
    apiKey,
    clientId: process.env.BUNGIE_CLIENT_ID,
    clientSecret: process.env.BUNGIE_CLIENT_SECRET || '',
    refreshToken: process.env.BUNGIE_REFRESH_TOKEN || ''
  }
}

/** GET helper that attaches the API key (+ optional bearer) and unwraps the envelope. */
async function get(path, accessToken) {
  const { apiKey } = env()
  const res = await fetch(`${ROOT}${path}`, {
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    }
  })
  const json = await res.json()
  if (json.ErrorCode && json.ErrorCode !== 1) {
    throw new Error(`Bungie ${path} → ${json.ErrorCode} ${json.ErrorStatus}: ${json.Message}`)
  }
  return json.Response
}

/** Exchanges the stored refresh_token for a fresh access token. */
export async function refreshAccessToken() {
  const { apiKey, clientId, clientSecret, refreshToken } = env()
  if (!refreshToken) {
    throw new Error('BUNGIE_REFRESH_TOKEN is not set — run `npm run mint-token` once.')
  }
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }
  if (clientSecret) {
    headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  } else {
    params.set('client_id', clientId)
  }
  const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: params.toString() })
  const json = await res.json()
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`Token refresh failed: ${json.error_description || json.error || res.status}`)
  }
  // Bungie also returns a rotated refresh_token; the original stays valid for its
  // 90-day window, so callers can keep using the env value until it's re-minted.
  return json
}

/** Resolves the service account's primary Destiny membership + first character. */
export async function getPrimaryCharacter(accessToken) {
  const memberships = await get('/User/GetMembershipsForCurrentUser/', accessToken)
  const list = memberships.destinyMemberships || []
  const primaryId = memberships.primaryMembershipId
  const primary = list.find((m) => m.membershipId === primaryId) || list[0]
  if (!primary) throw new Error('Service account has no Destiny membership.')

  const profile = await get(
    `/Destiny2/${primary.membershipType}/Profile/${primary.membershipId}/?components=200`,
    accessToken
  )
  const characterId = Object.keys(profile.characters?.data || {})[0]
  if (!characterId) throw new Error('Service account has no characters.')
  return { membershipType: primary.membershipType, membershipId: primary.membershipId, characterId }
}

/** Returns the array of itemHashes a vendor is currently selling (component 402). */
export async function getVendorSaleHashes(accessToken, { membershipType, membershipId, characterId }, vendorHash) {
  const res = await get(
    `/Destiny2/${membershipType}/Profile/${membershipId}/Character/${characterId}` +
      `/Vendors/${vendorHash}/?components=402`,
    accessToken
  )
  const sales = res?.sales?.data || {}
  return Object.values(sales)
    .map((s) => s.itemHash)
    .filter(Boolean)
}

/** Fetches a single inventory-item definition (API-key only, no auth). */
export async function getItemDef(itemHash) {
  return get(`/Destiny2/Manifest/DestinyInventoryItemDefinition/${itemHash}/`)
}
