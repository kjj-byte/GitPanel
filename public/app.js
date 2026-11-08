const $ = (id) => document.getElementById(id);

const ui = {
  accountCount: $('account-count'),
  accountList: $('account-list'),
  accountSearchWrap: $('account-search-wrap'),
  accountSearch: $('account-search'),
  accountSearchEmpty: $('account-search-empty'),
  sidebarEmpty: $('sidebar-empty'),
  addAccountBtn: $('add-account-btn'),
  settingsBtn: $('settings-btn'),
  activeAccount: $('active-account'),
  refreshReposBtn: $('refresh-repos-btn'),
  starForm: $('star-form'),
  repoInput: $('repo-input'),
  starAllBtn: $('star-all-btn'),
  starTargetSelect: $('star-target-select'),
  starCountRow: $('star-count-row'),
  starCountInput: $('star-count-input'),
  starCountHint: $('star-count-hint'),
  starPickList: $('star-pick-list'),
  starResults: $('star-results'),
  overviewCount: $('overview-count'),
  statGrid: $('stat-grid'),
  overviewExtra: $('overview-extra'),
  reposSubtitle: $('repos-subtitle'),
  repoSearchInput: $('repo-search-input'),
  repoTabs: $('repo-tabs'),
  tabCountPublic: $('tab-count-public'),
  tabCountPrivate: $('tab-count-private'),
  tabCountStarred: $('tab-count-starred'),
  repoGrid: $('repo-grid'),
  reposEmpty: $('repos-empty'),
  reposEmptyTitle: $('repos-empty-title'),
  reposEmptyText: $('repos-empty-text'),
  emptyAddBtn: $('empty-add-btn'),
  detailDialog: $('repo-detail-dialog'),
  detailBody: $('repo-detail-body'),
  infoDialog: $('info-dialog'),
  infoBody: $('info-body'),
  overviewTools: $('overview-tools'),
  healthBtn: $('health-btn'),
  starredOverviewBtn: $('starred-overview-btn'),
  exportBtn: $('export-btn'),
  exportMenu: $('export-menu'),
  exportWrap: $('export-wrap'),
  repoSortWrap: $('repo-sort-wrap'),
  repoSortSelect: $('repo-sort-select'),
  featureList: $('feature-list'),
  exploreList: $('explore-list'),
  exploreAddForm: $('explore-add-form'),
  exploreAddUrl: $('explore-add-url'),
  dialog: $('add-dialog'),
  dialogTitle: $('dialog-title'),
  dialogLead: $('dialog-lead'),
  loginTabs: $('login-tabs'),
  oauthTab: $('oauth-tab'),
  tokenTab: $('token-tab'),
  oauthPanel: $('oauth-panel'),
  tokenPanel: $('token-panel'),
  tokenInput: $('token-input'),
  tokenLoginBtn: $('token-login-btn'),
  tokenResults: $('token-results'),
  configView: $('config-view'),
  clientIdInput: $('client-id-input'),
  configSource: $('config-source'),
  homeUrl: $('home-url'),
  saveConfigBtn: $('save-config-btn'),
  authView: $('auth-view'),
  authStart: $('auth-start'),
  startAuthBtn: $('start-auth-btn'),
  authWait: $('auth-wait'),
  deviceCode: $('device-code'),
  copyCodeBtn: $('copy-code-btn'),
  verifyLink: $('verify-link'),
  authStatus: $('auth-status'),
  restartAuthBtn: $('restart-auth-btn'),
  toast: $('toast'),
};

