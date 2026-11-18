const COPY = {
  zh: { loading: '正在读取网站内容', waiting: '请稍候。', error: '暂时无法读取网站内容', unavailable: '暂时无法连接内容服务，请稍后重试。', retry: '重试' },
  ja: { loading: 'サイトの内容を読み込んでいます', waiting: '少々お待ちください。', error: '内容を読み込めませんでした', unavailable: '現在コンテンツに接続できません。しばらくしてから再試行してください。', retry: '再試行' },
};

/** Public content stays behind a clear loading/error surface until verified. */
export function createContentAvailability({ root, getLanguage = () => 'zh', onRetry = () => {} } = {}) {
  const panel = root?.querySelector?.('#content-availability');
  if (!panel) throw new TypeError('A content availability panel is required.');
  const title = panel.querySelector('.content-availability-title');
  const description = panel.querySelector('.content-availability-description');
  const retry = panel.querySelector('.content-availability-retry');
  const locked = new Map();
  let state = 'loading', destroyed = false;
  function lock() {
    for (const node of root.querySelectorAll('main, .topbar, .side-nav, .language-dock, .video-controls, .model-control, .owner-tools-bar, .skip-link')) {
      if (!locked.has(node)) locked.set(node, node.inert);
      node.inert = true;
    }
  }
  function unlock() { for (const [node, previous] of locked) node.inert = previous; locked.clear(); }
  function render() {
    const copy = COPY[getLanguage() === 'ja' ? 'ja' : 'zh'];
    title.textContent = state === 'error' ? copy.error : copy.loading;
    description.textContent = state === 'error' ? copy.unavailable : copy.waiting;
    retry.textContent = copy.retry; retry.hidden = state !== 'error'; retry.disabled = state !== 'error';
    panel.setAttribute('aria-busy', String(state === 'loading'));
    panel.setAttribute('aria-hidden', String(state === 'ready'));
  }
  function set(next, connection) {
    if (destroyed) return;
    state = next; root.dataset.contentConnection = connection;
    root.classList.toggle('content-is-unavailable', state !== 'ready');
    if (state === 'ready') { unlock(); if (root.ownerDocument?.activeElement === retry) retry.blur?.(); }
    else lock();
    render();
    if (state === 'error') retry.focus?.({ preventScroll: true });
  }
  const requestRetry = () => { if (state === 'error' && !destroyed) onRetry(); };
  const keepKeysInStatus = event => { if (state !== 'ready') event.stopPropagation(); };
  const keepScrollInStatus = event => { if (state !== 'ready') { event.preventDefault(); event.stopPropagation(); } };
  retry.addEventListener('click', requestRetry);
  root.ownerDocument?.addEventListener?.('keydown', keepKeysInStatus, true);
  root.ownerDocument?.addEventListener?.('wheel', keepScrollInStatus, { capture: true, passive: false });
  root.ownerDocument?.addEventListener?.('touchmove', keepScrollInStatus, { capture: true, passive: false });
  set('loading', 'loading');
  return {
    loading() { set('loading', 'loading'); },
    error() { set('error', 'offline'); },
    ready(connection = 'online') { set('ready', connection); },
    setLanguage: render,
    get state() { return state; },
    destroy() { if (destroyed) return; destroyed = true; unlock(); root.classList.remove('content-is-unavailable'); retry.removeEventListener('click', requestRetry); root.ownerDocument?.removeEventListener?.('keydown', keepKeysInStatus, true); root.ownerDocument?.removeEventListener?.('wheel', keepScrollInStatus, true); root.ownerDocument?.removeEventListener?.('touchmove', keepScrollInStatus, true); },
  };
}
