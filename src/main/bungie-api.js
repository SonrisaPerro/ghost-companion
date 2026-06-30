// =============================================================================
// bungie-api.js
// All Bungie.net API communication: OAuth login, token storage/refresh,
// membership + character lookup, and activity history.
//
// Docs: https://bungie-net.github.io/multi/index.html
// =============================================================================

import { BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import https from 'node:https'
import selfsigned from 'selfsigned'
import fetch from 'node-fetch'

const BUNGIE_ROOT = 'https://www.bungie.net'
const PLATFORM = `${BUNGIE_ROOT}/Platform`
const AUTH_URL = `${BUNGIE_ROOT}/en/OAuth/Authorize`
const TOKEN_URL = `${PLATFORM}/App/OAuth/Token/`

// Destiny 2 membership types (BungieMembershipType enum).
// -1 = "All". Used when we ask Bungie for the user's primary cross-save profile.
const MEMBERSHIP_TYPE_ALL = -1

// electron-store keys used by this module.
const STORE_KEYS = {
  tokens: 'auth.tokens', // { accessToken, refreshToken, expiresAt, membershipId }
  profile: 'auth.profile' // { membershipType, membershipId, displayName, characterIds }
}

/**
 * Reads required Bungie credentials from the environment (.env).
 * Throws a clear error if the API key is missing.
 */
function getConfig() {
  const apiKey = process.env.BUNGIE_API_KEY
  const clientId = process.env.BUNGIE_CLIENT_ID
  const clientSecret = process.env.BUNGIE_CLIENT_SECRET || ''
  // Must EXACTLY match the redirect URL registered on the Bungie application.
  const redirectUrl =
    process.env.BUNGIE_REDIRECT_URL || 'https://127.0.0.1:7777/callback'

  if (!apiKey || apiKey === 'your_bungie_api_key_here') {
    throw new Error(
      'BUNGIE_API_KEY is not set. Copy .env.example to .env and add your Bungie API key.'
    )
  }
  return { apiKey, clientId, clientSecret, redirectUrl }
}

/**
 * Low-level fetch wrapper that always attaches the X-API-Key header and parses
 * the standard Bungie envelope ({ Response, ErrorCode, Message, ... }).
 */
async function bungieFetch(path, { accessToken, method = 'GET', body, headers = {} } = {}) {
  const { apiKey } = getConfig()
  const url = path.startsWith('http') ? path : `${PLATFORM}${path}`

  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': apiKey,
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers
    },
    body
  })

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Bungie API returned non-JSON (${res.status}): ${text.slice(0, 200)}`)
  }

  // Bungie wraps everything; ErrorCode 1 means success.
  if (json.ErrorCode && json.ErrorCode !== 1) {
    throw new Error(`Bungie API error ${json.ErrorCode}: ${json.Message || 'Unknown error'}`)
  }
  return json.Response
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

/**
 * Opens a dedicated BrowserWindow pointed at Bungie's authorize page, waits for
 * the redirect back to our redirect URL, extracts the `code`, and exchanges it
 * for tokens. Tokens are persisted to electron-store.
 *
 * @param {import('electron-store')} store
 * @returns {Promise<object>} the stored profile { displayName, membershipId, ... }
 */
export async function login(store) {
  const { clientId, redirectUrl } = getConfig()
  if (!clientId || clientId === 'your_oauth_client_id_here') {
    throw new Error('BUNGIE_CLIENT_ID is not set. Add it to your .env file.')
  }

  // `state` is a CSRF token we generate and later verify on the redirect.
  const state = crypto.randomBytes(16).toString('hex')
  const authUrl =
    `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&state=${state}` +
    `&redirect_uri=${encodeURIComponent(redirectUrl)}`

  const code = await captureOAuthCode(authUrl, redirectUrl, state)
  const tokens = await exchangeCodeForTokens(code)
  store.set(STORE_KEYS.tokens, tokens)

  // Immediately resolve the user's Destiny profile so the UI has a display name.
  const profile = await loadProfile(store)
  return profile
}

/**
 * Generates a fresh self-signed certificate for the loopback callback server.
 * Bungie requires an HTTPS redirect URL, so even on localhost we must serve TLS.
 * The cert is valid for both 127.0.0.1 and localhost via subjectAltName.
 */
function generateSelfSignedCert() {
  const attrs = [{ name: 'commonName', value: '127.0.0.1' }]
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: '127.0.0.1' }, // type 7 = IP address
          { type: 2, value: 'localhost' } // type 2 = DNS name
        ]
      }
    ]
  })
  return { key: pems.private, cert: pems.cert }
}

/**
 * Drives the OAuth flow:
 *   1. Spins up a self-signed HTTPS server on the loopback redirect URL.
 *   2. Opens a BrowserWindow to Bungie's authorize page (its session is told to
 *      trust our self-signed cert for 127.0.0.1, so the redirect lands cleanly).
 *   3. The server receives Bungie's redirect, extracts ?code & ?state, shows a
 *      "you can close this" page, and resolves with the authorization code.
 *
 * Resolves with the authorization code; cleans up the server + window either way.
 */
function captureOAuthCode(authUrl, redirectUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const target = new URL(redirectUrl) // e.g. https://127.0.0.1:7777/callback
    const port = Number(target.port || 443)
    const callbackPath = target.pathname || '/callback'

    const { key, cert } = generateSelfSignedCert()
    let authWindow = null
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      try {
        server.close()
      } catch {
        /* ignore */
      }
      if (authWindow && !authWindow.isDestroyed()) authWindow.destroy()
      fn(value)
    }

    // The HTTPS server that receives Bungie's redirect.
    const server = https.createServer({ key, cert }, (req, res) => {
      let reqUrl
      try {
        reqUrl = new URL(req.url, redirectUrl)
      } catch {
        res.writeHead(400).end('Bad request')
        return
      }
      if (reqUrl.pathname !== callbackPath) {
        res.writeHead(404).end('Not found')
        return
      }

      const error = reqUrl.searchParams.get('error')
      const returnedState = reqUrl.searchParams.get('state')
      const code = reqUrl.searchParams.get('code')

      // Always render a friendly page so the user knows to return to the app.
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>Ghost Companion</title></head>
         <body style="font-family:system-ui;background:#12141c;color:#e8eaf0;display:flex;
         height:100vh;align-items:center;justify-content:center;margin:0">
         <div style="text-align:center">
           <h2 style="color:#7c4dff">${
             error ? 'Sign-in failed' : 'You are signed in 👻'
           }</h2>
           <p>${error ? error : 'You can close this window and return to Ghost Companion.'}</p>
         </div></body></html>`
      )

      if (error) return finish(reject, new Error(`OAuth denied: ${error}`))
      if (returnedState !== expectedState) {
        return finish(reject, new Error('OAuth state mismatch (possible CSRF).'))
      }
      if (code) return finish(resolve, code)
    })

    server.on('error', (err) => finish(reject, new Error(`Callback server error: ${err.message}`)))

    server.listen(port, '127.0.0.1', () => {
      authWindow = new BrowserWindow({
        width: 480,
        height: 720,
        title: 'Sign in to Bungie.net',
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:bungie-oauth' // isolated cookie jar
        }
      })

      // Trust our self-signed cert ONLY for the loopback callback host; defer to
      // Chromium's normal verification for everything else (e.g. bungie.net).
      authWindow.webContents.session.setCertificateVerifyProc((request, cb) => {
        if (request.hostname === '127.0.0.1' || request.hostname === 'localhost') {
          cb(0) // 0 = trust this certificate
        } else {
          cb(-3) // -3 = use Chromium's default verification result
        }
      })

      authWindow.on('closed', () => finish(reject, new Error('Login window was closed.')))
      authWindow.loadURL(authUrl)
    })
  })
}