const state = {
  accounts: [],
  activeId: null,
  config: { clientId: '', source: 'none' },
  session: { ttlDays: 30 },
  publicRepos: [],
  privateRepos: [],
  starredRepos: [],
  activeTab: 'public',
  accountFilter: '',
  repoFilter: '',
  repoSort: 'updated',
  starPickSig: '',
  loadingRepos: false,
  activating: false,
  starBusy: false,
  overview: null,
  auth: { mode: 'add', tab: 'oauth', flowId: null, timer: null, polling: false },
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

let toastTimer;
let reposRequest = 0;

// 输入类事件防抖，避免每次按键都全量重建列表。
function debounce(fn, wait = 140) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const FEATURE_LABELS = {
  healthCheck: '账户健康检查',
  starredOverview: '收藏跨账户汇总',
  repoSort: '仓库排序',
  accountDetail: '账户详情页',
  bulkUnstar: '批量取消 Star',
  mutualStar: '指定账户 Star / Fork',
  repoInfo: '仓库详情增强（README）',
  accountNotes: '账户备注',
  growthCompare: 'Star 增长对比',
  exportData: '导出 CSV',
  autoSnapshot: '每日自动快照',
  exploreLinks: '发现 / 趋势链接',
};

function featureOn(name) {
  return state.config.features?.[name] !== false;
}

// 需要专门检索/外部服务的内容，用跳转链接提供，不在本地抓取。
const EXPLORE_LINKS = [
  { label: 'GitHub Trending', desc: '每日/每周热榜', url: 'https://github.com/trending' },
  { label: 'Trending · 今天', desc: '今日上升最快', url: 'https://github.com/trending?since=daily' },
  { label: 'Trending · 本周', desc: '本周热门', url: 'https://github.com/trending?since=weekly' },
  { label: 'Trending · 中文圈', desc: '中文开发者趋势', url: 'https://github.com/trending?spoken_language_code=zh' },
  { label: 'Explore', desc: 'GitHub 探索推荐', url: 'https://github.com/explore' },
  { label: 'Topics', desc: '按主题发现项目', url: 'https://github.com/topics' },
  { label: 'Collections', desc: '官方精选合集', url: 'https://github.com/collections' },
  { label: 'GitHub 热榜 (GitHub Ranking)', desc: '社区热榜', url: 'https://github.com/kon9chunkit/GitHub-Chinese-Top-Charts' },
];

function renderExplore() {
  if (!ui.exploreList) return;
  ui.exploreList.replaceChildren();
  const links = [...EXPLORE_LINKS, ...(state.config.customLinks || [])];
  for (const link of links) {
    const custom = !!link.custom;
    const row = el(
      'a',
      {
        class: 'explore-link',
        href: link.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: link.desc || link.url,
      },
      el('span', { class: 'explore-label', text: link.label }),
      el('span', { class: 'explore-desc', text: link.desc || '' }),
      el('span', { class: 'explore-arrow', text: '↗' }),
    );
    if (custom) {
      row.append(
        el('button', {
          class: 'explore-remove',
          type: 'button',
          title: '移除',
          'aria-label': `移除 ${link.label}`,
          text: '×',
          onclick: (event) => {
            event.preventDefault();
            removeExploreLink(link.url);
          },
        }),
      );
    }
    ui.exploreList.append(row);
  }
}

async function addExploreLink(event) {
  if (event) event.preventDefault();
  const url = ui.exploreAddUrl.value.trim();
  if (!url) return;
  try {
    const data = await api('/api/explore-links', { method: 'POST', body: { url } });
    state.config.customLinks = data.customLinks.map((link) => ({ ...link, custom: true }));
    ui.exploreAddUrl.value = '';
    renderExplore();
    showToast('已添加自定义网址', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function removeExploreLink(url) {
  try {
    const data = await api('/api/explore-links', { method: 'POST', body: { remove: url } });
    state.config.customLinks = data.customLinks.map((link) => ({ ...link, custom: true }));
    renderExplore();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

let featureNodes = null;
function applyFeatures() {
  if (!featureNodes) featureNodes = [...document.querySelectorAll('[data-feature]')];
  for (const node of featureNodes) {
    node.hidden = !featureOn(node.dataset.feature);
  }
}

function renderFeatureSettings() {
  if (!ui.featureList) return;
  ui.featureList.replaceChildren();
  for (const [key, label] of Object.entries(FEATURE_LABELS)) {
    const id = `feat-${key}`;
    const box = el('input', { type: 'checkbox', id, value: key });
    box.checked = featureOn(key);
    box.addEventListener('change', () => toggleFeature(key, box.checked));
    ui.featureList.append(
      el(
        'label',
        { class: 'feature-item', for: id },
        box,
        el('span', { class: 'feature-name', text: label }),
      ),
    );
  }
}

async function toggleFeature(key, on) {
  try {
    const data = await api('/api/features', { method: 'POST', body: { features: { [key]: on } } });
    state.config.features = data.features;
    applyFeatures();
    showToast(`${FEATURE_LABELS[key] || key} 已${on ? '开启' : '关闭'}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
    renderFeatureSettings();
  }
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function avatar(account, className) {
  const image = el('img', {
    class: className,
    alt: '',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
  });
  if (account.avatarUrl) image.src = account.avatarUrl;
  return image;
}

async function api(pathname, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(pathname, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `请求失败（${response.status}）`);
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
}

function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.className = `toast visible${type === 'error' ? ' error' : type === 'success' ? ' success' : ''}`;
  toastTimer = setTimeout(() => {
    ui.toast.className = 'toast';
  }, 4200);
}

function setBusy(button, label) {
  const original = button.textContent;
  button.disabled = true;
  button.replaceChildren(
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    document.createTextNode(label),
  );
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知时间' : dateFormatter.format(date);
}

function relativeDays(days) {
  if (days < 1) return '今天';
  if (days < 2) return '1 天';
  if (days < 30) return `${Math.round(days)} 天`;
  return `${Math.round(days / 30)} 个月`;
}

function renderAccounts() {
  ui.accountList.replaceChildren();
  ui.accountCount.textContent = String(state.accounts.length);
  ui.sidebarEmpty.hidden = state.accounts.length > 0;
  ui.accountSearchWrap.hidden = state.accounts.length < 2;

  const query = state.accountFilter.trim().toLowerCase();
  const visible = query
    ? state.accounts.filter(
        (account) =>
          account.login.toLowerCase().includes(query) ||
          (account.name || '').toLowerCase().includes(query),
      )
    : state.accounts;
  ui.accountSearchEmpty.hidden = !(query && visible.length === 0);

  for (const account of visible) {
    const active = account.id === state.activeId;
    const row = el('div', {
      class: `account${active ? ' is-active' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-current': active ? 'true' : 'false',
      title: `切换到 @${account.login}`,
    });
    row.addEventListener('click', () => activateAccount(account.id));
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateAccount(account.id);
      }
    });

    const text = el('span', { class: 'account-text' });
    text.append(
      el('span', { class: 'account-login', text: `@${account.login}` }),
    );
    if (featureOn('accountNotes') && account.note) {
      text.append(el('span', { class: 'account-note', text: account.note }));
    } else {
      text.append(el('span', { class: 'account-name', text: account.name || '未填写姓名' }));
    }

    const actions = el('span', { class: 'account-actions' });
    if (featureOn('accountDetail')) {
      const detailBtn = el('button', {
        class: 'account-mini',
        type: 'button',
        title: `查看 @${account.login} 详情`,
        text: 'i',
      });
      detailBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        openAccountDetail(account);
      });
      actions.append(detailBtn);
    }
    if (featureOn('accountNotes')) {
      const noteBtn = el('button', {
        class: 'account-mini',
        type: 'button',
        title: '编辑备注',
        text: '✎',
      });
      noteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        editAccountNote(account);
      });
      actions.append(noteBtn);
    }

    const remove = el('button', {
      class: 'account-delete',
      type: 'button',
      'aria-label': `移除 @${account.login}`,
      title: `移除 @${account.login}`,
      text: '×',
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeAccount(account);
    });

    row.append(avatar(account, 'account-avatar'), text);
    if (active) row.append(el('span', { class: 'account-active-dot', 'aria-hidden': 'true' }));
    row.append(actions, remove);
    ui.accountList.append(row);
  }
  // 仅在账户集合变化时重建 Star 勾选列表，避免搜索/备注时白白重建。
  const sig = state.accounts.map((a) => a.id).join(',');
  if (sig !== state.starPickSig) {
    state.starPickSig = sig;
    renderStarPickList();
  }
  updateStarTargetUI();
}

