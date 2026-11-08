import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DATA_DIR = path.join(import.meta.dirname, 'data');

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function dataDir() {
  return process.env.GITHUB_PANEL_DATA || DEFAULT_DATA_DIR;
}

let keyPromise;

// One local key protects both the token store and the panel session cookie.
export function getKey() {
  keyPromise ??= (async () => {
    if (process.env.GITHUB_PANEL_SECRET) {
      return scryptSync(process.env.GITHUB_PANEL_SECRET, 'github-panel-v1', 32);
    }
    await mkdir(dataDir(), { recursive: true });
    const file = path.join(dataDir(), '.key');
    try {
      const key = Buffer.from((await readFile(file, 'utf8')).trim(), 'base64');
      if (key.length !== 32) throw new Error(`Invalid key file: ${file}`);
      return key;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const key = randomBytes(32);
      await writeFile(file, key.toString('base64'), { mode: 0o600 });
      return key;
    }
  })();
  return keyPromise;
}

export async function seal(value) {
  const key = await getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

export async function open(blob) {
  const key = await getKey();
  const parsed = JSON.parse(blob);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

// 各功能的启用开关（设置页可切换）。默认全部开启。
export const FEATURE_KEYS = [
  'healthCheck',
  'starredOverview',
  'repoSort',
  'accountDetail',
  'bulkUnstar',
  'mutualStar',
  'repoInfo',
  'accountNotes',
  'growthCompare',
  'exportData',
  'autoSnapshot',
  'exploreLinks',
];

export function defaultFeatures() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));
}

export const MAX_CUSTOM_LINKS = 30;

// 自定义「发现 · 趋势」链接：只接受 http/https 绝对网址，去掉首尾空白。
export function normalizeWebUrl(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function emptyState() {
  return {
    version: 1,
    accounts: [],
    activeId: null,
    config: { clientId: '', features: defaultFeatures(), customLinks: [] },
    starHistory: {},
  };
}

// GitHub 只返回当前 star 数，增长率必须靠本地采样得到。每个 repo 只保留最近
// MAX_STAR_POINTS 个变化点（值未变则跳过），避免状态无限膨胀。
export const MAX_STAR_POINTS = 60;

export function bumpStarHistory(history, fullName, stars, now = Date.now()) {
  if (!Number.isFinite(stars)) return false;
  const points = (history[fullName] ??= []);
  const last = points[points.length - 1];
  if (last && last.stars === stars) return false;
  points.push({ t: now, stars });
  if (points.length > MAX_STAR_POINTS) points.splice(0, points.length - MAX_STAR_POINTS);
  return true;
}

// 用首末点估算「近 N 天新增 star」，点不足时返回 null 由前端显示「采样中」。
export function starGrowth(points, now = Date.now(), windowDays = 7) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const cutoff = now - windowDays * 86400000;
  const first = points[0];
  const last = points[points.length - 1];
  const baseline = points.find((point) => point.t >= cutoff) ?? first;
  const base = baseline === first ? first : points[Math.max(0, points.indexOf(baseline) - 1)];
  const days = Math.max((last.t - base.t) / 86400000, 1 / 24);
  return {
    delta: last.stars - base.stars,
    days: Math.round(days * 10) / 10,
    total: last.stars,
    samples: points.length,
    windowDays,
  };
}

export async function readState() {
  const file = path.join(dataDir(), 'state.enc');
  try {
    const state = await open(await readFile(file, 'utf8'));
    if (state?.version !== 1) throw new Error(`Unsupported state version in ${file}`);
    if (!state.starHistory || typeof state.starHistory !== 'object') state.starHistory = {};
    if (!state.config || typeof state.config !== 'object') state.config = {};
    state.config.features = { ...defaultFeatures(), ...(state.config.features || {}) };
    if (!Array.isArray(state.config.customLinks)) state.config.customLinks = [];
    for (const account of state.accounts || []) {
      if (typeof account.note !== 'string') account.note = '';
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    // 解密失败（key 与 state.enc 不匹配等）不应让服务崩溃：备份坏文件后以空状态启动。
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      await rename(file, backup);
      console.warn(`[警告] 无法解密 ${file}（可能密钥已变化），已备份为 ${backup} 并以空白状态启动。`);
      return emptyState();
    } catch {
      throw error;
    }
  }
}

export async function writeState(state) {
  await mkdir(dataDir(), { recursive: true });
  const file = path.join(dataDir(), 'state.enc');
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, await seal(state), { mode: 0o600 });
  await rename(temp, file);
}

function hmac(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSession(secret, ttlMs = SESSION_TTL_MS) {
  const payload = `${Date.now() + ttlMs}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${hmac(secret, payload)}`;
}

export function verifySession(secret, value, now = Date.now()) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [expires, nonce, signature] = parts;
  if (!/^\d+$/.test(expires) || Number(expires) <= now) return false;
  const expected = Buffer.from(hmac(secret, `${expires}.${nonce}`));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeRepo(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  value = value
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '');
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  if (owner.length > 39 || repo.length > 100) return null;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return null;
  return value;
}

export function publicAccount(account) {
  return {
    id: account.id,
    login: account.login,
    name: account.name || '',
    avatarUrl: account.avatarUrl,
    htmlUrl: account.htmlUrl,
    addedAt: account.addedAt,
    note: account.note || '',
  };
}