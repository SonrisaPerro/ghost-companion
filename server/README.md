# Ghost Companion data API

A tiny service that does two things the desktop client shouldn't do itself:

1. **`/xur`** — resolves **Xûr's live weekly exotic stock + presence** once,
   server-side, so every client just fetches a small JSON. Xûr's offering is
   identical for all players each week, so one service account's view is
   everyone's.
2. **`/paths`** — serves community acquisition-path data (the shared
   `dropRates.json`), so paths can be updated without shipping a new app build.

> **History:** this service used to also resolve a Nightfall/Trials weekly
> *featured weapon* (`/rotation`). Edge of Fate removed that mechanic — there's no
> targetable weekly weapon and the API exposes none — so the ritual rotation was
> dropped. Xûr is the one ritual-adjacent vendor whose stock is still targetable,
> so that's all that remains.

## Why server-side?

Xûr's stock + presence live in **vendor data**, which requires OAuth + a
character. Rather than make every client authenticate and hammer Bungie, one
service account resolves it. Bonus: the `client_secret` and refresh token live
only here (Railway env vars), never inside the distributed desktop binary.

## Presence is authoritative

Presence is **not** inferred from "did any item come back". `/xur` reads the
Vendors component's `enabled` flag and treats Bungie's `1627`
(`DestinyVendorNotFound`) as a definitive **away**. The payload is only marked
`source: "live"` when we got an authoritative read; a token/network failure
degrades to `source: "fallback"` with presence **unknown** (never a false
"present"). The client shows Xûr **only** when `source === "live"` and
`xur.present === true`.

## Endpoints

| Route        | Notes                                                         |
|--------------|---------------------------------------------------------------|
| `GET /health`   | Liveness + last Xûr cache time (`xurCachedAt`).            |
| `GET /xur`      | Cached hourly. `?force=1` re-resolves now.                 |
| `GET /paths`    | Community paths. `?reload=1` re-reads the file.            |

`/xur` shape:

```jsonc
{
  "weekOf": "2026-06-23T17:00:00.000Z",
  "generatedAt": "2026-06-29T15:00:00.000Z",
  "source": "live",                // live (authoritative) | fallback (unknown)
  "xur": {
    "label": "Xûr",
    "location": "The Tower (near Ikora)",
    "present": true,               // only trust this when source === "live"
    "weapons": [ { "itemHash": 0, "name": "...", "icon": "...", "type": "..." } ],
    "armor":   [ { "itemHash": 0, "name": "...", "icon": "...", "type": "..." } ]
  },
  "error": "..."                   // present only on fallback
}
```

## Environment

See [`.env.example`](.env.example). Required: `BUNGIE_API_KEY`,
`BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET`, `BUNGIE_REFRESH_TOKEN`. `PORT` is
provided by Railway.

## One-time setup: the service refresh token

1. Launch the desktop app and **sign in with the account** the server should use
   (any account — Xûr's stock is global).
2. From `server/`, run:

   ```bash
   npm run mint-token
   ```

   It reads the app's local token store and prints the `refresh_token`. Paste it
   into Railway as `BUNGIE_REFRESH_TOKEN`. (Refresh tokens last ~90 days; re-run
   if the service starts returning 401s.)

## Deploy on Railway

1. New service → deploy from this repo, **root directory = `server`**.
2. Set the env vars above.
3. Railway runs `npm start` (binds `PORT`). Hit `/health` to confirm.

## Validate the Xûr resolver

Confirm presence + stock against the live game with:

```bash
npm run resolve   # prints the full resolved Xûr payload (present, weapons, armor)
```

On a week Xûr is away you should see `"present": false` with `source: "live"`;
a credential/network failure shows `source: "fallback"` and an `error`.

## Updating community paths

Edit `data/paths.json` (same schema as the app's
[`../PATHS.md`](../PATHS.md)) and redeploy, or PR it. The client merges remote
paths under the user's own local entries.