async function editAccountNote(account) {
  const note = window.prompt(`给 @${account.login} 设置备注（最多 60 字，留空清除）`, account.note || '');
  if (note === null) return;
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(account.id)}/note`, {
      method: 'PATCH',
      body: { note: note.trim() },
    });
    state.accounts = data.accounts;
    renderAccounts();
    showToast('备注已保存', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderActive() {
  const account = state.accounts.find((item) => item.id === state.activeId);
  ui.activeAccount.replaceChildren();

  if (!account) {
    ui.activeAccount.append(el('span', { class: 'muted', text: '尚未添加账户' }));
    ui.refreshReposBtn.disabled = true;
    ui.reposSubtitle.textContent = '选择左侧账户后加载其项目。';
    ui.emptyAddBtn.hidden = state.accounts.length > 0;
    return;
  }

  const text = el('div');
  text.append(
    el('div', { class: 'active-name', text: account.name || `@${account.login}` }),
    el('div', { class: 'active-meta', text: `@${account.login}` }),
  );
  ui.activeAccount.append(avatar(account, 'active-avatar'), text);
  ui.refreshReposBtn.disabled = state.loadingRepos;
}

function currentTabRepos() {
  let repos;
  if (state.activeTab === 'private') repos = state.privateRepos;
  else if (state.activeTab === 'starred') repos = state.starredRepos;
  else repos = state.publicRepos;
  const query = state.repoFilter.trim().toLowerCase();
  if (!query) return repos;
  return repos.filter(
    (repo) =>
      repo.fullName.toLowerCase().includes(query) ||
      (repo.description || '').toLowerCase().includes(query) ||
      (repo.language || '').toLowerCase().includes(query),
  );
}

function sortRepos(repos) {
  const by = state.repoSort;
  repos.sort((a, b) => {
    if (by === 'stars') return (b.stars || 0) - (a.stars || 0);
    if (by === 'name') return a.fullName.localeCompare(b.fullName);
    const at = Date.parse(a.pushedAt || a.updatedAt || 0) || 0;
    const bt = Date.parse(b.pushedAt || b.updatedAt || 0) || 0;
    return bt - at;
  });
}

function renderTabCounts() {
  ui.tabCountPublic.textContent = state.publicRepos.length ? String(state.publicRepos.length) : '';
  ui.tabCountPrivate.textContent = state.privateRepos.length ? String(state.privateRepos.length) : '';
  ui.tabCountStarred.textContent = state.starredRepos.length ? String(state.starredRepos.length) : '';
}

function switchTab(tab) {
  state.activeTab = tab;
  for (const button of ui.repoTabs.querySelectorAll('.repo-tab')) {
    const on = button.dataset.tab === tab;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  renderRepos();
  if (tab === 'starred' && !state.starredRepos.length && state.activeId && !state.loadingRepos) {
    loadStarred();
  }
}

function showReposEmpty(title, text) {
  ui.repoGrid.replaceChildren();
  ui.repoGrid.removeAttribute('aria-busy');
  ui.reposEmpty.hidden = false;
  ui.reposEmptyTitle.textContent = title;
  ui.reposEmptyText.textContent = text;
  ui.emptyAddBtn.hidden = state.accounts.length > 0;
}

function renderSkeletons() {
  ui.reposEmpty.hidden = true;
  ui.repoGrid.setAttribute('aria-busy', 'true');
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 6; index += 1) {
    fragment.append(el('div', { class: 'repo-skeleton', 'aria-hidden': 'true' }));
  }
  ui.repoGrid.replaceChildren(fragment);
}

function growthChip(repo) {
  const growth = repo.growth;
  if (!growth) {
    return el('span', { class: 'growth-chip pending', text: '增长采样中' });
  }
  const sign = growth.delta > 0 ? '+' : '';
  const cls = growth.delta > 0 ? 'up' : growth.delta < 0 ? 'down' : 'flat';
  return el('span', {
    class: `growth-chip ${cls}`,
    title: `近 ${relativeDays(growth.days)} 采样 ${growth.samples} 次`,
    text: `${sign}${growth.delta} / ${relativeDays(growth.days)}`,
  });
}

function repoCard(repo) {
  const isOwn = state.activeTab !== 'starred';
  const card = el('article', { class: `repo-card${repo.private ? ' is-private' : ''}` });
  const name = el('a', {
    class: 'repo-name',
    href: repo.htmlUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: repo.fullName,
    text: repo.fullName,
  });

  const top = el('div', { class: 'repo-card-top' }, name);
  if (repo.private) top.append(el('span', { class: 'repo-fork', text: '私有' }));
  else if (repo.fork) top.append(el('span', { class: 'repo-fork', text: 'fork' }));
  card.append(top);
  card.append(el('p', { class: 'repo-desc', text: repo.description || '暂无项目描述' }));

  const meta = el('div', { class: 'repo-meta' });
  if (repo.language) {
    meta.append(
      el(
        'span',
        { class: 'repo-meta-item' },
        el('span', { class: 'lang-dot', 'aria-hidden': 'true' }),
        document.createTextNode(repo.language),
      ),
    );
  }
  meta.append(el('span', { class: 'repo-meta-item', text: `★ ${repo.stars}` }));
  meta.append(el('span', { class: 'repo-meta-item', text: `⑂ ${repo.forks}` }));
  if (isOwn) meta.append(growthChip(repo));
  card.append(meta);

  const footer = el('div', { class: 'repo-card-footer' });
  footer.append(
    el('span', {
      class: 'repo-date',
      text: repo.pushedAt ? `推送于 ${formatDate(repo.pushedAt)}` : `更新于 ${formatDate(repo.updatedAt)}`,
    }),
  );

  if (state.activeTab === 'starred') {
    const unstarButton = el('button', {
      class: 'btn repo-star-btn repo-unstar-btn',
      type: 'button',
      text: '取消 Star',
      title: `让 @${state.accounts.find((a) => a.id === state.activeId)?.login || ''} 取消 Star ${repo.fullName}`,
    });
    unstarButton.addEventListener('click', () => unstarRepo(repo, unstarButton));
    footer.append(unstarButton);
  } else if (isOwn && !repo.private) {
    const starButton = el('button', {
      class: 'btn repo-star-btn',
      type: 'button',
      text: 'Star',
      title: `Star ${repo.fullName}`,
    });
    starButton.addEventListener('click', () => starAll(repo.fullName));
    footer.append(starButton);
  }
  if (featureOn('repoInfo') || isOwn) {
    const infoButton = el('button', {
      class: 'btn repo-star-btn',
      type: 'button',
      text: '详情',
      title: `查看 ${repo.fullName} 详情`,
    });
    infoButton.addEventListener('click', () =>
      featureOn('repoInfo') ? openRepoInfo(repo) : openRepoDetail(repo),
    );
    footer.append(infoButton);
  }

  if (isOwn) {
    card.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      openRepoDetail(repo);
    });
  }
  card.append(footer);
  return card;
}

function renderRepos() {
  renderTabCounts();
  ui.repoGrid.replaceChildren();
  ui.repoGrid.removeAttribute('aria-busy');

  const repos = currentTabRepos();
  const account = state.accounts.find((item) => item.id === state.activeId);
  if (featureOn('repoSort')) sortRepos(repos);

  if (!repos.length) {
    if (!account) {
      showReposEmpty('还没有可浏览的项目', '添加账户并选择它，就能看到它的项目。');
      return;
    }
    if (state.repoFilter.trim()) {
      showReposEmpty('没有匹配的项目', `没有找到包含「${state.repoFilter.trim()}」的项目。`);
      return;
    }
    if (state.activeTab === 'starred') {
      showReposEmpty('这个账户还没有收藏任何项目', '在 GitHub 上 Star 的项目会出现在这里。');
    } else if (state.activeTab === 'private') {
      showReposEmpty('这个账户没有私有项目', '私有仓库需要 Token 具备 repo 权限才能读取。');
    } else {
      showReposEmpty('这个账户还没有公开项目', '创建或公开一个项目后，点击“刷新”即可看到。');
    }
    return;
  }

  ui.reposEmpty.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const repo of repos) fragment.append(repoCard(repo));
  ui.repoGrid.replaceChildren(fragment);
}

function statCard(label, value, hint) {
  return el(
    'div',
    { class: 'stat-card' },
    el('span', { class: 'stat-label', text: label }),
    el('span', { class: 'stat-value', text: String(value) }),
    hint ? el('span', { class: 'stat-hint', text: hint }) : null,
  );
}

function renderOverview() {
  const data = state.overview;
  ui.statGrid.replaceChildren();
  ui.overviewExtra.replaceChildren();

  if (!state.accounts.length) {
    ui.overviewCount.textContent = '';
    ui.statGrid.append(
      el('p', { class: 'muted overview-placeholder', text: '添加账户后，这里汇总所有账户的统计。' }),
    );
    return;
  }
  if (!data) {
    ui.overviewCount.textContent = '汇总中…';
    return;
  }

  const totals = data.totals;
  ui.overviewCount.textContent = `${totals.accounts} 个账户`;
  ui.statGrid.append(
    statCard('总仓库', totals.publicCount + totals.privateCount, `公开 ${totals.publicCount} · 私有 ${totals.privateCount}`),
    statCard('总 Star', totals.stars, '所有账户仓库累计'),
    statCard('总 Fork', totals.forks, '所有账户仓库累计'),
  );

  if (data.overlapError) {
    ui.overviewExtra.append(
      el('p', { class: 'muted', text: `跨账户去重统计失败：${data.overlapError}` }),
    );
    return;
  }
  if (data.duplicates?.length) {
    const list = el('div', { class: 'dup-list' });
    for (const dup of data.duplicates.slice(0, 8)) {
      list.append(
        el(
          'div',
          { class: 'dup-row' },
          el('a', {
            class: 'dup-name',
            href: `https://github.com/${dup.fullName}`,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: dup.fullName,
          }),
          el('span', { class: 'dup-count', text: `${dup.logins.length} 个账户重复收藏` }),
        ),
      );
    }
    ui.overviewExtra.append(
      el(
        'div',
        { class: 'overview-block' },
        el('p', { class: 'overview-block-title', text: '跨账户重复收藏（单账户看不到）' }),
        list,
      ),
    );
  }
}

