import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  bumpStarHistory,
  createSession,
  dataDir,
  defaultFeatures,
  FEATURE_KEYS,
  getKey,
  MAX_CUSTOM_LINKS,
  normalizeRepo,
  normalizeWebUrl,
  publicAccount,
  readState,
  SESSION_TTL_MS,
  starGrowth,
  writeState,
} from './lib.mjs';

const PORT = Number(process.env.PORT ?? 7790);
const HOST = process.env.HOST ?? '127.0.0.1';
const API_ORIGIN = process.env.GITHUB_API_ORIGIN || 'https://api.github.com';
const OAUTH_ORIGIN = process.env.GITHUB_OAUTH_ORIGIN || 'https://github.com';
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const SCOPES = 'read:user public_repo';
const MAX_BODY = 64 * 1024;
const MAX_TOKEN_BATCH = 50;
const USER_AGENT = 'github-account-panel';
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{10,64}$/;
const TOKEN_RE = /^\S{20,255}$/;

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

let state;
let stateQueue = Promise.resolve();
const flows = new Map();

// 聚合结果短缓存：/api/overview 与 /api/starred-overview 各要 N~2N 次 GitHub 请求，
// 60 秒内的重复调用直接复用，避免登录后连点/刷新造成的请求风暴。
const aggregateCache = new Map();
async function cachedAggregate(key, ttlMs, producer) {
  const hit = aggregateCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await producer();
  aggregateCache.set(key, { at: Date.now(), value });
  return value;
}
function invalidateAggregates() {
  aggregateCache.clear();
}

async function loadState() {
  state = await readState();
  if (!Array.isArray(state.accounts)) state.accounts = [];
  if (!state.config || typeof state.config !== 'object') state.config = { clientId: '' };
  if (!state.starHistory || typeof state.starHistory !== 'object') state.starHistory = {};
  state.config.features = { ...defaultFeatures(), ...(state.config.features || {}) };
  if (!Array.isArray(state.config.customLinks)) state.config.customLinks = [];
  for (const account of state.accounts) {
    if (typeof account.note !== 'string') account.note = '';
  }
  if (!state.accounts.some((account) => account.id === state.activeId)) {
    state.activeId = state.accounts[0]?.id ?? null;
  }
}

function featureOn(name) {
  return state.config?.features?.[name] !== false;
}

function mutateState(change) {
  const run = stateQueue.then(async () => {
    const next = structuredClone(state);
    await change(next);
    await writeState(next);
    state = next;
    invalidateAggregates();
    return state;
  });
  stateQueue = run.catch(() => {});
  return run;
}

function clientId() {
  return (state.config.clientId || process.env.GITHUB_CLIENT_ID || '').trim();
}

function clientIdSource() {
  if (state.config.clientId) return 'saved';
  return process.env.GITHUB_CLIENT_ID ? 'env' : 'none';
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function setSessionCookie(req, res) {
  const token = createSession(await getKey());
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `ghpanel_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`,
  );
}

function hostAllowed(req) {
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(req.headers.host || ''));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    const error = new Error('请求体必须是 application/json');
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('请求体过大');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求体不是有效 JSON');
    error.status = 400;
    throw error;
  }
}

async function githubOAuth(pathname, body) {
  let response;
  try {
    response = await fetch(`${OAUTH_ORIGIN}${pathname}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const wrapped = new Error(`无法连接 GitHub：${error.message}`);
    wrapped.status = 502;
    throw wrapped;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error_description || data.error || `GitHub OAuth 返回 ${response.status}`);
    error.status = 502;
    throw error;
  }
  return data;
}

async function githubApi(pathname, token) {
  let response;
  try {
    response = await fetch(`${API_ORIGIN}${pathname}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const wrapped = new Error(`无法连接 GitHub API：${error.message}`);
    wrapped.status = 502;
    throw wrapped;
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const error = new Error(data?.message || `GitHub API 返回 ${response.status}`);
    error.status = response.status === 401 ? 401 : 502;
    error.code = response.status === 401 ? 'TOKEN_INVALID' : 'GITHUB_API_ERROR';
    throw error;
  }
  return data;
}

function accountById(id) {
  return state.accounts.find((account) => account.id === id);
}

function mapRepo(repo, now = Date.now()) {
  const points = state.starHistory[repo.full_name];
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description || '',
    language: repo.language || '',
    stars: repo.stargazers_count || 0,
    forks: repo.forks_count || 0,
    private: Boolean(repo.private),
    fork: Boolean(repo.fork),
    htmlUrl: repo.html_url,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    growth: starGrowth(points, now),
    history: points ?? [],
  };
}

