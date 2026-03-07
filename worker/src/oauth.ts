import { Env } from './types';
import { redirectPage, errorPage } from './html';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return htmlResponse(errorPage('Missing authentication parameters.'), 400);
  }

  const tokenParams = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    return htmlResponse(errorPage(`Token exchange failed (${tokenRes.status}).`), 502);
  }

  const tokens: TokenResponse = await tokenRes.json();

  const obsidianParams = new URLSearchParams({
    access_token: tokens.access_token,
    expires_in: String(tokens.expires_in),
    state,
  });
  if (tokens.refresh_token) {
    obsidianParams.set('refresh_token', tokens.refresh_token);
  }

  const obsidianUri = `obsidian://smart-sync-auth?${obsidianParams.toString()}`;

  return htmlResponse(redirectPage(obsidianUri));
}

export async function handleTokenRefresh(request: Request, env: Env): Promise<Response> {
  let body: { refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.refresh_token) {
    return Response.json({ error: 'Missing refresh_token' }, { status: 400 });
  }

  const tokenParams = new URLSearchParams({
    refresh_token: body.refresh_token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    return Response.json(
      { error: `Token refresh failed (${tokenRes.status})` },
      { status: 502 },
    );
  }

  const tokens: TokenResponse = await tokenRes.json();

  return Response.json({
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
  });
}