function sparkline(points) {
  const width = 520;
  const height = 120;
  const pad = 10;
  if (!points || points.length < 2) {
    return el('p', { class: 'muted', text: '数据点不足，多打开几次详情后会形成增长曲线。' });
  }
  const values = points.map((p) => p.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((p, index) => {
    const x = pad + index * stepX;
    const y = height - pad - ((p.stars - min) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${height - pad} L${coords[0][0].toFixed(1)} ${height - pad} Z`;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Star 增长曲线，最近值 ${max}`);

  const areaPath = document.createElementNS(ns, 'path');
  areaPath.setAttribute('d', area);
  areaPath.setAttribute('class', 'spark-area');
  const linePath = document.createElementNS(ns, 'path');
  linePath.setAttribute('d', line);
  linePath.setAttribute('class', 'spark-line');
  svg.append(areaPath, linePath);

  const last = coords[coords.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', last[0].toFixed(1));
  dot.setAttribute('cy', last[1].toFixed(1));
  dot.setAttribute('r', '3');
  dot.setAttribute('class', 'spark-dot');
  svg.append(dot);

  const wrap = el('div', { class: 'spark-wrap' });
  wrap.append(svg);
  return wrap;
}

async function openRepoDetail(repo) {
  ui.detailBody.replaceChildren();
  const growth = repo.growth;
  const deltaText = growth
    ? `近 ${relativeDays(growth.days)} ${growth.delta >= 0 ? '+' : ''}${growth.delta} ★（采样 ${growth.samples} 次）`
    : '样本不足，尚未形成增长数据';

  ui.detailBody.append(
    el('div', { class: 'detail-head' },
      el('a', {
        class: 'detail-title',
        href: repo.htmlUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: repo.fullName,
      }),
      el('span', { class: 'detail-badge', text: repo.private ? '私有' : '公开' }),
    ),
    el('p', { class: 'detail-desc', text: repo.description || '暂无项目描述' }),
    el('div', { class: 'detail-stats' },
      el('div', { class: 'detail-stat' }, el('span', { text: '★' }), el('strong', { text: String(repo.stars) }), el('span', { class: 'muted', text: 'Star' })),
      el('div', { class: 'detail-stat' }, el('span', { text: '⑂' }), el('strong', { text: String(repo.forks) }), el('span', { class: 'muted', text: 'Fork' })),
      el('div', { class: 'detail-stat' }, el('span', { text: '⏱' }), el('strong', { text: repo.pushedAt ? formatDate(repo.pushedAt) : '—' }), el('span', { class: 'muted', text: '最近推送' })),
    ),
    el('div', { class: 'detail-section' },
      el('p', { class: 'detail-section-title', text: 'Star 增长（可观察趋势）' }),
      el('p', { class: 'detail-growth', text: deltaText }),
      sparkline(repo.history),
    ),
  );

  if (!repo.private) {
    const coverageBox = el('div', { class: 'detail-section' },
      el('p', { class: 'detail-section-title', text: '哪些账户已收藏此项目' }),
      el('p', { class: 'muted', text: '正在查询…' }),
    );
    ui.detailBody.append(coverageBox);
    ui.detailDialog.showModal();
    try {
      const data = await api(`/api/star-coverage?repo=${encodeURIComponent(repo.fullName)}`);
      coverageBox.replaceChildren(el('p', { class: 'detail-section-title', text: '哪些账户已收藏此项目' }));
      const matrix = el('div', { class: 'coverage-matrix' });
      for (const item of data.coverage) {
        const account = state.accounts.find((a) => a.id === item.id) || { login: item.login, avatarUrl: '' };
        matrix.append(
          el(
            'div',
            { class: `coverage-item ${item.starred ? 'on' : ''}` },
            avatar(account, 'coverage-avatar'),
            el('span', { class: 'coverage-login', text: `@${item.login}` }),
            el('span', { class: 'coverage-mark', text: item.error ? '?' : item.starred ? '✓' : '—' }),
          ),
        );
      }
      coverageBox.append(matrix);
    } catch (error) {
      coverageBox.append(el('p', { class: 'muted', text: `查询失败：${error.message}` }));
    }
    return;
  }

  ui.detailDialog.showModal();
}

// ── 仓库详情增强 ─────────────────────────────────────────
async function openRepoInfo(repo) {
  ui.infoBody.replaceChildren(el('p', { class: 'muted', text: '正在加载仓库详情…' }));
  ui.infoDialog.showModal();
  const account = state.accounts.find((item) => item.id === state.activeId);
  try {
    const data = await api(
      `/api/repo-info?repo=${encodeURIComponent(repo.fullName)}&accountId=${encodeURIComponent(account?.id || '')}`,
    );
    ui.infoBody.replaceChildren(
      el(
        'div',
        { class: 'detail-head' },
        el('a', {
          class: 'detail-title',
          href: data.htmlUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: data.repo,
        }),
        data.license ? el('span', { class: 'detail-badge', text: data.license }) : null,
      ),
      el('p', { class: 'detail-desc', text: data.description || '暂无项目描述' }),
      el(
        'div',
        { class: 'detail-stats' },
        el('div', { class: 'detail-stat' }, el('span', { text: '★' }), el('strong', { text: String(data.stars) }), el('span', { class: 'muted', text: 'Star' })),
        el('div', { class: 'detail-stat' }, el('span', { text: '⑂' }), el('strong', { text: String(data.forks) }), el('span', { class: 'muted', text: 'Fork' })),
        el('div', { class: 'detail-stat' }, el('span', { text: '◇' }), el('strong', { text: String(data.openIssues) }), el('span', { class: 'muted', text: '开放 Issue' })),
      ),
      data.latestRelease ? el('p', { class: 'field-hint', text: `最新版本：${data.latestRelease}` }) : null,
      data.recentIssue ? el('p', { class: 'field-hint', text: `最近 Issue：${data.recentIssue}` }) : null,
      featureOn('mutualStar')
        ? el(
            'div',
            { class: 'repo-actions' },
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '当前账户 Fork 此仓库', onclick: () => forkCurrent(data.repo) }),
          )
        : null,
      el(
        'div',
        { class: 'detail-section' },
        el('p', { class: 'detail-section-title', text: 'README' }),
        data.readme
          ? el('pre', { class: 'readme-box', text: data.readme })
          : el('p', { class: 'muted', text: '没有 README。' }),
      ),
    );
  } catch (error) {
    ui.infoBody.replaceChildren(el('p', { class: 'muted', text: `加载失败：${error.message}` }));
  }
}

async function forkCurrent(repo) {
  const account = state.accounts.find((item) => item.id === state.activeId);
  if (!account) return;
  const [owner, name] = repo.split('/');
  try {
    await api(
      `/api/accounts/${encodeURIComponent(account.id)}/fork/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      { method: 'POST' },
    );
    showToast(`@${account.login} 已 Fork ${repo}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ── 账户健康检查 ─────────────────────────────────────────
async function runHealthCheck() {
  if (!state.accounts.length) {
    showToast('请先添加账户', 'error');
    return;
  }
  ui.infoBody.replaceChildren(el('p', { class: 'muted', text: '正在检查所有账户…' }));
  ui.infoDialog.showModal();
  try {
    const data = await api('/api/accounts/health');
    const rows = data.results.map((item) => {
      const account = state.accounts.find((a) => a.id === item.id) || { login: item.login, avatarUrl: '' };
      return el(
        'div',
        { class: `health-row ${item.ok ? 'ok' : 'fail'}` },
        avatar(account, 'health-avatar'),
        el('span', { class: 'health-login', text: `@${item.login}` }),
        el('span', { class: 'health-msg', text: item.ok ? '正常' : item.message }),
        el('span', { class: 'result-badge ' + (item.ok ? 'ok' : 'fail'), text: item.ok ? '正常' : '异常' }),
      );
    });
    ui.infoBody.replaceChildren(
      el('h2', { class: 'info-title', text: '账户健康检查' }),
      el('p', { class: 'muted', text: `${data.healthy} 个正常，${data.unhealthy} 个异常` }),
      el('div', { class: 'health-list' }, ...rows),
    );
  } catch (error) {
    ui.infoBody.replaceChildren(el('p', { class: 'muted', text: `检查失败：${error.message}` }));
  }
}

// ── 收藏跨账户汇总 ───────────────────────────────────────
async function showStarredOverview() {
  if (!state.accounts.length) {
    showToast('请先添加账户', 'error');
    return;
  }
  ui.infoBody.replaceChildren(el('p', { class: 'muted', text: '正在汇总所有账户的收藏…' }));
  ui.infoDialog.showModal();
  try {
    const data = await api('/api/starred-overview');
    const rows = data.items.map((item) =>
      el(
        'div',
        { class: 'starred-row' },
        el('a', {
          class: 'dup-name',
          href: item.htmlUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: item.fullName,
        }),
        el('span', { class: 'dup-count', text: item.logins.map((l) => '@' + l).join(' ') }),
      ),
    );
    ui.infoBody.replaceChildren(
      el('h2', { class: 'info-title', text: `收藏汇总（${data.total} 个仓库）` }),
      data.errors.length ? el('p', { class: 'field-hint error', text: `未读取：${data.errors.join(', ')}` }) : null,
      el('div', { class: 'dup-list' }, ...rows),
    );
  } catch (error) {
    ui.infoBody.replaceChildren(el('p', { class: 'muted', text: `汇总失败：${error.message}` }));
  }
}

// ── 账户详情 ─────────────────────────────────────────────
async function openAccountDetail(account) {
  ui.infoBody.replaceChildren(el('p', { class: 'muted', text: `正在加载 @${account.login}…` }));
  ui.infoDialog.showModal();
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(account.id)}/detail`);
    const stats = data.stats;
    const top = data.topRepos.map((repo) =>
      el(
        'div',
        { class: 'dup-row' },
        el('a', { class: 'dup-name', href: repo.htmlUrl, target: '_blank', rel: 'noopener noreferrer', text: repo.fullName }),
        el('span', { class: 'dup-count', text: `★ ${repo.stars}` }),
      ),
    );
    ui.infoBody.replaceChildren(
      el('h2', { class: 'info-title', text: `@${account.login}` }),
      el('p', { class: 'muted', text: `关注 ${data.user.followers} · 被关注 ${data.user.following} · 公开仓库 ${data.user.publicRepos}` }),
      el(
        'div',
        { class: 'detail-stats' },
        el('div', { class: 'detail-stat' }, el('strong', { text: String(stats.repoCount) }), el('span', { class: 'muted', text: '仓库总数' })),
        el('div', { class: 'detail-stat' }, el('strong', { text: String(stats.stars) }), el('span', { class: 'muted', text: 'Star 总数' })),
        el('div', { class: 'detail-stat' }, el('strong', { text: String(stats.forks) }), el('span', { class: 'muted', text: 'Fork 总数' })),
      ),
      el('h3', { class: 'info-subtitle', text: 'Star 最多的仓库' }),
      el('div', { class: 'dup-list' }, ...top),
    );
  } catch (error) {
    ui.infoBody.replaceChildren(el('p', { class: 'muted', text: `加载失败：${error.message}` }));
  }
}

// ── 导出 ─────────────────────────────────────────────────
function downloadExport(kind) {
  window.location.href = `/api/export?kind=${encodeURIComponent(kind)}`;
  showToast('已开始下载 CSV', 'success');
}

async function refreshBootstrap() {
  const data = await api('/api/bootstrap');
  state.accounts = data.accounts;
  state.activeId = data.activeId;
  state.config = data.config;
  state.config.customLinks = (data.config.customLinks || []).map((link) => ({ ...link, custom: true }));
  state.session = data.session;
  applyFeatures();
  renderFeatureSettings();
  renderExplore();
  renderAccounts();
  renderActive();
}

async function loadRepos() {
  const requestId = ++reposRequest;
  const account = state.accounts.find((item) => item.id === state.activeId);
  if (!account) {
    state.loadingRepos = false;
    state.publicRepos = [];
    state.privateRepos = [];
    state.starredRepos = [];
    renderRepos();
    return;
  }

  state.loadingRepos = true;
  state.publicRepos = [];
  state.privateRepos = [];
  state.starredRepos = [];
  ui.refreshReposBtn.disabled = true;
  ui.reposSubtitle.textContent = `正在加载 @${account.login} 的项目…`;
  renderSkeletons();
  renderTabCounts();

  try {
    const data = await api(`/api/accounts/${encodeURIComponent(account.id)}/repos`);
    if (requestId !== reposRequest) return;
    state.publicRepos = data.publicRepos || [];
    state.privateRepos = data.privateRepos || [];
    renderRepos();
    ui.reposSubtitle.textContent = `@${account.login}${state.privateRepos.length ? '' : ''} · 公开与私有项目`;
  } catch (error) {
    if (requestId !== reposRequest) return;
    if (error.code === 'TOKEN_INVALID') {
      showReposEmpty('授权已失效', '这个账户的 GitHub 授权已失效，请从左侧移除后重新添加。');
    } else {
      showReposEmpty('项目加载失败', error.message);
    }
    showToast(error.message, 'error');
  } finally {
    if (requestId === reposRequest) {
      state.loadingRepos = false;
      ui.refreshReposBtn.disabled = !state.accounts.some((item) => item.id === state.activeId);
    }
  }
}

async function loadStarred() {
  const account = state.accounts.find((item) => item.id === state.activeId);
  if (!account) return;
  renderSkeletons();
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(account.id)}/starred`);
    state.starredRepos = data.repos || [];
    renderRepos();
  } catch (error) {
    state.starredRepos = [];
    renderRepos();
    showToast(error.message, 'error');
  }
}

async function loadOverview() {
  if (!state.accounts.length) {
    state.overview = null;
    renderOverview();
    return;
  }
  try {
    state.overview = await api('/api/overview');
  } catch {
    state.overview = null;
  }
  renderOverview();
}

async function activateAccount(id) {
  if (state.activating) return;
  state.activating = true;
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(id)}/activate`, {
      method: 'POST',
    });
    state.activeId = data.activeId;
    renderAccounts();
    renderActive();
    await loadRepos();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.activating = false;
  }
}

async function removeAccount(account) {
  if (!window.confirm(`从面板移除 @${account.login}？本地保存的令牌会被删除。`)) return;
  try {
    const data = await api(`/api/accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
    });
    state.accounts = data.accounts;
    state.activeId = data.activeId;
    renderAccounts();
    renderActive();
    await loadRepos();
    await loadOverview();
    showToast(`已移除 @${account.login}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function starResultRow(account, type, message) {
  const row = el('div', { class: 'star-result-row' });
  const main = el(
    'div',
    { class: 'star-result-main' },
    el('span', { class: 'star-result-login', text: `@${account.login}` }),
    el('span', { class: 'star-result-message', text: message, title: message }),
  );
  const badge =
    type === 'ok'
      ? el('span', { class: 'result-badge ok', text: '成功' })
      : type === 'fail'
        ? el('span', { class: 'result-badge fail', text: '失败' })
        : el('span', { class: 'result-badge', text: '…' });
  row.append(avatar(account, 'star-result-avatar'), main, badge);
  return row;
}

// 根据当前选择（全部 / 前 N 个 / 指定账户）解析出要 Star 的账户列表。
function selectedStarAccounts() {
  const mode = ui.starTargetSelect.value;
  if (mode === 'count') {
    const n = Math.max(1, Math.min(state.accounts.length, Number(ui.starCountInput.value) || 1));
    return state.accounts.slice(0, n);
  }
  if (mode === 'pick') {
    const ids = new Set(
      [...ui.starPickList.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value),
    );
    return state.accounts.filter((account) => ids.has(account.id));
  }
  return state.accounts;
}

function renderStarPickList() {
  ui.starPickList.replaceChildren();
  for (const account of state.accounts) {
    const id = `pick-${account.id}`;
    const box = el('input', { type: 'checkbox', id, value: account.id });
    box.checked = true;
    ui.starPickList.append(
      el(
        'label',
        { class: 'star-pick-item', for: id },
        box,
        el('span', { class: 'star-pick-login', text: `@${account.login}` }),
      ),
    );
  }
}

function updateStarTargetUI() {
  const mode = ui.starTargetSelect.value;
  ui.starCountRow.hidden = mode !== 'count';
  ui.starPickList.hidden = mode !== 'pick';
  if (mode === 'count') {
    ui.starCountInput.max = String(state.accounts.length || 1);
    if (Number(ui.starCountInput.value) > state.accounts.length) {
      ui.starCountInput.value = String(state.accounts.length || 1);
    }
    ui.starCountHint.textContent = `共 ${state.accounts.length} 个账户`;
  }
  updateStarTargetLabel();
}

function updateStarTargetLabel() {
  const targets = selectedStarAccounts();
  const total = state.accounts.length;
  const text =
    targets.length === 0
      ? '请选择账户'
      : targets.length === total
        ? `${targets.length} 个账户（全部）`
        : `${targets.length} / ${total} 个账户`;
  ui.starAllBtn.textContent = `Star · ${text}`;
  ui.starAllBtn.disabled = state.starBusy || targets.length === 0;
}

function renderPendingStarResults(repo, targets) {
  ui.starResults.replaceChildren();
  ui.starResults.classList.add('has-results');
  ui.starResults.append(
    el('div', { class: 'star-summary' }, el('span', {
      text: `正在把 ${repo} Star 到 ${targets.length} 个账户…`,
    })),
  );
  for (const account of targets) {
    ui.starResults.append(starResultRow(account, 'pending', '等待中'));
  }
}

function renderStarResults(payload) {
  ui.starResults.replaceChildren();
  ui.starResults.classList.add('has-results');
  const summary = el('div', { class: 'star-summary' });
  summary.append(
    el('span', {
      text: `${payload.repo} · ${payload.succeeded}/${payload.results.length} 成功`,
    }),
  );
  ui.starResults.append(summary);
  for (const result of payload.results) {
    const account = state.accounts.find((item) => item.id === result.id) || {
      login: result.login,
      avatarUrl: '',
    };
    ui.starResults.append(
      starResultRow(
        account,
        result.ok ? 'ok' : 'fail',
        result.ok ? 'Star 成功' : result.message || 'Star 失败',
      ),
    );
  }
}

async function starAll(input) {
  const repo = String(input || '').trim();
  if (!repo) {
    ui.repoInput.focus();
    showToast('请输入项目链接或 owner/repo', 'error');
    return;
  }
  if (!state.accounts.length) {
    showToast('请先添加至少一个 GitHub 账户', 'error');
    openAddDialog();
    return;
  }
  if (state.starBusy) return;

  const targets = selectedStarAccounts();
  if (!targets.length) {
    showToast('请先选择要 Star 的账户', 'error');
    return;
  }

  const mode = ui.starTargetSelect.value;
  const body = { repo };
  if (mode === 'count') body.count = targets.length;
  if (mode === 'pick') body.accountIds = targets.map((account) => account.id);

  state.starBusy = true;
  ui.repoInput.value = repo;
  const restore = setBusy(ui.starAllBtn, 'Star 中…');
  const repoButtons = [...document.querySelectorAll('.repo-star-btn')];
  repoButtons.forEach((button) => {
    button.disabled = true;
  });
  renderPendingStarResults(repo, targets);

  try {
    const data = await api('/api/star-all', { method: 'POST', body });
    ui.repoInput.value = data.repo;
    renderStarResults(data);
    if (data.failed) {
      showToast(`${data.succeeded} 个成功，${data.failed} 个失败`, 'error');
    } else {
      showToast(`已 Star 到 ${data.succeeded} 个账户`, 'success');
    }
  } catch (error) {
    ui.starResults.replaceChildren();
    ui.starResults.classList.remove('has-results');
    showToast(error.message, 'error');
  } finally {
    state.starBusy = false;
    restore();
    repoButtons.forEach((button) => {
      button.disabled = false;
    });
    renderActive();
    updateStarTargetLabel();
    if (state.activeTab === 'starred') loadStarred();
  }
}

async function unstarRepo(repo, button) {
  const account = state.accounts.find((item) => item.id === state.activeId);
  if (!account) return;
  if (!window.confirm(`让 @${account.login} 取消 Star ${repo.fullName}？`)) return;
  const restore = setBusy(button, '取消中…');
  try {
    const [owner, name] = repo.fullName.split('/');
    await api(
      `/api/accounts/${encodeURIComponent(account.id)}/starred/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    state.starredRepos = state.starredRepos.filter((item) => item.fullName !== repo.fullName);
    renderRepos();
    showToast(`@${account.login} 已取消 Star ${repo.fullName}`, 'success');
  } catch (error) {
    restore();
    showToast(error.message, 'error');
  }
}