// 记录自有项目的 star 快照（公开+私有都记，增长曲线只用于「我的项目」）。
async function recordOwnStarHistory(repos) {
  let changed = false;
  await mutateState((next) => {
    for (const repo of repos) {
      if (bumpStarHistory(next.starHistory, repo.full_name, repo.stargazers_count)) changed = true;
    }
  });
  return changed;
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    return sendJson(res, 200, {
      accounts: state.accounts.map(publicAccount),
      activeId: state.activeId,
      config: {
        clientId: clientId(),
        source: clientIdSource(),
        features: { ...state.config.features },
        customLinks: [...state.config.customLinks],
      },
      session: { ttlDays: Math.round(SESSION_TTL_MS / 86400000) },
    });
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const body = await readJson(req);
    const value = String(body.clientId ?? '').trim();
    if (value && !CLIENT_ID_RE.test(value)) {
      return sendJson(res, 400, { error: 'INVALID_CLIENT_ID', message: 'Client ID 格式不正确' });
    }
    await mutateState((next) => {
      next.config.clientId = value;
    });
    return sendJson(res, 200, { config: { clientId: clientId(), source: clientIdSource() } });
  }

  if (req.method === 'POST' && pathname === '/api/features') {
    const body = await readJson(req);
    if (!body || typeof body.features !== 'object' || body.features === null) {
      return sendJson(res, 400, { error: 'INVALID_FEATURES', message: 'features 必须是对象' });
    }
    const patch = {};
    for (const key of FEATURE_KEYS) {
      if (typeof body.features[key] === 'boolean') patch[key] = body.features[key];
    }
    await mutateState((next) => {
      next.config.features = { ...next.config.features, ...patch };
    });
    return sendJson(res, 200, { features: { ...state.config.features } });
  }

  if (req.method === 'POST' && pathname === '/api/explore-links') {
    const body = await readJson(req);
    if (body?.remove != null) {
      const remove = String(body.remove);
      await mutateState((next) => {
        next.config.customLinks = next.config.customLinks.filter((link) => link.url !== remove);
      });
      return sendJson(res, 200, { customLinks: [...state.config.customLinks] });
    }
    const url = normalizeWebUrl(body?.url);
    if (!url) {
      return sendJson(res, 400, { error: 'INVALID_URL', message: '请输入有效的 http/https 网址' });
    }
    const label = String(body?.label || '').trim().slice(0, 40) || new URL(url).hostname;
    if (state.config.customLinks.length >= MAX_CUSTOM_LINKS && !state.config.customLinks.some((l) => l.url === url)) {
      return sendJson(res, 400, { error: 'TOO_MANY_LINKS', message: `最多添加 ${MAX_CUSTOM_LINKS} 个自定义网址` });
    }
    await mutateState((next) => {
      const rest = next.config.customLinks.filter((link) => link.url !== url);
      next.config.customLinks = [...rest, { label, url }];
    });
    return sendJson(res, 200, { customLinks: [...state.config.customLinks] });
  }

  if (req.method === 'POST' && pathname === '/api/auth/device/start') {
    const configured = clientId();
    if (!configured) {
      return sendJson(res, 400, {
        error: 'CLIENT_ID_REQUIRED',
        message: '请先填写 GitHub OAuth App 的 Client ID',
      });
    }
    const data = await githubOAuth('/login/device/code', {
      client_id: configured,
      scope: SCOPES,
    });
    if (!data.device_code || !data.user_code) {
      return sendJson(res, 502, { error: 'DEVICE_FLOW_FAILED', message: 'GitHub 未返回设备授权码' });
    }
    for (const [id, flow] of flows) {
      if (flow.expiresAt <= Date.now()) flows.delete(id);
    }
    const flowId = randomUUID();
    const interval = Math.max(5, Number(data.interval) || 5);
    flows.set(flowId, {
      clientId: configured,
      deviceCode: data.device_code,
      interval,
      nextPollAt: Date.now() + interval * 1000,
      expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    });
    return sendJson(res, 200, {
      flowId,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: Number(data.expires_in) || 900,
      interval,
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/device/poll') {
    const body = await readJson(req);
    const flow = flows.get(String(body.flowId || ''));
    if (!flow) {
      return sendJson(res, 404, {
        error: 'FLOW_NOT_FOUND',
        message: '授权会话已失效，请重新开始',
      });
    }
    if (Date.now() >= flow.expiresAt) {
      flows.delete(String(body.flowId));
      return sendJson(res, 200, { status: 'expired', message: '授权码已过期，请重新开始' });
    }
    if (Date.now() < flow.nextPollAt) {
      return sendJson(res, 200, {
        status: 'pending',
        retryAfter: Math.ceil((flow.nextPollAt - Date.now()) / 1000),
      });
    }

    const data = await githubOAuth('/login/oauth/access_token', {
      client_id: flow.clientId,
      device_code: flow.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (data.access_token) {
      const user = await githubApi('/user', data.access_token);
      const account = {
        id: String(user.id),
        login: user.login,
        name: user.name || '',
        avatarUrl: user.avatar_url,
        htmlUrl: user.html_url,
        token: data.access_token,
        scopes: String(data.scope || ''),
        addedAt: Date.now(),
      };
      let saved;
      await mutateState((next) => {
        const index = next.accounts.findIndex((item) => item.id === account.id);
        if (index >= 0) {
          saved = { ...next.accounts[index], ...account, addedAt: next.accounts[index].addedAt };
          next.accounts[index] = saved;
        } else {
          saved = account;
          next.accounts.push(account);
        }
        next.activeId = saved.id;
      });
      flows.delete(String(body.flowId));
      return sendJson(res, 200, { status: 'complete', account: publicAccount(saved) });
    }

    if (data.error === 'authorization_pending') {
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return sendJson(res, 200, { status: 'pending', retryAfter: flow.interval });
    }
    if (data.error === 'slow_down') {
      flow.interval += 5;
      flow.nextPollAt = Date.now() + flow.interval * 1000;
      return sendJson(res, 200, {
        status: 'pending',
        retryAfter: flow.interval,
        interval: flow.interval,
      });
    }
    if (data.error === 'expired_token') {
      flows.delete(String(body.flowId));
      return sendJson(res, 200, { status: 'expired', message: '授权码已过期，请重新开始' });
    }
    if (data.error === 'access_denied') {
      flows.delete(String(body.flowId));
      return sendJson(res, 200, { status: 'denied', message: '你拒绝了 GitHub 授权' });
    }
    return sendJson(res, 200, {
      status: 'error',
      message: data.error_description || data.error || 'GitHub 授权失败',
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/token') {
    const body = await readJson(req);
    const rawTokens = Array.isArray(body.tokens)
      ? body.tokens.join('\n')
      : String(body.tokens ?? body.token ?? '');
    const lines = rawTokens
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^Bearer\s+/i, ''))
      .filter(Boolean);
    if (!lines.length) {
      return sendJson(res, 400, { error: 'NO_TOKENS', message: '请粘贴至少一个 GitHub Token' });
    }
    const unique = [...new Set(lines)];
    if (unique.length > MAX_TOKEN_BATCH) {
      return sendJson(res, 400, {
        error: 'TOO_MANY_TOKENS',
        message: `单次最多登录 ${MAX_TOKEN_BATCH} 个 Token`,
      });
    }

    const results = new Array(unique.length);
    let cursor = 0;
    async function validateToken() {
      while (cursor < unique.length) {
        const index = cursor;
        cursor += 1;
        const token = unique[index];
        if (!TOKEN_RE.test(token)) {
          results[index] = { ok: false, message: 'Token 格式不正确' };
          continue;
        }
        try {
          const user = await githubApi('/user', token);
          if (!user?.id || !user?.login) throw new Error('GitHub 未返回有效用户信息');
          results[index] = {
            ok: true,
            account: {
              id: String(user.id),
              login: user.login,
              name: user.name || '',
              avatarUrl: user.avatar_url,
              htmlUrl: user.html_url,
              token,
              scopes: '',
              addedAt: Date.now(),
            },
          };
        } catch (error) {
          results[index] = {
            ok: false,
            message:
              error.status === 401
                ? 'Token 无效或已过期'
                : error.message || 'Token 验证失败',
          };
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(5, unique.length) }, () => validateToken()),
    );

    const successes = results.filter((result) => result.ok);
    let added = 0;
    let updated = 0;
    if (successes.length) {
      await mutateState((next) => {
        for (const result of successes) {
          const account = result.account;
          const index = next.accounts.findIndex((item) => item.id === account.id);
          if (index >= 0) {
            next.accounts[index] = {
              ...next.accounts[index],
              ...account,
              addedAt: next.accounts[index].addedAt,
            };
            result.action = 'updated';
            updated += 1;
          } else {
            next.accounts.push(account);
            result.action = 'added';
            added += 1;
          }
        }
        next.activeId = successes[successes.length - 1].account.id;
      });
    }

    return sendJson(res, 200, {
      results: results.map((result, index) => ({
        index: index + 1,
        ok: result.ok,
        login: result.account?.login || '',
        name: result.account?.name || '',
        action: result.action || '',
        message: result.ok
          ? result.action === 'updated'
            ? '已更新授权'
            : '已添加'
          : result.message,
      })),
      added,
      updated,
      failed: results.filter((result) => !result.ok).length,
      activeId: state.activeId,
    });
  }

  const activateMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/activate$/);
  if (req.method === 'POST' && activateMatch) {
    const id = decodeURIComponent(activateMatch[1]);
    if (!accountById(id)) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    await mutateState((next) => {
      next.activeId = id;
    });
    return sendJson(res, 200, { activeId: state.activeId });
  }

  // 账户备注（防止多个相似账号混淆）。
  const noteMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/note$/);
  if (req.method === 'PATCH' && noteMatch) {
    const id = decodeURIComponent(noteMatch[1]);
    if (!accountById(id)) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    const body = await readJson(req);
    const note = String(body.note ?? '').slice(0, 60);
    await mutateState((next) => {
      const target = next.accounts.find((account) => account.id === id);
      if (target) target.note = note;
    });
    return sendJson(res, 200, { accounts: state.accounts.map(publicAccount) });
  }

  // 批量健康检查：逐个校验 token 是否有效，能读到 /user 即视为正常。
  if (req.method === 'GET' && pathname === '/api/accounts/health') {
    const results = await Promise.all(
      state.accounts.map(async (account) => {
        try {
          const user = await githubApi('/user', account.token);
          return { id: account.id, login: account.login, ok: true, name: user?.name || '' };
        } catch (error) {
          return {
            id: account.id,
            login: account.login,
            ok: false,
            code: error.code || 'ERROR',
            message:
              error.status === 401 || error.code === 'TOKEN_INVALID'
                ? '授权失效或已过期'
                : error.message || '检查失败',
          };
        }
      }),
    );
    return sendJson(res, 200, {
      results,
      healthy: results.filter((item) => item.ok).length,
      unhealthy: results.filter((item) => !item.ok).length,
    });
  }

  const reposMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/repos$/);
  if (req.method === 'GET' && reposMatch) {
    const account = accountById(decodeURIComponent(reposMatch[1]));
    if (!account) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    // 取自己的全部仓库（含私有），按最近推送排序；再本地拆分公开/私有。
    const repos = await githubApi(
      '/user/repos?per_page=100&sort=pushed&affiliation=owner',
      account.token,
    );
    const list = Array.isArray(repos) ? repos.filter((repo) => repo && repo.full_name) : [];
    await recordOwnStarHistory(list);
    const mapped = list.map((repo) => mapRepo(repo));
    return sendJson(res, 200, {
      login: account.login,
      publicRepos: mapped.filter((repo) => !repo.private),
      privateRepos: mapped.filter((repo) => repo.private),
    });
  }

  const starredMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/starred$/);
  if (req.method === 'GET' && starredMatch) {
    const account = accountById(decodeURIComponent(starredMatch[1]));
    if (!account) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    const repos = await githubApi(
      '/user/starred?per_page=100&sort=created&direction=desc',
      account.token,
    );
    const list = Array.isArray(repos) ? repos.filter((repo) => repo && repo.full_name) : [];
    return sendJson(res, 200, { repos: list.map((repo) => mapRepo(repo)) });
  }

  if (req.method === 'GET' && pathname === '/api/overview') {
    const cacheKey = `overview:${state.accounts.map((a) => a.id).join(',')}`;
    const hit = aggregateCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 60000) return sendJson(res, 200, hit.value);
    // 多账户专属聚合：逐个账户取自身仓库统计，并计算跨账户重复 Star。
    const summaries = await Promise.all(
      state.accounts.map(async (account) => {
        try {
          const repos = await githubApi(
            '/user/repos?per_page=100&sort=pushed&affiliation=owner',
            account.token,
          );
          const list = Array.isArray(repos) ? repos : [];
          const stars = list.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
          const forks = list.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);
          const latestPush = list.reduce((max, repo) => {
            const t = repo.pushed_at ? Date.parse(repo.pushed_at) : 0;
            return t > max ? t : max;
          }, 0);
          return {
            id: account.id,
            login: account.login,
            ok: true,
            publicCount: list.filter((repo) => !repo.private).length,
            privateCount: list.filter((repo) => repo.private).length,
            stars,
            forks,
            latestPush: latestPush || null,
          };
        } catch (error) {
          return { id: account.id, login: account.login, ok: false, message: error.message };
        }
      }),
    );

    // 跨账户重复 Star：同一仓库被 >1 个账户收藏时列出，用于发现「多账户才看得见」的重复。
    let duplicates = [];
    let overlapError = null;
    try {
      const perAccount = await Promise.all(
        state.accounts.map(async (account) => {
          try {
            const repos = await githubApi(
              '/user/starred?per_page=100&sort=created&direction=desc',
              account.token,
            );
            return { login: account.login, repos: Array.isArray(repos) ? repos : [] };
          } catch {
            return { login: account.login, repos: [] };
          }
        }),
      );
      const seen = new Map();
      for (const { login, repos } of perAccount) {
        for (const repo of repos) {
          const entry = seen.get(repo.full_name) ?? { fullName: repo.full_name, logins: [] };
          entry.logins.push(login);
          seen.set(repo.full_name, entry);
        }
      }
      duplicates = [...seen.values()].filter((entry) => entry.logins.length > 1);
    } catch (error) {
      overlapError = error.message;
    }

    const payload = {
      accounts: summaries,
      totals: {
        accounts: summaries.filter((item) => item.ok).length,
        publicCount: summaries.reduce((sum, item) => sum + (item.publicCount || 0), 0),
        privateCount: summaries.reduce((sum, item) => sum + (item.privateCount || 0), 0),
        stars: summaries.reduce((sum, item) => sum + (item.stars || 0), 0),
        forks: summaries.reduce((sum, item) => sum + (item.forks || 0), 0),
      },
      duplicates,
      overlapError,
    };
    aggregateCache.set(cacheKey, { at: Date.now(), value: payload });
    return sendJson(res, 200, payload);
  }

  // 收藏跨账户汇总：所有账户收藏的仓库去重后列出，标注哪些账户收藏了它。
  if (req.method === 'GET' && pathname === '/api/starred-overview') {
    const perAccount = await Promise.all(
      state.accounts.map(async (account) => {
        try {
          const repos = await githubApi(
            '/user/starred?per_page=100&sort=created&direction=desc',
            account.token,
          );
          return { account, repos: Array.isArray(repos) ? repos : [] };
        } catch {
          return { account, repos: [], error: true };
        }
      }),
    );
    const map = new Map();
    for (const { account, repos } of perAccount) {
      for (const repo of repos) {
        const entry = map.get(repo.full_name) ?? {
          fullName: repo.full_name,
          htmlUrl: repo.html_url,
          stars: repo.stargazers_count || 0,
          language: repo.language || '',
          logins: [],
        };
        entry.logins.push(account.login);
        map.set(repo.full_name, entry);
      }
    }
    const items = [...map.values()].sort((a, b) => b.logins.length - a.logins.length);
    return sendJson(res, 200, {
      items,
      total: items.length,
      errors: perAccount.filter((item) => item.error).map((item) => item.account.login),
    });
  }

  // 单账户详情画像：仓库数、Star/Fork 总数、最近推送、加入时间。
  const detailMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/detail$/);
  if (req.method === 'GET' && detailMatch) {
    const account = accountById(decodeURIComponent(detailMatch[1]));
    if (!account) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    let user = null;
    let repos = [];
    try {
      user = await githubApi('/user', account.token);
      repos = await githubApi('/user/repos?per_page=100&sort=pushed&affiliation=owner', account.token);
    } catch (error) {
      return sendJson(res, error.status === 401 ? 401 : 502, {
        error: error.code || 'GITHUB_API_ERROR',
        message: error.message,
      });
    }
    const list = Array.isArray(repos) ? repos : [];
    const stars = list.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const forks = list.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);
    const latestPush = list.reduce((max, repo) => {
      const t = repo.pushed_at ? Date.parse(repo.pushed_at) : 0;
      return t > max ? t : max;
    }, 0);
    const topRepos = [...list]
      .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
      .slice(0, 5)
      .map((repo) => mapRepo(repo));
    return sendJson(res, 200, {
      account: publicAccount(account),
      user: {
        followers: user?.followers ?? 0,
        following: user?.following ?? 0,
        publicRepos: user?.public_repos ?? 0,
        createdAt: user?.created_at ?? null,
      },
      stats: {
        repoCount: list.length,
        publicCount: list.filter((repo) => !repo.private).length,
        privateCount: list.filter((repo) => repo.private).length,
        stars,
        forks,
        latestPush: latestPush || null,
      },
      topRepos,
    });
  }

  // 仓库详情增强：基础信息 + README（纯文本）+ 最新 issue/release 计数。
  if (req.method === 'GET' && pathname === '/api/repo-info') {
    const repo = normalizeRepo(url.searchParams.get('repo'));
    if (!repo) return sendJson(res, 400, { error: 'INVALID_REPO', message: '请输入 owner/repo' });
    const account = accountById(url.searchParams.get('accountId')) || state.accounts.find((a) => a.id === state.activeId);
    const token = account?.token;
    if (!token) return sendJson(res, 400, { error: 'NO_ACCOUNTS', message: '请先添加账户' });
    const [owner, name] = repo.split('/');
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const safe = (p) => githubApi(p, token).catch(() => null);
    const [info, readme, issues, releases] = await Promise.all([
      safe(base),
      safe(`${base}/readme`),
      safe(`${base}/issues?state=open&per_page=1`),
      safe(`${base}/releases?per_page=1`),
    ]);
    if (!info) return sendJson(res, 404, { error: 'REPO_NOT_FOUND', message: '仓库不存在或无权访问' });
    let readmeText = '';
    if (readme?.content) {
      readmeText = Buffer.from(readme.content, readme.encoding === 'base64' ? 'base64' : 'utf8')
        .toString('utf8')
        .slice(0, 4000);
    }
    return sendJson(res, 200, {
      repo,
      description: info.description || '',
      stars: info.stargazers_count || 0,
      forks: info.forks_count || 0,
      openIssues: info.open_issues_count || 0,
      language: info.language || '',
      htmlUrl: info.html_url,
      license: info.license?.spdx_id || '',
      defaultBranch: info.default_branch || '',
      latestRelease: Array.isArray(releases) && releases[0] ? releases[0].tag_name : '',
      recentIssue: Array.isArray(issues) && issues[0] ? issues[0].title : '',
      readme: readmeText,
    });
  }

  // 导出：账户清单或收藏清单（CSV）。
  if (req.method === 'GET' && pathname === '/api/export') {
    const kind = url.searchParams.get('kind') === 'starred' ? 'starred' : 'accounts';
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    let rows;
    if (kind === 'accounts') {
      rows = [['login', 'name', 'note', 'htmlUrl', 'addedAt']];
      for (const account of state.accounts) {
        rows.push([
          account.login,
          account.name,
          account.note || '',
          account.htmlUrl,
          new Date(account.addedAt || 0).toISOString(),
        ]);
      }
    } else {
      const map = new Map();
      await Promise.all(
        state.accounts.map(async (account) => {
          try {
            const repos = await githubApi('/user/starred?per_page=100', account.token);
            for (const repo of Array.isArray(repos) ? repos : []) {
              const entry = map.get(repo.full_name) ?? { fullName: repo.full_name, stars: repo.stargazers_count || 0, logins: [] };
              entry.logins.push(account.login);
              map.set(repo.full_name, entry);
            }
          } catch {}
        }),
      );
      rows = [['fullName', 'stars', 'starredBy']];
      for (const item of map.values()) rows.push([item.fullName, item.stars, item.logins.join(';')]);
    }
    const csv = rows.map((row) => row.map(esc).join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="github-panel-${kind}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end('\ufeff' + csv);
    return; // 直接写响应，跳过 sendJson
  }

  if (req.method === 'GET' && pathname === '/api/star-coverage') {
    // 已收藏该仓库的账户（覆盖矩阵）。任一账户可 star 就说明已收藏，用每个账户的 starred 列表判断。
    const repo = normalizeRepo(url.searchParams.get('repo'));
    if (!repo) return sendJson(res, 400, { error: 'INVALID_REPO', message: '请输入 owner/repo' });
    const lower = repo.toLowerCase();
    const coverage = await Promise.all(
      state.accounts.map(async (account) => {
        try {
          const repos = await githubApi(
            '/user/starred?per_page=100&sort=created&direction=desc',
            account.token,
          );
          const starred = Array.isArray(repos)
            ? repos.some((item) => String(item.full_name).toLowerCase() === lower)
            : false;
          return { id: account.id, login: account.login, starred };
        } catch {
          return { id: account.id, login: account.login, starred: false, error: true };
        }
      }),
    );
    return sendJson(res, 200, { repo, coverage });
  }

  // 单个账户 Fork 一个仓库（POST /forks）。
  const forkMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/fork\/([^/]+)\/([^/]+)\/?$/);
  if (forkMatch && req.method === 'POST') {
    const account = accountById(decodeURIComponent(forkMatch[1]));
    if (!account) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    const repo = normalizeRepo(
      `${decodeURIComponent(forkMatch[2])}/${decodeURIComponent(forkMatch[3])}`,
    );
    if (!repo) return sendJson(res, 400, { error: 'INVALID_REPO', message: '仓库格式不正确' });
    const [owner, name] = repo.split('/');
    let response;
    try {
      response = await fetch(`${API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/forks`, {
        method: 'POST',
        body: '{}',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${account.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      return sendJson(res, 502, { error: 'GITHUB_UNREACHABLE', message: '网络请求失败' });
    }
    if (response.status !== 202 && response.status !== 200) {
      let detail = '';
      try { detail = (await response.json())?.message || ''; } catch {}
      const hints = {
        401: '授权已失效，请重新添加该账户',
        403: '权限不足或该账户不能 Fork（可能是你自己的仓库）',
        404: '项目不存在或无权访问',
        422: '该账户已 Fork 过这个项目',
      };
      return sendJson(res, response.status === 401 ? 401 : 502, {
        error: response.status === 401 ? 'TOKEN_INVALID' : 'GITHUB_API_ERROR',
        message: hints[response.status] || detail || `GitHub 返回 ${response.status}`,
      });
    }
    return sendJson(res, 200, { repo, login: account.login, forked: true });
  }

  // 单个账户对单个仓库 Star / 取消 Star。
  const oneStarMatch = pathname.match(
    /^\/api\/accounts\/([^/]+)\/starred\/([^/]+)\/([^/]+)\/?$/,
  );
  if (oneStarMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const account = accountById(decodeURIComponent(oneStarMatch[1]));
    if (!account) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    const repo = normalizeRepo(
      `${decodeURIComponent(oneStarMatch[2])}/${decodeURIComponent(oneStarMatch[3])}`,
    );
    if (!repo) return sendJson(res, 400, { error: 'INVALID_REPO', message: '仓库格式不正确' });
    const [owner, name] = repo.split('/');
    const target = `${API_ORIGIN}/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let response;
    try {
      response = await fetch(target, {
        method: req.method,
        body: '',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${account.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': USER_AGENT,
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      return sendJson(res, 502, {
        error: 'GITHUB_UNREACHABLE',
        message: error.name === 'TimeoutError' ? '请求超时' : '网络请求失败',
      });
    }
    if (response.status !== 204 && response.status !== 304) {
      let detail = '';
      try {
        detail = (await response.json())?.message || '';
      } catch {}
      const hints = {
        401: '授权已失效，请重新添加该账户',
        403: '权限不足，授权时需要 public_repo 权限',
        404: '项目不存在或该账户无权访问',
      };
      return sendJson(res, response.status === 401 ? 401 : 502, {
        error: response.status === 401 ? 'TOKEN_INVALID' : 'GITHUB_API_ERROR',
        message: hints[response.status] || detail || `GitHub 返回 ${response.status}`,
      });
    }
    const starred = req.method === 'PUT';
    return sendJson(res, 200, { repo, login: account.login, starred });
  }

  const deleteMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const id = decodeURIComponent(deleteMatch[1]);
    if (!accountById(id)) return sendJson(res, 404, { error: 'ACCOUNT_NOT_FOUND', message: '账户不存在' });
    await mutateState((next) => {
      next.accounts = next.accounts.filter((account) => account.id !== id);
      if (next.activeId === id) next.activeId = next.accounts[0]?.id ?? null;
    });
    return sendJson(res, 200, { accounts: state.accounts.map(publicAccount), activeId: state.activeId });
  }

  if (req.method === 'POST' && pathname === '/api/star-all') {
    const body = await readJson(req);
    const repo = normalizeRepo(body.repo);
    if (!repo) {
      return sendJson(res, 400, {
        error: 'INVALID_REPO',
        message: '请输入 owner/repo 或 GitHub 项目链接',
      });
    }
    if (!state.accounts.length) {
      return sendJson(res, 400, { error: 'NO_ACCOUNTS', message: '请先添加至少一个 GitHub 账户' });
    }
    // 目标账户：默认全部；可传 accountIds 指定具体账户，或 count 取前 N 个。
    let targets = state.accounts;
    if (Array.isArray(body.accountIds) && body.accountIds.length) {
      const wanted = new Set(body.accountIds.map(String));
      targets = state.accounts.filter((account) => wanted.has(account.id));
    } else if (Number.isInteger(body.count) && body.count > 0) {
      targets = state.accounts.slice(0, body.count);
    }
    if (!targets.length) {
      return sendJson(res, 400, { error: 'NO_TARGETS', message: '没有匹配的账户' });
    }
    const [owner, name] = repo.split('/');
    const target = `${API_ORIGIN}/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const results = await Promise.all(
      targets.map(async (account) => {
        try {
          const response = await fetch(target, {
            method: 'PUT',
            body: '',
            headers: {
              Accept: 'application/vnd.github+json',
              Authorization: `Bearer ${account.token}`,
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': USER_AGENT,
            },
            signal: AbortSignal.timeout(20000),
          });
          if (response.status === 204) {
            return { id: account.id, login: account.login, ok: true };
          }
          let detail = '';
          try {
            const payload = await response.json();
            detail = payload?.message || '';
          } catch {}
          const hints = {
            401: '授权已失效，请重新添加该账户',
            403: '权限不足，授权时需要 public_repo 权限',
            404: '项目不存在或该账户无权访问',
          };
          return {
            id: account.id,
            login: account.login,
            ok: false,
            status: response.status,
            message: hints[response.status] || detail || `GitHub 返回 ${response.status}`,
          };
        } catch (error) {
          return {
            id: account.id,
            login: account.login,
            ok: false,
            status: 0,
            message: error.name === 'TimeoutError' ? '请求超时' : '网络请求失败',
          };
        }
      }),
    );
    return sendJson(res, 200, {
      repo,
      results,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      total: targets.length,
    });
  }

  return sendJson(res, 404, {
    error: 'NOT_FOUND',
    message: `接口不存在：${req.method} ${pathname}（若刚更新过代码，请重启服务）`,
  });
}

async function serveStatic(res, pathname) {
  const [file, type] = STATIC[pathname];
  let body;
  try {
    body = await readFile(path.join(PUBLIC_DIR, file));
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'NOT_FOUND', message: '文件不存在' });
    throw error;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' https://avatars.githubusercontent.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(body);
}

async function handle(req, res) {
  if (!hostAllowed(req)) {
    return sendJson(res, 403, { error: 'HOST_NOT_ALLOWED', message: '仅允许从本机访问' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return sendJson(res, 403, { error: 'ORIGIN_NOT_ALLOWED', message: '已拒绝跨站请求' });
  }
  await setSessionCookie(req, res);

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (STATIC[url.pathname]) return serveStatic(res, url.pathname);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return sendJson(res, 404, { error: 'NOT_FOUND', message: '页面不存在' });
  }
  if (req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH') {
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return sendJson(res, 404, { error: 'NOT_FOUND', message: '接口不存在' });
  }
  return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED', message: '不支持该请求方法' });
}

export async function startServer({ port = PORT, host = HOST } = {}) {
  await loadState();
  await getKey();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = Number(error.status) || 500;
      if (!res.headersSent) {
        sendJson(res, status, {
          error: error.code || 'INTERNAL_ERROR',
          message: status >= 500 && !error.status ? '服务器内部错误' : error.message,
        });
      } else {
        res.destroy();
      }
      if (status >= 500) console.error(error);
    });
  });
  // Windows may reserve whole port ranges (Hyper-V/WinNAT/Docker) and bind can
  // fail with EACCES (surfaced as EADDRINUSE) even when nothing is listening.
  // Scan upward until a port actually binds; this is "find a free port" in code.
  let bound = null;
  for (let candidate = port; candidate <= 65535; candidate += 1) {
    try {
      await listenOnce(server, candidate, host);
      bound = candidate;
      break;
    } catch (error) {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') continue;
      throw error;
    }
  }
  if (bound === null) throw new Error('找不到可用端口（已扫描到 65535）');
  startAutoSnapshot();
  const address = server.address();
  return { server, url: `http://${host}:${address.port}` };
}

