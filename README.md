# air-sync-auth

OAuth relay server for [Air Sync for Obsidian](https://github.com/takezoh/obsidian-air-sync). Performs server-side Google and pCloud OAuth token exchange so the Client Secret stays off the client.

## Overview

Google OAuth requires redirect URIs to use `https://` — custom schemes like `obsidian://` are not allowed for Web application clients. This Cloudflare Worker receives the OAuth callback, exchanges the authorization code for tokens using the server-held Client Secret, and redirects to `obsidian://` with the tokens.

```
[Plugin] → [Google OAuth] → [Worker: /google/callback]
                                 ↓ code → token exchange
                            [obsidian://air-sync-auth?access_token=...&refresh_token=...]
```

Current plugin versions use Google's top-level OAuth Picker and receive
`picked_file_ids` through this same Worker callback. The hosted
`docs/googledrive-folder/` PickerBuilder page remains deployed unchanged for older
plugin versions, so rolling out the new flow does not break them. Current custom OAuth
uses an explicit folder ID and does not invoke either Picker flow.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/google/callback` | Google OAuth/Picker redirect → token exchange → `obsidian://` redirect; preserves `picked_file_ids` |
| POST | `/google/token/refresh` | Refresh token → new access token (JSON) |
| GET | `/pcloud/callback` | pCloud OAuth redirect → token exchange → `obsidian://` redirect |

### pCloud callback

pCloud redirects here with `code`, `state`, `hostname` (and `locationid`). The Worker
exchanges the code at `https://{hostname}/oauth2_token` (the `hostname` is region-pinned
— `api.pcloud.com` US / `eapi.pcloud.com` EU — and whitelisted to avoid SSRF) using the
server-held `PCLOUD_CLIENT_SECRET`, then redirects to
`obsidian://air-sync-auth?access_token=...&hostname=...&state=...`.

Unlike Google, pCloud issues a **long-lived access token with no refresh token and no
expiry**, so there is no `/pcloud/token/refresh` endpoint. The plugin stores only the
access token and re-pins the API host from `hostname`. The pCloud OAuth scope grants
access to the **whole account** (its `diff` feed is account-wide), which the plugin
filters to the vault subtree client-side — disclose this in the privacy policy.

Required worker config: `PCLOUD_CLIENT_ID` / `PCLOUD_REDIRECT_URI` as `[vars]` in
`wrangler.toml`, and `PCLOUD_CLIENT_SECRET` via `wrangler secret put`.

## `docs/callback/`

Custom OAuth redirect page for users who bring their own Google OAuth credentials. Hosted on GitHub Pages at `airsync.takezo.dev/callback/`.

When a custom OAuth user completes Google sign-in, Google redirects to this page with `?code=...&state=...`. The page then redirects to `obsidian://air-sync-auth?code=...&state=...` so the plugin can exchange the code for tokens directly (with PKCE), without going through the auth server.

Unlike the built-in flow (`/google/callback` on the Worker), no server-side token exchange happens — the authorization code is passed through as-is.

Dropbox and OneDrive also use in-plugin Authorization Code + PKCE, but their registered
redirect URI is the `obsidian://air-sync-auth` deep link itself; current versions do
not route those callbacks through this page or through the Worker. In short: the Worker
is the **confidential** path for built-in Google, while `docs/callback/` is the hosted
no-secret bridge for custom Google OAuth.

## `docs/dropbox-folder/`

Hosts the **Dropbox Chooser** so the user can pick which remote folder a vault syncs into. The plugin can't load the remote `dropins.js` inside Obsidian (remote code is disallowed, and the Chooser validates the page origin), so it opens this page in the browser — the same indirection as auth. The page loads the Chooser, the user picks a folder, and it bounces the result to `obsidian://air-sync-folder?id=…&name=…&state=…` (a backend-agnostic scheme, kept separate from `air-sync-auth`), which the plugin routes to the active backend to bind.

Two App-Folder caveats the plugin handles, because the Chooser **always browses the whole Dropbox and can't be limited to the app folder**:

- Air Sync uses App Folder scope, so its token can only address ids under `/Apps/Air Sync/`. The plugin verifies the picked id with `get_metadata` and rejects anything outside the app folder with a clear message rather than silently failing to sync.
- This page's domain must be added to the **Chooser domain allowlist** in the Dropbox App Console (and the Chooser/Drop-ins capability enabled), or the Chooser renders "App is misconfigured". The app key is **not** baked into `index.html`: the plugin passes it as `?appKey=…` and the page hands it to `Dropbox.init()`, so the plugin is the single source of truth and this page needs no pre-deploy substitution. (The key is a public, non-secret value; the Chooser is gated by the domain allowlist, not key secrecy.)

## Infrastructure

| Domain | Host | Purpose |
|--------|------|---------|
| `airsync.takezo.dev` | GitHub Pages | Landing page, privacy policy, terms of service, custom-OAuth callback, Dropbox Chooser |
| `auth-airsync.takezo.dev` | Cloudflare Workers | OAuth token exchange relay |

## Local development

The worker has its own toolchain (Wrangler). Work on it from `worker/`:

```bash
cd worker
npm install
npm run dev      # wrangler dev
npm test         # production-handler and static-callback tests
npm run typecheck
```

## License

MIT