function setConfigError(message) {
  ui.configSource.className = 'field-hint error';
  ui.configSource.textContent = message;
}

function showConfigView() {
  ui.configView.hidden = false;
  ui.authView.hidden = true;
  ui.clientIdInput.value = state.config.clientId || '';
  ui.configSource.className = 'field-hint';
  ui.configSource.textContent =
    state.config.source === 'env'
      ? '当前使用环境变量 GITHUB_CLIENT_ID；保存后会覆盖它。'
      : state.config.source === 'saved'
        ? 'Client ID 已保存。'
        : '尚未配置 Client ID。';
  requestAnimationFrame(() => ui.clientIdInput.focus());
}

function resetAuthPanel() {
  ui.authStart.hidden = false;
  ui.authWait.hidden = true;
  ui.authStatus.className = 'auth-status';
  ui.authStatus.textContent = '';
  ui.deviceCode.textContent = '----';
  ui.startAuthBtn.disabled = false;
  ui.startAuthBtn.textContent = '使用 GitHub 授权';
}

function resetTokenPanel() {
  ui.tokenInput.value = '';
  ui.tokenResults.replaceChildren();
  ui.tokenResults.classList.remove('has-results');
  ui.tokenLoginBtn.disabled = false;
  ui.tokenLoginBtn.textContent = '登录 / 批量登录';
}

