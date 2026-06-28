# Ghost Companion data API

A tiny service that does two things the desktop client shouldn't do itself:

1. **`/rotation`** — resolves the **global** weekly ritual rotation (Grandmaster
   Nightfall + Trials of Osiris featured weapon) once, server-side, so every
   client just fetches a small JSON. The rotation is identical for all players
   each week, so one service account's view is everyone's.
2. **`/paths`** — serves community acquisition-path data (the shared
   `dropRates.json`), so paths can be updated without shipping a new app build.

## Why server-side?

The featured weapon lives in **vendor sales**, which require OAuth + a character.
Rather than make every client authenticate and hammer Bungie, one service account
resolves it. Bonus: the `client_secret` and refresh token live only here (Railway
env vars), never inside the distributed desktop binary.

If the vendor lookup fails, `/rotation` still returns correct **activity pools**
with a `null` weapon — the client degrades to "check the in-game vendor" instead
of breaking.

## Endpoints

| Route        | Notes                                                         |
|--------------|---------------------------------------------------------------|
| `GET /health`   | Liveness + last rotation cache time.                       |
| `GET /rotation` | Cached hourly. `?force=1` re-resolves now.                 |
| `GET /paths`    | Community paths. `?reload=1` re-reads the file.            |

`/rotation` shape:

```jsonc
{
  "weekOf": "2026-06-23T17:00:00.000Z",
  "source": "vendor",            // vendor | override | fallback
  "nightfall": {
    "label": "Grandmaster Nightfall",
    "activityHashes": [ ... ],   // any of these completing = a run
    "weapon": { "itemHash": 0, "name": "...", "icon": "..." } | null,
    "candidates": [ ... ]        // all legendary/exotic weapons the vendor sells
  },
  "trials": { ... }
}
```

## Environment

See [`.env.example`](.env.example). Required: `BUNGIE_API_KEY`,
`BUNGIE_CLIENT_ID`, `BUNGIE_CLIENT_SECRET`, `BUNGIE_REFRESH_TOKEN`. `PORT` is
provided by Railway.

## One-time setup: the service refresh token

1. Launch the desktop app and **sign in with the account** the server should use
   (any account — rotation is global).
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

## Validate the rotation resolver

The "best guess" weapon = the first legendary/exotic weapon the vendor is
selling. Confirm it against the live game with:

```bash
npm run resolve   # prints the full resolved rotation + candidates
```

If a week's guess is wrong, set `ROTATION_OVERRIDE_JSON` (e.g.
`{"nightfall":4289226715}`) — overrides win over the vendor heuristic.

## Updating community paths

Edit `data/paths.json` (same schema as the app's
[`../PATHS.md`](../PATHS.md)) and redeploy, or PR it. The client merges remote
paths under the user's own local entries.
