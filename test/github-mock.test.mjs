import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const dataDir = await mkdtemp(path.join(tmpdir(), 'github-panel-mock-'));
process.env.GITHUB_PANEL_DATA = dataDir;
process.env.GITHUB_PANEL_SECRET = 'test-secret-for-mock-tests';

const requests = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const reply = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && req.url === '/login/device/code') {
      return reply(200, {
        device_code: 'device-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    }
    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      return reply(200, {
        access_token: 'token-three',
        token_type: 'bearer',
        scope: 'read:user public_repo',
      });
    }
    if (req.method === 'GET' && req.url === '/user') {
      const auth = req.headers.authorization;
      if (auth === 'Bearer token-one') {
        return reply(200, {
          id: 1,
          login: 'alice',
          name: 'Alice',
          avatar_url: 'https://avatars.githubusercontent.com/u/1',
          html_url: 'https://github.com/alice',
          followers: 5,
          following: 3,
          public_repos: 2,
          created_at: '2020-01-01T00:00:00Z',
        });
      }
      if (auth === 'Bearer token-two') {
        return reply(200, {
          id: 2,
          login: 'bob',
          name: 'Bob',
          avatar_url: 'https://avatars.githubusercontent.com/u/2',
          html_url: 'https://github.com/bob',
          followers: 1,
          following: 1,
          public_repos: 2,
          created_at: '2020-01-01T00:00:00Z',
        });
      }
      if (auth === 'Bearer token-alpha-1234567890') {
        return reply(200, {
          id: 10,
          login: 'alpha',
          name: 'Alpha',
          avatar_url: 'https://avatars.githubusercontent.com/u/10',
          html_url: 'https://github.com/alpha',
        });
      }
      if (auth === 'Bearer token-beta-1234567890') {
        return reply(200, {
          id: 11,
          login: 'beta',
          name: 'Beta',
          avatar_url: 'https://avatars.githubusercontent.com/u/11',
          html_url: 'https://github.com/beta',
        });
      }
      if (auth === 'Bearer token-three') {
        return reply(200, {
          id: 3,
          login: 'carol',
          name: 'Carol',
          avatar_url: 'https://avatars.githubusercontent.com/u/3',
          html_url: 'https://github.com/carol',
        });
      }
      return reply(401, { message: 'Bad credentials' });
    }
    if (req.method === 'GET' && req.url.startsWith('/user/repos')) {
      return reply(200, [
        {
          id: 10,
          name: 'demo',
          full_name: 'alice/demo',
          description: 'Demo project',
          language: 'JavaScript',
          stargazers_count: 5,
          forks_count: 2,
          html_url: 'https://github.com/alice/demo',
          updated_at: '2026-01-01T00:00:00Z',
          pushed_at: '2026-01-03T00:00:00Z',
          private: false,
        },
        {
          id: 11,
          name: 'private-repo',
          full_name: 'alice/private-repo',
          description: 'Private repo',
          language: 'TypeScript',
          stargazers_count: 1,
          forks_count: 0,
          html_url: 'https://github.com/alice/private-repo',
          updated_at: '2026-01-01T00:00:00Z',
          pushed_at: '2026-01-02T00:00:00Z',
          private: true,
        },
      ]);
    }
    if (req.method === 'GET' && req.url.startsWith('/user/starred')) {
      return reply(200, [
        {
          id: 20,
          name: 'starred-one',
          full_name: 'someone/starred-one',
          description: 'Starred',
          language: 'Go',
          stargazers_count: 42,
          forks_count: 3,
          html_url: 'https://github.com/someone/starred-one',
          updated_at: '2026-01-02T00:00:00Z',
          private: false,
        },
      ]);
    }
    if (req.method === 'PUT' && req.url === '/user/starred/owner/repo') {
      if (req.headers.authorization === 'Bearer token-one') {
        res.writeHead(204);
        res.end();
        return;
      }
      return reply(403, { message: 'Forbidden' });
    }
    if (req.method === 'DELETE' && req.url === '/user/starred/owner/repo') {
      if (req.headers.authorization === 'Bearer token-two') {
        res.writeHead(204);
        res.end();
        return;
      }
      return reply(401, { message: 'Bad credentials' });
    }
    if (req.method === 'GET' && req.url === '/repos/owner/repo') {
      return reply(200, {
        full_name: 'owner/repo',
        description: 'A repo',
        stargazers_count: 99,
        forks_count: 7,
        open_issues_count: 3,
        language: 'Go',
        html_url: 'https://github.com/owner/repo',
        license: { spdx_id: 'MIT' },
        default_branch: 'main',
      });
    }
    if (req.method === 'GET' && req.url === '/repos/owner/repo/readme') {
      return reply(200, {
        content: Buffer.from('# Hello README').toString('base64'),
        encoding: 'base64',
      });
    }
    if (req.method === 'GET' && req.url === '/repos/owner/repo/issues?state=open&per_page=1') {
      return reply(200, [{ title: 'An issue' }]);
    }
    if (req.method === 'GET' && req.url === '/repos/owner/repo/releases?per_page=1') {
      return reply(200, [{ tag_name: 'v1.2.3' }]);
    }
    if (req.method === 'POST' && req.url === '/repos/owner/repo/forks') {
      if (req.headers.authorization === 'Bearer token-one') {
        return reply(202, { full_name: 'alice/repo' });
      }
      return reply(403, { message: 'Forbidden' });
    }
    return reply(404, { message: 'mock route not found' });
  });
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const mockOrigin = `http://127.0.0.1:${mock.address().port}`;
process.env.GITHUB_API_ORIGIN = mockOrigin;
process.env.GITHUB_OAUTH_ORIGIN = mockOrigin;