function selectLoginTab(tab) {
  state.auth.tab = tab;
  const oauth = tab === 'oauth';
  ui.oauthTab.classList.toggle('is-active', oauth);
  ui.tokenTab.classList.toggle('is-active', !oauth);
  ui.oauthTab.setAttribute('aria-selected', oauth ? 'true' : 'false');
  ui.tokenTab.setAttribute('aria-selected', oauth ? 'false' : 'true');
  ui.oauthPanel.hidden = !oauth;
  ui.tokenPanel.hidden = oauth;
  if (!oauth) {
    requestAnimationFrame(() => ui.tokenInput.focus());
    return;
  }
  if (state.config.clientId) {
    ui.configView.hidden = true;
    ui.authView.hidden = false;
  } else {
    showConfigView();
  }
}

function openAddDialog() {
  stopPolling();
  state.auth.mode = 'add';
  state.auth.flowId = null;
  resetAuthPanel();
  resetTokenPanel();
  ui.loginTabs.hidden = false;
  ui.dialogTitle.textContent = '添加 GitHub 账户';
  ui.dialogLead.textContent =
    '使用 OAuth 授权，或粘贴一个/多个 Token 登录。面板不会接触你的密码或浏览器 Cookie。';
  const tab = state.config.clientId ? 'oauth' : 'token';
  selectLoginTab(tab);
  if (!ui.dialog.open) ui.dialog.showModal();
  requestAnimationFrame(() => {
    if (tab === 'oauth') {
      (state.config.clientId ? ui.startAuthBtn : ui.clientIdInput).focus();
    } else {
      ui.tokenInput.focus();
    }
  });
}

