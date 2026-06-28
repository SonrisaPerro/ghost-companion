// =============================================================================
// mint-refresh-token.mjs — capture the service account's refresh_token.
//
// The desktop app already performs the full Bungie OAuth flow and stores tokens
// in electron-store. So instead of rebuilding OAuth here, the one-time setup is:
//
//   1. Launch the desktop app and SIGN IN with the account you want the server
//      to use as its service account (any account works — rotation is global).
//   2. Run this script. It reads the app's electron-store config and prints the
//      refresh_token to paste into Railway as BUNGIE_REFRESH_TOKEN.
//
// Refresh tokens last ~90 days; re-run this if the server starts 401-ing.
// =============================================================================
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function storePath() {
  // electron-store default: <userData>/config.json. userData on Windows is
  // %APPDATA%/<appName>; the app name is "ghost-companion".
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'))
  return path.join(appData, 'ghost-companion', 'config.json')
}

const file = storePath()
if (!fs.existsSync(file)) {
  console.error(`No config found at:\n  ${file}\nLaunch the app and sign in first.`)
  process.exit(1)
}

let cfg
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch (e) {
  console.error('Could not parse config:', e.message)
  process.exit(1)
}

const tokens = cfg?.['auth.tokens'] || cfg?.auth?.tokens
const refreshToken = tokens?.refreshToken
if (!refreshToken) {
  console.error('No refresh token in config — sign in to the app first.')
  process.exit(1)
}

console.log('\nService account refresh token (set as BUNGIE_REFRESH_TOKEN on Railway):\n')
console.log(refreshToken)
console.log('\nMembership id:', tokens.membershipId || '(unknown)')
console.log('Expires (access token) at:', tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : '(unknown)')
