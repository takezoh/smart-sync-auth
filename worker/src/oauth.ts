import { Env } from './types';
import { redirectPage, errorPage } from './html';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const REDIRECT_BASE = 'obsidian://air-sync-auth';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const SAFE_ERROR_CODE = /^[A-Za-z0-9._~-]{1,64}$/;

export function projectAuthorizationError(error: string): { code: string; message: string } {
  if (error === 'access_denied') {
    return { code: error, message: 'Authorization was denied.' };
  }
  const code = SAFE_ERROR_CODE.test(error) ? error : 'invalid_error';
  return { code, message: `Authorization failed (${code}).` };
}

function parseTokenResponse(value: unknown): TokenResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const token = value as Record<string, unknown>;
  if (
    typeof token.access_token !== 'string' || !token.access_token ||
    typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
    (token.refresh_token !== undefined && typeof token.refresh_token !== 'string')
  ) {
    return null;
  }
  return {
    access_token: token.access_token,
    expires_in: token.expires_in,
    ...(typeof token.refresh_token === 'string' ? { refresh_token: token.refresh_token } : {}),
  };
}

interface StatePayload {
  app: string;
  nonce: string;
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

/** Decode a base64url state into its JSON payload. */
function decodeState(raw: string): { app?: unknown; nonce?: unknown } {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid base64url');
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

export function parseState(raw: string): StatePayload | null {
  try {
    const json = decodeState(raw);
    if (typeof json.app === 'string' && typeof json.nonce === 'string') {
      return json as StatePayload;
    }
  } catch {
    // invalid base64 or JSON
  }
  return null;
}

export async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const pickedFileIds = url.searchParams.get('picked_file_ids');
  const authorizationError = url.searchParams.get('error');

  if (!stateRaw) {
    return htmlResponse(errorPage('Missing authentication parameters.'), 400);
  }

  const state = parseState(stateRaw);
  if (!state) {
    return htmlResponse(errorPage('Invalid state parameter.'), 400);
  }

  if (authorizationError) {
    return htmlResponse(errorPage(projectAuthorizationError(authorizationError).message), 400);
  }
  if (!code) {
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
    // The callback path returns a user-facing HTML error page, so Google's raw
    // error body is intentionally not surfaced — only the status drives the copy.
    const detail = tokenRes.status >= 500
      ? `Google server error (${tokenRes.status})`
      : `Token exchange failed (${tokenRes.status})`;
    return htmlResponse(errorPage(detail), tokenRes.status >= 500 ? 502 : 400);
  }

  let tokenValue: unknown;
  try {
    tokenValue = await tokenRes.json();
  } catch {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }
  const tokens = parseTokenResponse(tokenValue);
  if (!tokens) {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }

  const callbackParams = new URLSearchParams({
    access_token: tokens.access_token,
    expires_in: String(tokens.expires_in),
    state: stateRaw,
  });
  if (tokens.refresh_token) {
    callbackParams.set('refresh_token', tokens.refresh_token);
  }
  if (pickedFileIds) {
    callbackParams.set('picked_file_ids', pickedFileIds);
  }

  const callbackUri = `${REDIRECT_BASE}?${callbackParams.toString()}`;

  return htmlResponse(redirectPage(callbackUri));
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
    const errorBody = await tokenRes.text();
    const status = tokenRes.status >= 500 ? 502 : tokenRes.status;
    return new Response(errorBody, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let tokenValue: unknown;
  try {
    tokenValue = await tokenRes.json();
  } catch {
    return Response.json({ error: 'invalid_token_response' }, { status: 502 });
  }
  const tokens = parseTokenResponse(tokenValue);
  if (!tokens) {
    return Response.json({ error: 'invalid_token_response' }, { status: 502 });
  }

  const result: Record<string, unknown> = {
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
  };
  if (tokens.refresh_token) {
    result.refresh_token = tokens.refresh_token;
  }
  return Response.json(result);
}
