import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dataDir = await mkdtemp(path.join(tmpdir(), 'github-panel-test-'));
process.env.GITHUB_PANEL_DATA = dataDir;
process.env.GITHUB_PANEL_SECRET = 'test-secret-for-server-tests';

const { startServer } = await import('../server.mjs');
const { server, url } = await startServer({ port: 0, host: '127.0.0.1' });
const origin = new URL(url).origin;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

async function json(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  return { response, body: await response.json() };
}

test('bootstrap works and issues a persistent HttpOnly session cookie', async () => {
  const response = await fetch(`${origin}/api/bootstrap`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /ghpanel_session=/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=2592000/);

  const body = await response.json();
  assert.deepEqual(body.accounts, []);
  assert.equal(body.activeId, null);
  assert.equal(body.config.source, 'none');
});

test('the page is served with a locked-down content security policy', async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('a valid Client ID can be saved and read back', async () => {
  const saved = await json('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'Ov23liTestClientId123' }),
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.config.source, 'saved');

  const bootstrap = await json('/api/bootstrap');
  assert.equal(bootstrap.body.config.clientId, 'Ov23liTestClientId123');
});

test('invalid Client ID is rejected', async () => {
  const { response, body } = await json('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: 'bad id with spaces' }),
  });
  assert.equal(response.status, 400);
  assert.equal(body.error, 'INVALID_CLIENT_ID');
});

test('cross-origin writes are rejected', async () => {
  const { response, body } = await json('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ clientId: 'Ov23liTestClientId123' }),
  });
  assert.equal(response.status, 403);
  assert.equal(body.error, 'ORIGIN_NOT_ALLOWED');
});

test('star-all validates the repo and requires an account', async () => {
  const invalid = await json('/api/star-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'not a repo' }),
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'INVALID_REPO');

  const noAccounts = await json('/api/star-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: 'https://github.com/owner/repo' }),
  });
  assert.equal(noAccounts.response.status, 400);
  assert.equal(noAccounts.body.error, 'NO_ACCOUNTS');
});

test('unknown accounts return 404', async () => {
  const { response, body } = await json('/api/accounts/missing/repos');
  assert.equal(response.status, 404);
  assert.equal(body.error, 'ACCOUNT_NOT_FOUND');
});

test('custom explore links can be added, listed, and removed', async () => {
  const invalid = await json('/api/explore-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'javascript:alert(1)' }),
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'INVALID_URL');

  const added = await json('/api/explore-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'example.com', label: '示例' }),
  });
  assert.equal(added.response.status, 200);
  assert.deepEqual(added.body.customLinks, [{ label: '示例', url: 'https://example.com/' }]);

  const bootstrap = await json('/api/bootstrap');
  assert.deepEqual(bootstrap.body.config.customLinks, [{ label: '示例', url: 'https://example.com/' }]);

  const removed = await json('/api/explore-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remove: 'https://example.com/' }),
  });
  assert.deepEqual(removed.body.customLinks, []);
});