// 每日自动快照：为所有账户的自有仓库记录一次 Star 历史（只在功能开启时）。
let snapshotTimer = null;
function startAutoSnapshot() {
  if (snapshotTimer) return;
  const run = async () => {
    if (!featureOn('autoSnapshot')) return;
    for (const account of state.accounts) {
      try {
        const repos = await githubApi(
          '/user/repos?per_page=100&sort=pushed&affiliation=owner',
          account.token,
        );
        if (Array.isArray(repos)) await recordOwnStarHistory(repos);
      } catch {}
    }
  };
  setTimeout(run, 60 * 1000); // 启动 1 分钟后先跑一次
  snapshotTimer = setInterval(run, 24 * 60 * 60 * 1000); // 之后每 24 小时
  snapshotTimer.unref?.();
}

function listenOnce(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startServer()
    .then(async ({ url }) => {
      console.log(`GitHub 账户面板已启动：${url}`);
      console.log('仅监听本机，按 Ctrl+C 停止。');
      // 把真实 URL 写到文件，供 start.bat 精确打开同一个端口（避免探测端口错位）。
      try {
        await mkdir(dataDir(), { recursive: true });
        await writeFile(path.join(dataDir(), '.lasturl'), url, 'utf8');
      } catch {}
      // Opened here so the browser always gets the REAL port after auto-scan.
      if (!process.env.NO_BROWSER) openBrowser(url);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

function openBrowser(url) {
  const attempts =
    process.platform === 'win32'
      ? [
          // rundll32 不经过 cmd 引号解析，是 Windows 上打开 URL 最稳的方式。
          ['rundll32', ['url.dll,FileProtocolHandler', url]],
          ['cmd', ['/c', 'start', '', url]],
        ]
      : process.platform === 'darwin'
        ? [['open', [url]]]
        : [['xdg-open', [url]]];

  for (const [cmd, args] of attempts) {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return;
    } catch {
      // 尝试下一种方式
    }
  }
  console.log(`请手动打开：${url}`);
}