const { writeState } = await import('../lib.mjs');
await writeState({
  version: 1,
  accounts: [
    {
      id: '1',
      login: 'alice',
      name: 'Alice',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      htmlUrl: 'https://github.com/alice',
      token: 'token-one',
      scopes: 'read:user public_repo',
      addedAt: 1,
    },
    {
      id: '2',
      login: 'bob',
      name: 'Bob',
      avatarUrl: 'https://avatars.githubusercontent.com/u/2',
      htmlUrl: 'https://github.com/bob',
      token: 'token-two',
      scopes: 'read:user public_repo',
      addedAt: 2,
    },
  ],
  activeId: '1',
  config: { clientId: '' },
});

const { startServer } = await import('../server.mjs');
const { server, url } = await startServer({ port: 0, host: '127.0.0.1' });
const origin = new URL(url).origin;

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => mock.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

async function json(pathname, options = {}) {
  const response = await fetch(`${origin}${pathname}`, options);
  return { response, body: await response.json() };
}

function post(pathname, payload) {
  return json(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('bootstrap never exposes stored access tokens', async () => {
  const { body } = await json('/api/bootstrap');
  assert.equal(body.accounts.length, 2);
  assert.equal(body.accounts[0].token, undefined);
  assert.equal(body.accounts[1].scopes, undefined);
});

test('account repos return both public and private, split by visibility', async () => {
  const { response, body } = await json('/api/accounts/1/repos');
  assert.equal(response.status, 200);
  assert.equal(body.publicRepos.length, 1);
  assert.equal(body.privateRepos.length, 1);
  assert.equal(body.publicRepos[0].fullName, 'alice/demo');
  assert.equal(body.privateRepos[0].private, true);
  const call = requests.find((item) => item.url.startsWith('/user/repos'));
  assert.equal(call.authorization, 'Bearer token-one');
});

test('starred repos are listed for the account', async () => {
  const { response, body } = await json('/api/accounts/1/starred');
  assert.equal(response.status, 200);
  assert.equal(body.repos.length, 1);
  assert.equal(body.repos[0].fullName, 'someone/starred-one');
});

test('overview aggregates every account and detects cross-account duplicates', async () => {
  const { response, body } = await json('/api/overview');
  assert.equal(response.status, 200);
  assert.equal(body.totals.accounts, 2);
  assert.equal(body.totals.publicCount, 2);
  assert.equal(body.totals.privateCount, 2);
  assert.equal(body.totals.stars, 12);
  // 两个账户都收藏了同一个 starred-one，应被识别为重复。
  assert.equal(body.duplicates.length, 1);
  assert.equal(body.duplicates[0].fullName, 'someone/starred-one');
});

test('star-coverage reports which accounts already starred a repo', async () => {
  const { response, body } = await json('/api/star-coverage?repo=someone/starred-one');
  assert.equal(response.status, 200);
  assert.equal(body.repo, 'someone/starred-one');
  assert.equal(body.coverage.length, 2);
  assert.ok(body.coverage.every((item) => item.starred));
});

test('star-all stars with every account and reports per-account failures', async () => {
  const { response, body } = await post('/api/star-all', { repo: 'owner/repo' });
  assert.equal(response.status, 200);
  assert.equal(body.repo, 'owner/repo');
  assert.equal(body.succeeded, 1);
  assert.equal(body.failed, 1);
  assert.deepEqual(
    body.results.map((result) => result.ok),
    [true, false],
  );
  assert.equal(body.results[1].status, 403);
  assert.match(body.results[1].message, /public_repo/);

  const puts = requests.filter((item) => item.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.deepEqual(
    puts.map((item) => item.authorization).sort(),
    ['Bearer token-one', 'Bearer token-two'],
  );
});

test('star-all can target a specific account by id', async () => {
  const before = requests.filter((item) => item.method === 'PUT').length;
  const { response, body } = await post('/api/star-all', {
    repo: 'owner/repo',
    accountIds: ['1'],
  });
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].login, 'alice');
  const puts = requests.filter((item) => item.method === 'PUT');
  assert.equal(puts.length, before + 1);
  assert.equal(puts[puts.length - 1].authorization, 'Bearer token-one');
});

test('star-all can target the first N accounts by count', async () => {
  const before = requests.filter((item) => item.method === 'PUT').length;
  const { response, body } = await post('/api/star-all', { repo: 'owner/repo', count: 1 });
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.results[0].login, 'alice');
  const puts = requests.filter((item) => item.method === 'PUT');
  assert.equal(puts.length, before + 1);
});