/**
 * Trades an authorization code for an access/refresh token pair.
 */
async function exchangeCodeForTokens(code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code
  })
  return postToken(params)
}

/**
 * Uses a stored refresh token to obtain a fresh access token.
 */
async function refreshTokens(store) {
  const stored = store.get(STORE_KEYS.tokens)
  if (!stored?.refreshToken) throw new Error('No refresh token available; please log in again.')

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken
  })
  const tokens = await postToken(params)
  store.set(STORE_KEYS.tokens, tokens)
  return tokens
}

/**
 * Shared token-endpoint POST. Normalizes the response into our token shape.
 *
 * Bungie requires CONFIDENTIAL clients (those with a client_secret) to
 * authenticate with HTTP Basic auth (base64 of "client_id:client_secret").
 * PUBLIC clients instead pass client_id in the body.
 */
async function postToken(params) {
  const { apiKey, clientId, clientSecret } = getConfig()

  const headers = {
    'X-API-Key': apiKey,
    'Content-Type': 'application/x-www-form-urlencoded'
  }
  if (clientSecret) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  } else {
    params.set('client_id', clientId)
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers,
    body: params.toString()
  })

  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(`Token exchange failed: ${json.error_description || json.error || res.status}`)
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // expires_in is in seconds; convert to an absolute epoch ms timestamp.
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    membershipId: json.membership_id // Bungie.net membership id (not Destiny)
  }
}

/**
 * Returns a valid access token, transparently refreshing if it has expired
 * (or is within a 60s safety margin of expiring).
 */
export async function getValidAccessToken(store) {
  const tokens = store.get(STORE_KEYS.tokens)
  if (!tokens?.accessToken) throw new Error('Not logged in.')

  const margin = 60 * 1000
  if (Date.now() >= tokens.expiresAt - margin) {
    const refreshed = await refreshTokens(store)
    return refreshed.accessToken
  }
  return tokens.accessToken
}

// ---------------------------------------------------------------------------
// Profile / characters
// ---------------------------------------------------------------------------

/**
 * Resolves the user's primary Destiny 2 membership and character ids, and
 * caches them in the store. Called right after login and on app start.
 */
