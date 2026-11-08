import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GITHUB_PANEL_SECRET = 'test-secret-for-core-tests';
const { createSession, normalizeRepo, normalizeWebUrl, open, parseGhAccounts, seal, verifySession } = await import('../lib.mjs');

test('normalizeWebUrl accepts http/https and bare hosts', () => {
  const cases = new Map([
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com/'],
    ['example.com', 'https://example.com/'],
    ['  https://github.com/trending  ', 'https://github.com/trending'],
  ]);
  for (const [input, expected] of cases) assert.equal(normalizeWebUrl(input), expected, input);
});

test('normalizeWebUrl rejects non-web or empty input', () => {
  for (const input of ['', '   ', 'javascript:alert(1)', 'ftp://example.com', 'mailto:a@b.com', null, undefined]) {
    assert.equal(normalizeWebUrl(input), null, String(input));
  }
});

test('normalizeRepo accepts common GitHub project references', () => {
  const cases = new Map([
    ['owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['http://www.github.com/owner/repo/', 'owner/repo'],
    ['github.com/owner/repo', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['  owner/repo  ', 'owner/repo'],
  ]);
  for (const [input, expected] of cases) assert.equal(normalizeRepo(input), expected, input);
});

test('normalizeRepo rejects ambiguous or unsafe input', () => {
  for (const input of [
    '',
    'owner',
    'owner/repo/issues',
    'https://gitlab.com/owner/repo',
    'owner//repo',
    '../repo',
    'owner/..',
    'owner/repo with space',
    null,
    undefined,
  ]) {
    assert.equal(normalizeRepo(input), null, String(input));
  }
});

test('parseGhAccounts extracts only logged-in github.com accounts with tokens', () => {
  const json = JSON.stringify({
    hosts: {
      'github.com': [
        { state: 'success', login: 'alice', token: 'gho_aaa' },
        { state: 'failed', login: 'bob', token: 'gho_bbb' },
        { state: 'success', login: 'carol' },
      ],
      'ghe.example.com': [{ state: 'success', login: 'dave', token: 'gho_ddd' }],
    },
  });
  assert.deepEqual(parseGhAccounts(json), [{ login: 'alice', token: 'gho_aaa' }]);
});

test('parseGhAccounts tolerates missing or malformed hosts', () => {
  for (const input of ['{}', '{"hosts":{}}', '{"hosts":{"github.com":null}}']) {
    assert.deepEqual(parseGhAccounts(input), [], input);
  }
});

test('session tokens verify, expire, and reject tampering', () => {
  const secret = Buffer.from('core-test-secret');
  const token = createSession(secret, 1000);
  assert.equal(verifySession(secret, token), true);
  assert.equal(verifySession(Buffer.from('other-secret'), token), false);
  assert.equal(verifySession(secret, `${token}x`), false);
  assert.equal(verifySession(secret, token, Date.now() + 2000), false);
});

test('sealed state round-trips and rejects modified ciphertext', async () => {
  const value = { accounts: [{ id: '1', token: 'secret' }], activeId: '1' };
  const blob = await seal(value);
  assert.deepEqual(await open(blob), value);

  const modified = JSON.parse(blob);
  modified.data = Buffer.from('tampered').toString('base64');
  await assert.rejects(() => open(JSON.stringify(modified)));
});