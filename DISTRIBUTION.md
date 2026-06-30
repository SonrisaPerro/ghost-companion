# Distributing Ghost Companion

How to ship Ghost Companion to a friend as a real installable app, and how your
updates reach them automatically.

## How updates reach your friend

| What you changed | How it reaches them | When |
| --- | --- | --- |
| **Curated data** — community paths, Xûr stock, Eververse, new items (e.g. Sunshot) | Already live via the Railway data API (`ghost-companion-production.up.railway.app`). The app fetches it on launch. | Instant — **no app update needed**, just `git push` to deploy Railway. |
| **App code/features** — new panels, fixes, manifest logic | A new GitHub Release, pulled by electron-updater. | Automatic on their next launch (downloads in the background, applies on restart). |

So most of what you tweak (loot data) is instant. Only actual code changes need a release.

## One-time maintainer setup

### 1. Bungie application → PUBLIC OAuth client

The shipped app embeds the API key + OAuth **client ID** (this is normal — DIM and
other open-source Destiny apps ship theirs the same way). It must be a **Public**
client so there is **no client secret** in the binary.

At <https://www.bungie.net/en/Application>:

1. Open (or create) the Ghost Companion application.
2. Set **OAuth Client Type** to **Public**.
3. Set **Redirect URL** to exactly: `https://127.0.0.1:7777/callback`
4. **Regenerate the API key** (this also retires the previously leaked key/secret — do this now).
5. Note the **API Key** and the **OAuth client_id**.

> Because the client is Public, there is no secret to leak from the app. The old
> confidential client secret should still be considered burned — regenerating the
> key above and switching to Public retires it.

### 2. GitHub repository secrets

In `SonrisaPerro/ghost-companion` → **Settings → Secrets and variables → Actions → New repository secret**, add:

- `BUNGIE_API_KEY` — the API key from step 1.
- `BUNGIE_CLIENT_ID` — the OAuth client_id from step 1.

These are injected at build time (`.github/workflows/release.yml`) and baked into
the bundle. They never appear in repo source. `GITHUB_TOKEN` is provided
automatically — no need to add it.

### 3. (Optional) App icon

Drop a `build/icon.ico` (256×256) to brand the installer/exe. Without it,
electron-builder uses the default Electron icon (a warning, not an error).

## Shipping a release

```bash
# bump the version in package.json (e.g. 1.0.0 -> 1.0.1), then:
git commit -am "release: v1.0.1"
git tag v1.0.1
git push origin main --tags
```

Pushing the `v*` tag triggers the **Release** workflow: it builds the Windows
installer with the baked credentials and publishes it to **GitHub Releases**.
Every installed app checks that feed on launch and updates itself.

> The version in `package.json` **must** match the tag and must increase, or
> electron-updater won't offer the update.

You can also build locally without CI:

```bash
# requires BUNGIE_API_KEY + BUNGIE_CLIENT_ID in your environment, and a
# GH_TOKEN with repo scope to publish:
npm run release          # build + publish to GitHub Releases
npm run dist             # build the installer locally WITHOUT publishing
```

## What your friend does (Windows)

1. Go to the repo's **Releases** page: <https://github.com/SonrisaPerro/ghost-companion/releases>
2. Download `Ghost Companion Setup <version>.exe` from the latest release.
3. Run it. The app is **unsigned**, so SmartScreen shows *"Windows protected your
   PC"* the first time → click **More info → Run anyway**. (Code signing needs a
   paid certificate; safe to skip for a friend.)
4. Launch Ghost Companion, click **ACCT → Log in with Bungie**, and they're set.
   The Manifest (~343 MB) downloads on first run.

After that, every code update you publish installs itself automatically — they
never re-download manually.