test('star-all rejects unknown account ids with no targets', async () => {
  const { response, body } = await post('/api/star-all', {
    repo: 'owner/repo',
    accountIds: ['does-not-exist'],
  });
  assert.equal(response.status, 400);
  assert.equal(body.error, 'NO_TARGETS');
});

test('single account can star a repo via PUT', async () => {
  const { response, body } = await json('/api/accounts/1/starred/owner/repo', { method: 'PUT' });
  assert.equal(response.status, 200);
  assert.equal(body.repo, 'owner/repo');
  assert.equal(body.login, 'alice');
  assert.equal(body.starred, true);
});

test('single account can unstar a repo via DELETE', async () => {
  // token-two is the mock-authorized account for DELETE
  const { response, body } = await json('/api/accounts/2/starred/owner/repo', {
    method: 'DELETE',
  });
  assert.equal(response.status, 200);
  assert.equal(body.login, 'bob');
  assert.equal(body.starred, false);
});

test('unstar failure surfaces the GitHub error', async () => {
  // Account 1 (token-one) is not authorized for DELETE in the mock -> 401.
  const { response, body } = await json('/api/accounts/1/starred/owner/repo', {
    method: 'DELETE',
  });
  assert.equal(response.status, 401);
  assert.equal(body.error, 'TOKEN_INVALID');
});

test('device flow authorization adds a third account and makes it active', async () => {
  const config = await post('/api/config', { clientId: 'Ov23liMockClientId123' });
  assert.equal(config.response.status, 200);

  const started = await post('/api/auth/device/start', {});
  assert.equal(started.response.status, 200);
  assert.equal(started.body.userCode, 'ABCD-EFGH');
  assert.equal(started.body.verificationUri, 'https://github.com/login/device');

  // The server respects GitHub's 5 second device-flow polling interval.
  await new Promise((resolve) => setTimeout(resolve, 5400));

  const polled = await post('/api/auth/device/poll', { flowId: started.body.flowId });
  assert.equal(polled.response.status, 200);
  assert.equal(polled.body.status, 'complete');
  assert.equal(polled.body.account.login, 'carol');

  const bootstrap = await json('/api/bootstrap');
  assert.equal(bootstrap.body.accounts.length, 3);
  assert.equal(bootstrap.body.activeId, '3');
  assert.equal(bootstrap.body.accounts[2].token, undefined);
});