export async function loadProfile(store) {
  const accessToken = await getValidAccessToken(store)

  // 1) Get the linked Destiny memberships for the current Bungie.net user.
  const linked = await bungieFetch(
    `/Destiny2/254/Profile/${store.get(STORE_KEYS.tokens).membershipId}/LinkedProfiles/`,
    { accessToken }
  )

  const primary =
    linked.profiles?.find((p) => p.isCrossSavePrimary) || linked.profiles?.[0]
  if (!primary) throw new Error('No Destiny 2 profile found on this account.')

  // 2) Pull characters (components=200 => DestinyCharacterComponent).
  const profile = await bungieFetch(
    `/Destiny2/${primary.membershipType}/Profile/${primary.membershipId}/?components=200`,
    { accessToken }
  )
  const characterIds = Object.keys(profile.characters?.data || {})

  const result = {
    membershipType: primary.membershipType,
    membershipId: primary.membershipId,
    displayName: `${primary.displayName}${
      primary.bungieGlobalDisplayNameCode
        ? `#${String(primary.bungieGlobalDisplayNameCode).padStart(4, '0')}`
        : ''
    }`,
    characterIds
  }
  store.set(STORE_KEYS.profile, result)
  return result
}

/**
 * Returns the cached profile (or null if not logged in).
 */
export function getCachedProfile(store) {
  return store.get(STORE_KEYS.profile) || null
}

/**
 * Auth status helper for the "get-auth-status" IPC channel.
 */
export function getAuthStatus(store) {
  const tokens = store.get(STORE_KEYS.tokens)
  const profile = store.get(STORE_KEYS.profile)
  return {
    loggedIn: Boolean(tokens?.accessToken),
    displayName: profile?.displayName || null
  }
}

/**
 * Clears all stored auth state. Backs the "bungie-logout" IPC channel.
 */
export function logout(store) {
  store.delete(STORE_KEYS.tokens)
  store.delete(STORE_KEYS.profile)
}

// ---------------------------------------------------------------------------
// Activity history
// ---------------------------------------------------------------------------

/**
 * Fetches recent activity history for one character.
 *
 * @param {object} opts
 * @param {string} opts.membershipType
 * @param {string} opts.membershipId
 * @param {string} opts.characterId
 * @param {number} [opts.count]  page size (max 250)
 * @param {number} [opts.mode]   activity mode filter (0 = none/all)
 */
export async function getActivityHistory(store, { characterId, count = 25, mode = 0 }) {
  const accessToken = await getValidAccessToken(store)
  const profile = getCachedProfile(store)
  if (!profile) throw new Error('Profile not loaded.')

  const data = await bungieFetch(
    `/Destiny2/${profile.membershipType}/Account/${profile.membershipId}` +
      `/Character/${characterId}/Stats/Activities/?count=${count}&mode=${mode}&page=0`,
    { accessToken }
  )
  return data?.activities || []
}

// ---------------------------------------------------------------------------
// Collectibles (ownership)
// ---------------------------------------------------------------------------

// DestinyCollectibleState is a bitmask; bit 1 (NotAcquired) is the only one we
// care about. An item is OWNED when that bit is clear.
const COLLECTIBLE_NOT_ACQUIRED = 1

// Where we cache the last good ownership read, so a scan can still show
// COLLECTED/MISSING while offline or between refreshes.
const COLLECTION_KEY = 'collection.owned' // { hashes: number[], fetchedAt: number }

/**
 * Fetches the set of collectible hashes the signed-in player has unlocked.
 * Merges profile-wide collectibles with each character's, since some records
 * live only at the character scope. Caches the result to the store.
 *
 * @returns {Promise<{ hashes: number[], fetchedAt: number }>}
 */
export async function getOwnedCollectibles(store) {
  const accessToken = await getValidAccessToken(store)
  const profile = getCachedProfile(store)
  if (!profile) throw new Error('Profile not loaded.')

  // components=800 => DestinyCollectibleComponent (profile + per character).
  const data = await bungieFetch(
    `/Destiny2/${profile.membershipType}/Profile/${profile.membershipId}/?components=800`,
    { accessToken }
  )

  const owned = new Set()
  const scan = (collectibles) => {
    for (const [hash, info] of Object.entries(collectibles || {})) {
      if ((Number(info?.state) & COLLECTIBLE_NOT_ACQUIRED) === 0) {
        owned.add(Number(hash) >>> 0) // store as unsigned, matching item.collectibleHash
      }
    }
  }
  scan(data?.profileCollectibles?.data?.collectibles)
  for (const c of Object.values(data?.characterCollectibles?.data || {})) {
    scan(c?.collectibles)
  }

  const result = { hashes: [...owned], fetchedAt: Date.now() }
  store.set(COLLECTION_KEY, result)
  return result
}

/**
 * Returns the cached ownership read (or an empty one). Used as a fallback when a
 * live fetch fails so the UI degrades gracefully.
 */
export function getCachedCollectibles(store) {
  return store.get(COLLECTION_KEY) || { hashes: [], fetchedAt: 0 }
}

export { MEMBERSHIP_TYPE_ALL, STORE_KEYS, COLLECTION_KEY }
