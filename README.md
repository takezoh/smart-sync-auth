# obsidian-smart-sync-oauth-relay

OAuth relay server for [Smart Sync for Obsidian](https://github.com/takezoh/obsidian-smart-sync). Performs server-side Google OAuth token exchange so the Client Secret stays off the client.

## Overview

Google OAuth requires redirect URIs to use `https://` — custom schemes like `obsidian://` are not allowed for Web application clients. This Cloudflare Worker receives the OAuth callback, exchanges the authorization code for tokens using the server-held Client Secret, and redirects to `obsidian://` with the tokens.

```
[Plugin] → [Google OAuth] → [Worker: /callback]
                                 ↓ code → token exchange
                            [obsidian://smart-sync-auth?access_token=...&refresh_token=...]
```

For technical details on the authentication flow, see the [plugin architecture documentation](https://github.com/takezoh/obsidian-smart-sync/blob/main/docs/architecture.md).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/callback` | Google OAuth redirect → token exchange → `obsidian://` redirect |
| POST | `/token/refresh` | Refresh token → new access token (JSON) |

## Infrastructure

| Domain | Host | Purpose |
|--------|------|---------|
| `smartsync.takezo.dev` | GitHub Pages | Landing page, privacy policy, terms of service |
| `auth-smartsync.takezo.dev` | Cloudflare Workers | OAuth token exchange relay |

## License

MIT
