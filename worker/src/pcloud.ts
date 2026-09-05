import { Env } from './types';
import { redirectPage, errorPage } from './html';
import { REDIRECT_BASE, parseState, htmlResponse, projectAuthorizationError } from './oauth';

/**
 * pCloud regional API hosts. The authorize redirect tells us which one to use
 * (via the `hostname` query param); we whitelist it to avoid being tricked into
 * exchanging the code against an attacker-controlled host.
 */
const PCLOUD_HOSTS = new Set(['api.pcloud.com', 'eapi.pcloud.com']);

interface PCloudTokenResponse {
  result: number;
  error?: string;
  access_token?: string;
  token_type?: string;
  uid?: number;
  locationid?: number;
}

/**
 * Handle the pCloud OAuth code-flow callback.
 *
 * pCloud redirects here with `code`, `state`, `hostname` (and `locationid`).
 * We exchange the code at `https://{hostname}/oauth2_token` using the confidential
 * client secret, then bounce the long-lived `access_token` (and `hostname`, so the
 * plugin can pin the region) back to the Obsidian app via `obsidian://air-sync-auth`.
 *
 * Unlike Google, pCloud returns no refresh token and no `expires_in`.
 */
export async function handlePCloudCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const hostname = url.searchParams.get('hostname') ?? 'api.pcloud.com';
  const authorizationError = url.searchParams.get('error');

  if (!stateRaw) {
    return htmlResponse(errorPage('Missing authentication parameters.'), 400);
  }
  if (!PCLOUD_HOSTS.has(hostname)) {
    return htmlResponse(errorPage('Invalid pCloud host.'), 400);
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
    client_id: env.PCLOUD_CLIENT_ID,
    client_secret: env.PCLOUD_CLIENT_SECRET,
    code,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(`https://${hostname}/oauth2_token?${tokenParams.toString()}`);
  } catch {
    return htmlResponse(errorPage('Could not reach pCloud.'), 502);
  }

  if (!tokenRes.ok) {
    return htmlResponse(errorPage(`Token exchange failed (${tokenRes.status})`), tokenRes.status >= 500 ? 502 : 400);
  }

  // pCloud returns HTTP 200 with result != 0 on logical errors.
  let tokenValue: unknown;
  try {
    tokenValue = await tokenRes.json();
  } catch {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }
  if (!tokenValue || typeof tokenValue !== 'object' || Array.isArray(tokenValue)) {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }
  const tokens = tokenValue as PCloudTokenResponse;
  if (typeof tokens.result !== 'number' || !Number.isFinite(tokens.result)) {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }
  if (tokens.result !== 0) {
    return htmlResponse(errorPage(`Token exchange failed (${tokens.result})`), 400);
  }
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    return htmlResponse(errorPage('Invalid token response.'), 502);
  }

  const callbackParams = new URLSearchParams({
    access_token: tokens.access_token,
    hostname,
    state: stateRaw,
  });
  const callbackUri = `${REDIRECT_BASE}?${callbackParams.toString()}`;

  return htmlResponse(redirectPage(callbackUri));
}