function openSettingsDialog() {
  stopPolling();
  state.auth.mode = 'config';
  state.auth.flowId = null;
  resetAuthPanel();
  resetTokenPanel();
  ui.loginTabs.hidden = true;
  ui.oauthPanel.hidden = false;
  ui.tokenPanel.hidden = true;
  ui.dialogTitle.textContent = 'OAuth App 设置';
  ui.dialogLead.textContent =
    '修改 Client ID 后，新添加的账户会使用新的 OAuth App；已登录账户不受影响。';
  showConfigView();
  if (!ui.dialog.open) ui.dialog.showModal();
}

async function saveConfig() {
  const clientId = ui.clientIdInput.value.trim();
  if (!clientId) {
    setConfigError('请填写 Client ID');
    return;
  }
  const restore = setBusy(ui.saveConfigBtn, '保存中…');
  try {
    const data = await api('/api/config', { method: 'POST', body: { clientId } });
    state.config = { ...state.config, ...data.config };
    if (state.auth.mode === 'config') {
      ui.dialog.close();
      showToast('OAuth 设置已保存', 'success');
    } else {
      ui.dialogTitle.textContent = '添加 GitHub 账户';
      ui.dialogLead.textContent =
        '使用 OAuth 授权，或粘贴一个/多个 Token 登录。面板不会接触你的密码或浏览器 Cookie。';
      selectLoginTab('oauth');
      resetAuthPanel();
      requestAnimationFrame(() => ui.startAuthBtn.focus());
      showToast('Client ID 已保存，可以开始授权', 'success');
    }
  } catch (error) {
    setConfigError(error.message);
  } finally {
    restore();
  }
}

function renderTokenResults(data) {
  ui.tokenResults.replaceChildren();
  ui.tokenResults.classList.add('has-results');
  ui.tokenResults.append(
    el(
      'div',
      { class: 'star-summary' },
      el('span', {
        text: `${data.added} 个新增，${data.updated} 个更新，${data.failed} 个失败`,
      }),
    ),
  );
  for (const result of data.results) {
    const label = result.login ? `@${result.login}` : `Token #${result.index}`;
    const badge = result.ok
      ? el('span', { class: 'result-badge ok', text: '成功' })
      : el('span', { class: 'result-badge fail', text: '失败' });
    ui.tokenResults.append(
      el(
        'div',
        { class: 'token-result-row' },
        el('span', { class: 'token-result-label', text: label }),
        el('span', {
          class: 'token-result-message',
          text: result.message,
          title: result.message,
        }),
        badge,
      ),
    );
  }
}

