# obsidian-smart-sync-oauth-relay

OAuth relay infrastructure for [Smart Sync for Obsidian](https://github.com/takezoh/obsidian-smart-sync). Handles server-side Google OAuth token exchange so the Client Secret stays on the server.

## Architecture

```
[Plugin] → [Google OAuth] → [Worker: auth-smartsync.takezo.dev/callback]
                                   ↓ code → token exchange (server-side)
                              [obsidian://smart-sync-auth?access_token=...&refresh_token=...&state=...]
```

### Components

- **`worker/`** — Cloudflare Worker that performs the OAuth token exchange and token refresh
  - `GET /callback` — Receives Google OAuth redirect, exchanges code for tokens, redirects to `obsidian://`
  - `POST /token/refresh` — Exchanges a refresh token for a new access token (JSON API)
- **`docs/`** — GitHub Pages static site (`smartsync.takezo.dev`) with landing page, privacy policy, and terms of service

### Domains

| Domain | Host | Purpose |
|--------|------|---------|
| `smartsync.takezo.dev` | GitHub Pages | Landing page, privacy policy, terms of service |
| `auth-smartsync.takezo.dev` | Cloudflare Workers | OAuth token exchange relay |

## How It Works

1. The plugin opens the Google OAuth consent screen with `redirect_uri` pointing to the Worker (`https://auth-smartsync.takezo.dev/callback`).
2. After the user authorizes, Google redirects to the Worker with `code` and `state` parameters.
3. The Worker exchanges the authorization code for tokens using the Client Secret stored as a Worker secret, and redirects to `obsidian://smart-sync-auth` with the tokens and the original `state` parameter.
4. The OS opens Obsidian, and the plugin receives the tokens directly — no client-side token exchange needed.

If the automatic redirect does not work (e.g. the browser blocks custom URI schemes), the page displays a manual "Open Obsidian" button.

## Security

- **Server-side Client Secret** — the Client Secret is stored as a Cloudflare Worker secret, never exposed to the client
- **State parameter** — passed through to the plugin for CSRF verification
- **No logging** — tokens are never logged or persisted on the server
- **Cache prevention** — all responses include `Cache-Control: no-store, no-cache`
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
- **HTTPS only** — Cloudflare Workers enforce HTTPS

## Development

```bash
cd worker
npm install
npx wrangler dev
```

## Deployment

```bash
cd worker

# Set the Client Secret (one-time)
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Deploy
npm run deploy
```

Then configure DNS: `auth-smartsync.takezo.dev` → Cloudflare Workers (CNAME or custom_domains).

## License

MIT
