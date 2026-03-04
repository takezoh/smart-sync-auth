# obsidian-smart-sync-oauth-relay

A static OAuth redirect page for [Smart Sync for Obsidian](https://github.com/takezoh/obsidian-smart-sync). Hosted on GitHub Pages, it relays Google OAuth callbacks to the `obsidian://` URI scheme so the plugin can receive authorization codes automatically.

## How It Works

1. The plugin opens the Google OAuth consent screen with `redirect_uri` pointing to this GitHub Pages site.
2. After the user authorizes, Google redirects to `https://takezoh.github.io/obsidian-smart-sync-oauth-relay/callback?code=xxx&state=yyy`.
3. The static page immediately redirects to `obsidian://smart-sync-auth?code=xxx&state=yyy`.
4. The OS opens Obsidian, the plugin receives the callback, and completes the token exchange.

If the automatic redirect does not work (e.g. the browser blocks custom URI schemes), the page displays a manual "Open Obsidian" button as a fallback.

## Security

- **No external resources** — the page loads no external scripts, stylesheets, or trackers.
- **Content Security Policy** — a `<meta>` CSP tag restricts all resource loading to inline scripts and styles only.
- **No parameter modification** — `code` and `state` are passed through with `encodeURIComponent`, unchanged.
- **PKCE (S256)** — the plugin uses PKCE, so an intercepted authorization code alone cannot be exchanged for a token.
- **State parameter** — protects against CSRF attacks.
- **Short-lived codes** — authorization codes are single-use and expire within minutes.

## License

MIT