test('batch token login adds valid accounts, deduplicates, and reports bad tokens', async () => {
  const { response, body } = await post('/api/auth/token', {
    tokens: [
      'token-alpha-1234567890',
      'token-beta-1234567890',
      'bad_token_that_is_long_enough_123',
      'Bearer token-alpha-1234567890',
    ].join('\n'),
  });
  assert.equal(response.status, 200);
  assert.equal(body.results.length, 3);
  assert.deepEqual(
    body.results.map((result) => result.ok),
    [true, true, false],
  );
  assert.equal(body.added, 2);
  assert.equal(body.updated, 0);
  assert.equal(body.failed, 1);
  assert.equal(body.results[0].login, 'alpha');
  assert.equal(body.results[1].login, 'beta');
  assert.equal(body.results[2].message, 'Token 无效或已过期');
  assert.equal(body.results[0].token, undefined);

  const bootstrap = await json('/api/bootstrap');
  assert.equal(bootstrap.body.accounts.length, 5);
  assert.equal(bootstrap.body.activeId, '11');
});

test('single token login updates an existing account without duplicating it', async () => {
  const { response, body } = await post('/api/auth/token', {
    tokens: 'token-alpha-1234567890',
  });
  assert.equal(response.status, 200);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].ok, true);
  assert.equal(body.results[0].action, 'updated');
  assert.equal(body.added, 0);
  assert.equal(body.updated, 1);
  assert.equal(body.activeId, '10');

  const bootstrap = await json('/api/bootstrap');
  assert.equal(bootstrap.body.accounts.length, 5);
});

test('malformed tokens are rejected before any GitHub request', async () => {
  const before = requests.length;
  const { response, body } = await post('/api/auth/token', { tokens: 'short' });
  assert.equal(response.status, 200);
  assert.equal(body.failed, 1);
  assert.equal(body.results[0].message, 'Token 格式不正确');
  assert.equal(requests.length, before);
});

test('features are returned in bootstrap and can be toggled', async () => {
  const boot = await json('/api/bootstrap');
  assert.equal(boot.body.config.features.healthCheck, true);

  const off = await post('/api/features', { features: { healthCheck: false } });
  assert.equal(off.response.status, 200);
  assert.equal(off.body.features.healthCheck, false);

  const boot2 = await json('/api/bootstrap');
  assert.equal(boot2.body.config.features.healthCheck, false);
  // restore
  await post('/api/features', { features: { healthCheck: true } });
});

test('account health check reports each account', async () => {
  const { response, body } = await json('/api/accounts/health');
  assert.equal(response.status, 200);
  const alice = body.results.find((r) => r.login === 'alice');
  assert.equal(alice.ok, true);
  assert.ok(body.healthy >= 1);
});

test('account note can be set and is returned by bootstrap', async () => {
  const { response, body } = await json('/api/accounts/1/note', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: '主号' }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.accounts.find((a) => a.id === '1').note, '主号');
});

test('starred-overview aggregates stars across accounts', async () => {
  const { response, body } = await json('/api/starred-overview');
  assert.equal(response.status, 200);
  assert.ok(body.total >= 1);
  const entry = body.items.find((i) => i.fullName === 'someone/starred-one');
  assert.ok(entry);
  assert.ok(entry.logins.length >= 2);
});

test('repo-info returns readme and counts', async () => {
  const { response, body } = await json('/api/repo-info?repo=owner/repo&accountId=1');
  assert.equal(response.status, 200);
  assert.equal(body.stars, 99);
  assert.equal(body.license, 'MIT');
  assert.match(body.readme, /Hello README/);
  assert.equal(body.latestRelease, 'v1.2.3');
});

test('account detail returns profile stats', async () => {
  const { response, body } = await json('/api/accounts/1/detail');
  assert.equal(response.status, 200);
  assert.equal(body.account.login, 'alice');
  assert.equal(typeof body.stats.repoCount, 'number');
});

test('fork a repo for a specific account', async () => {
  const { response, body } = await json('/api/accounts/1/fork/owner/repo', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal(body.forked, true);
  assert.equal(body.login, 'alice');
});

test('export accounts returns CSV content type', async () => {
  const response = await fetch(`${origin}/api/export?kind=accounts`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  const text = await response.text();
  assert.match(text, /login/);
  assert.match(text, /alice/);
});