async function tokenLogin() {
  const tokens = ui.tokenInput.value.trim();
  if (!tokens) {
    ui.tokenInput.focus();
    showToast('请粘贴至少一个 GitHub Token', 'error');
    return;
  }
  stopPolling();
  state.auth.flowId = null;
  resetAuthPanel();
  const restore = setBusy(ui.tokenLoginBtn, '登录中…');
  ui.tokenResults.replaceChildren();
  ui.tokenResults.classList.remove('has-results');
  try {
    const data = await api('/api/auth/token', { method: 'POST', body: { tokens } });
    ui.tokenInput.value = '';
    renderTokenResults(data);
    await refreshBootstrap();
    if (data.added + data.updated > 0) {
      await loadRepos();
      await loadOverview();
      showToast(`已登录 ${data.added + data.updated} 个账户`, 'success');
      if (data.results.length === 1 && data.results[0].ok) {
        setTimeout(() => {
          if (ui.dialog.open) ui.dialog.close();
        }, 700);
      }
    } else {
      showToast('没有账户登录成功', 'error');
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    restore();
  }
}

function schedulePoll(seconds) {
  if (state.auth.timer) clearTimeout(state.auth.timer);
  state.auth.timer = setTimeout(pollDevice, Math.max(1, Number(seconds) || 5) * 1000);
}

function stopPolling() {
  if (state.auth.timer) clearTimeout(state.auth.timer);
  state.auth.timer = null;
  state.auth.polling = false;
}

async function startAuth() {
  if (!state.config.clientId) {
    showConfigView();
    setConfigError('请先填写 Client ID');
    return;
  }
  stopPolling();
  const restore = setBusy(ui.startAuthBtn, '正在生成授权码…');
  ui.authStatus.className = 'auth-status';
  ui.authStatus.textContent = '';
  try {
    const data = await api('/api/auth/device/start', { method: 'POST' });
    state.auth.flowId = data.flowId;
    state.auth.polling = true;
    ui.deviceCode.textContent = data.userCode;
    ui.verifyLink.href = data.verificationUri || 'https://github.com/login/device';
    ui.authStart.hidden = true;
    ui.authWait.hidden = false;
    ui.authStatus.textContent = '等待你在 GitHub 完成授权…';
    schedulePoll(data.interval);
  } catch (error) {
    restore();
    if (error.code === 'CLIENT_ID_REQUIRED') {
      showConfigView();
      setConfigError('请先填写 Client ID');
    } else {
      showToast(error.message, 'error');
    }
    return;
  }
  restore();
}

async function pollDevice() {
  state.auth.timer = null;
  if (!state.auth.polling || !state.auth.flowId || !ui.dialog.open) return;

  try {
    const data = await api('/api/auth/device/poll', {
      method: 'POST',
      body: { flowId: state.auth.flowId },
    });
    if (data.status === 'complete') {
      stopPolling();
      state.auth.flowId = null;
      ui.authStatus.className = 'auth-status success';
      ui.authStatus.textContent = `授权成功：@${data.account.login}`;
      try {
        await refreshBootstrap();
        await loadRepos();
        await loadOverview();
      } catch (error) {
        showToast(`账户已添加，但页面刷新失败：${error.message}`, 'error');
      }
      showToast(`已添加 @${data.account.login}`, 'success');
      setTimeout(() => {
        if (ui.dialog.open) ui.dialog.close();
      }, 650);
      return;
    }
    if (data.status === 'pending') {
      ui.authStatus.className = 'auth-status';
      ui.authStatus.textContent = '等待你在 GitHub 完成授权…';
      schedulePoll(data.retryAfter || 5);
      return;
    }
    stopPolling();
    ui.authStatus.className = 'auth-status error';
    ui.authStatus.textContent = data.message || '授权未完成，请重新开始。';
  } catch (error) {
    if (error.code === 'FLOW_NOT_FOUND') {
      stopPolling();
      ui.authStatus.className = 'auth-status error';
      ui.authStatus.textContent = error.message;
      return;
    }
    ui.authStatus.className = 'auth-status error';
    ui.authStatus.textContent = '网络异常，5 秒后重试…';
    schedulePoll(5);
  }
}

async function copyCode() {
  const code = ui.deviceCode.textContent.trim();
  if (!code || code === '----') return;
  try {
    await navigator.clipboard.writeText(code);
    showToast('授权码已复制', 'success');
  } catch {
    showToast('复制失败，请手动选择授权码', 'error');
  }
}

function bind() {
  if (ui.homeUrl) ui.homeUrl.textContent = window.location.origin;
  ui.addAccountBtn.addEventListener('click', openAddDialog);
  ui.settingsBtn.addEventListener('click', openSettingsDialog);
  if (ui.exploreAddForm) ui.exploreAddForm.addEventListener('submit', addExploreLink);
  ui.emptyAddBtn.addEventListener('click', openAddDialog);
  ui.refreshReposBtn.addEventListener('click', () => {
    loadRepos();
    loadOverview();
  });
  ui.starForm.addEventListener('submit', (event) => {
    event.preventDefault();
    starAll(ui.repoInput.value);
  });
  ui.starTargetSelect.addEventListener('change', updateStarTargetUI);
  ui.starCountInput.addEventListener('input', updateStarTargetLabel);
  ui.starPickList.addEventListener('change', updateStarTargetLabel);
  ui.accountSearch.addEventListener('input', debounce(() => {
    state.accountFilter = ui.accountSearch.value;
    renderAccounts();
  }));
  ui.repoSearchInput.addEventListener('input', debounce(() => {
    state.repoFilter = ui.repoSearchInput.value;
    renderRepos();
  }));
  ui.repoSortSelect.addEventListener('change', () => {
    state.repoSort = ui.repoSortSelect.value;
    renderRepos();
  });
  ui.healthBtn.addEventListener('click', runHealthCheck);
  ui.starredOverviewBtn.addEventListener('click', showStarredOverview);
  ui.exportBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    ui.exportMenu.hidden = !ui.exportMenu.hidden;
  });
  ui.exportMenu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-export]');
    if (button) {
      ui.exportMenu.hidden = true;
      downloadExport(button.dataset.export);
    }
  });
  document.addEventListener('click', (event) => {
    if (!ui.exportMenu.hidden && !event.target.closest('#export-wrap')) ui.exportMenu.hidden = true;
  });
  ui.repoTabs.addEventListener('click', (event) => {
    const button = event.target.closest('.repo-tab');
    if (button) switchTab(button.dataset.tab);
  });
  ui.saveConfigBtn.addEventListener('click', saveConfig);
  ui.startAuthBtn.addEventListener('click', startAuth);
  ui.restartAuthBtn.addEventListener('click', startAuth);
  ui.copyCodeBtn.addEventListener('click', copyCode);
  ui.tokenLoginBtn.addEventListener('click', tokenLogin);
  ui.oauthTab.addEventListener('click', () => selectLoginTab('oauth'));
  ui.tokenTab.addEventListener('click', () => selectLoginTab('token'));
  ui.loginTabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const tab = state.auth.tab === 'oauth' ? 'token' : 'oauth';
    selectLoginTab(tab);
    (tab === 'oauth' ? ui.oauthTab : ui.tokenTab).focus();
  });
  ui.dialog.addEventListener('close', () => {
    stopPolling();
    state.auth.flowId = null;
    ui.tokenInput.value = '';
    ui.tokenResults.replaceChildren();
    ui.tokenResults.classList.remove('has-results');
  });
  ui.deviceCode.addEventListener('click', () => {
    const range = document.createRange();
    range.selectNodeContents(ui.deviceCode);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function init() {
  bind();
  ui.starAllBtn.disabled = true;
  try {
    await refreshBootstrap();
    if (state.activeId) await loadRepos();
    else renderRepos();
    loadOverview();
  } catch (error) {
    showToast(`面板加载失败：${error.message}`, 'error');
    showReposEmpty('无法加载面板', error.message);
  }
}

init();
