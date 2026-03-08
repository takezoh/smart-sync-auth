# smart-sync-auth

OAuth relay server for [Smart Sync for Obsidian](https://github.com/takezoh/obsidian-smart-sync). Performs server-side Google OAuth token exchange so the Client Secret stays off the client.

## Overview

Google OAuth requires redirect URIs to use `https://` — custom schemes like `obsidian://` are not allowed for Web application clients. This Cloudflare Worker receives the OAuth callback, exchanges the authorization code for tokens using the server-held Client Secret, and redirects to `obsidian://` with the tokens.

```
[Plugin] → [Google OAuth] → [Worker: /google/callback]
                                 ↓ code → token exchange
                            [obsidian://smart-sync-auth?access_token=...&refresh_token=...]
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/google/callback` | Google OAuth redirect → token exchange → `obsidian://` redirect |
| POST | `/google/token/refresh` | Refresh token → new access token (JSON) |

## `docs/callback/`

Custom OAuth redirect page for users who bring their own Google OAuth credentials. Hosted on GitHub Pages at `smartsync.takezo.dev/callback/`.

When a custom OAuth user completes Google sign-in, Google redirects to this page with `?code=...&state=...`. The page then redirects to `obsidian://smart-sync-auth?code=...&state=...` so the plugin can exchange the code for tokens directly (with PKCE), without going through the auth server.

Unlike the built-in flow (`/google/callback` on the Worker), no server-side token exchange happens — the authorization code is passed through as-is.

## Infrastructure

| Domain | Host | Purpose |
|--------|------|---------|
| `smartsync.takezo.dev` | GitHub Pages | Landing page, privacy policy, terms of service |
| `auth-smartsync.takezo.dev` | Cloudflare Workers | OAuth token exchange relay |

## License

MIT
