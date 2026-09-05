import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  handleCallback,
  handleTokenRefresh,
  projectAuthorizationError,
} from '../.test-dist/oauth.mjs';
import { handlePCloudCallback } from '../.test-dist/pcloud.mjs';

const env = {
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  GOOGLE_REDIRECT_URI: 'https://relay/google/callback',
  PCLOUD_CLIENT_ID: 'pcloud-client',
  PCLOUD_CLIENT_SECRET: 'pcloud-secret',
};
const state = Buffer.from(JSON.stringify({ nonce: 'nonce' }))
  .toString('base64url');
const legacyState = Buffer.from(JSON.stringify({ app: 'obsidian-plugin', nonce: 'nonce' }))
  .toString('base64url');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Google callback rejects malformed HTTP-success token bodies', async (t) => {
  const invalid = [null, [], {}, { access_token: '', expires_in: 3600 },
    { access_token: 'AT', expires_in: 0 }, { access_token: 'AT', expires_in: '3600' },
    { access_token: 'AT', expires_in: 3600, refresh_token: 7 }];
  for (const value of invalid) {
    await t.test(JSON.stringify(value), async () => {
      globalThis.fetch = async () => jsonResponse(value);
      const response = await handleCallback(
        new Request(`https://relay/google/callback?code=C&state=${state}`), env);
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.match(text, /Invalid token response/);
      assert.doesNotMatch(text, /undefined|secret-sentinel/);
    });
  }
});

test('Google refresh rejects invalid JSON and preserves valid optional refresh', async () => {
  globalThis.fetch = async () => new Response('{bad', { status: 200 });
  let response = await handleTokenRefresh(new Request('https://relay/google/token/refresh', {
    method: 'POST', body: JSON.stringify({ refresh_token: 'RT' }),
  }), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'invalid_token_response' });

  globalThis.fetch = async () => jsonResponse({ access_token: 'AT', expires_in: 3600 });
  response = await handleTokenRefresh(new Request('https://relay/google/token/refresh', {
    method: 'POST', body: JSON.stringify({ refresh_token: 'RT' }),
  }), env);
  assert.deepEqual(await response.json(), { access_token: 'AT', expires_in: 3600 });
});

test('Google callback preserves valid refresh, picker ids, and raw state', async () => {
  globalThis.fetch = async () => jsonResponse({
    access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
  });
  const response = await handleCallback(new Request(
    `https://relay/google/callback?code=C&state=${state}&picked_file_ids=folder-id`,
  ), env);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /refresh_token=RT/);
  assert.match(text, /picked_file_ids=folder-id/);
  assert.match(text, new RegExp(`state=${state}`));
});

test('Google callback accepts state without an app parameter', async () => {
  globalThis.fetch = async () => jsonResponse({ access_token: 'AT', expires_in: 3600 });

  const response = await handleCallback(new Request(
    `https://relay/google/callback?code=C&state=${state}`,
  ), env);

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /obsidian:\/\/air-sync-auth/);
  assert.match(text, /Redirecting to Obsidian/);
});

test('Google callback keeps accepting legacy state with an app parameter', async () => {
  globalThis.fetch = async () => jsonResponse({ access_token: 'AT', expires_in: 3600 });

  const response = await handleCallback(new Request(
    `https://relay/google/callback?code=C&state=${legacyState}`,
  ), env);

  assert.equal(response.status, 200);
});

test('worker denial wins over success parameters and ignores provider descriptions', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return jsonResponse({}); };
  for (const handler of [handleCallback, handlePCloudCallback]) {
    const response = await handler(new Request(
      `https://relay/callback?error=access_denied&error_description=secret-sentinel&code=C&state=${state}`,
    ), env);
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.match(text, /Authorization was denied\./);
    assert.doesNotMatch(text, /secret-sentinel/);
  }
  assert.equal(requests, 0);
  assert.deepEqual(projectAuthorizationError('temporarily_unavailable'), {
    code: 'temporarily_unavailable',
    message: 'Authorization failed (temporarily_unavailable).',
  });
});

test('pCloud keeps access-only success and rejects malformed logical success', async () => {
  globalThis.fetch = async () => jsonResponse({ result: 0, access_token: 'AT' });
  let response = await handlePCloudCallback(new Request(
    `https://relay/pcloud/callback?code=C&state=${state}&hostname=eapi.pcloud.com`,
  ), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /hostname=eapi.pcloud.com/);

  for (const value of [null, [], {}, { result: '0', access_token: 'AT' }, { result: 0 }]) {
    globalThis.fetch = async () => jsonResponse(value);
    response = await handlePCloudCallback(new Request(
      `https://relay/pcloud/callback?code=C&state=${state}`,
    ), env);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /Invalid token response/);
  }
});

test('pCloud rejects an untrusted host before any outbound request', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return jsonResponse({ result: 0, access_token: 'AT' }); };
  const response = await handlePCloudCallback(new Request(
    `https://relay/pcloud/callback?code=C&state=${state}&hostname=attacker.example`,
  ), env);
  assert.equal(response.status, 400);
  assert.equal(requests, 0);
});

async function runStaticCallback(search) {
  const html = await readFile(new URL('../../docs/callback/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const content = { innerHTML: '', textContent: '', className: '' };
  const location = { search, href: 'unchanged' };
  vm.runInNewContext(script, {
    URLSearchParams,
    atob,
    document: { getElementById: () => content },
    window: { location },
    Object,
    Array,
    JSON,
    encodeURIComponent,
  });
  return { content, location };
}

test('static callback rejects malformed state without throwing', async () => {
  for (const value of [null, 7, [], { app: 'obsidian-plugin' }]) {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    const result = await runStaticCallback(`?code=C&state=${encoded}`);
    assert.equal(result.location.href, 'unchanged');
    assert.match(result.content.textContent, /Invalid state/);
  }
});

test('static callback accepts state without an app parameter', async () => {
  const result = await runStaticCallback(`?code=C&state=${state}`);

  assert.match(result.location.href, /^obsidian:\/\/air-sync-auth\?/);
  assert.match(result.content.innerHTML, /Redirecting to Obsidian/);
});

test('static callback keeps accepting legacy state with an app parameter', async () => {
  const result = await runStaticCallback(`?code=C&state=${legacyState}`);

  assert.match(result.location.href, /^obsidian:\/\/air-sync-auth\?/);
});

test('static denial has worker-equivalent text and valid state forwards exactly', async () => {
  let result = await runStaticCallback(
    `?error=access_denied&error_description=secret-sentinel&code=C&state=${state}`,
  );
  assert.equal(result.content.textContent, 'Authorization was denied.');
  assert.equal(result.location.href, 'unchanged');

  result = await runStaticCallback(`?code=C&state=${state}`);
  assert.match(result.location.href, new RegExp(`state=${state}`));
});
