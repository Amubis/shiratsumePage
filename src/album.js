import { cloverSVG, seededRandom } from './scene.js';

/** Public content records; a future CMS can replace this array through setMedia(). */
export const ALBUM_MEDIA = Object.freeze(Array.from({ length: 4 }, (_, index) => Object.freeze({
  id: `still-${String(index + 1).padStart(2, '0')}`,
  url: `./assets/frame-${String(index + 1).padStart(2, '0')}.jpg`,
  thumbnail: `./assets/frame-${String(index + 1).padStart(2, '0')}.jpg`,
  alt: Object.freeze({ zh: `しらつめ测试视频的第 ${index + 1} 个摘帧`, ja: `しらつめのテスト映像から切り出した${index + 1}枚目の画像` }),
  modelIds: Object.freeze(['shiratsume']), takenAt: null, sourceKind: 'video-still',
})));

export const ALBUM_VIEWS = Object.freeze(['day', 'month', 'year']);
const PAGE_SIZES = Object.freeze({ day: 6, month: 9, year: 12 });
const COPY = Object.freeze({
  zh: { title: '日常影像册', unknown: '日期待补充', current: '当前模型', all: '全部照片', toggle: '切换当前模型与全部照片', day: '按日', month: '按月', year: '按年', view: '切换照片分组密度', previous: '上一页', next: '下一页', empty: '这里还没有照片。', source: '测试视频摘帧 · 拍摄日期待补充', mixedSource: '按已有拍摄信息整理', open: '查看照片', close: '关闭照片播放器', photoPrevious: '上一张照片', photoNext: '下一张照片', player: '照片播放器', defaultAlt: '相册照片', undated: '未标注拍摄日期', photoCount: '张影像', noPhoto: '没有可显示的照片' },
  ja: { title: '日々のアルバム', unknown: '日付未設定', current: 'このモデル', all: 'すべての写真', toggle: 'このモデルとすべての写真を切り替え', day: '日ごと', month: '月ごと', year: '年ごと', view: '写真のグループと密度を切り替え', previous: '前のページ', next: '次のページ', empty: '写真はまだありません。', source: 'テスト映像のひとこま · 撮影日を準備中', mixedSource: '登録された撮影情報で整理', open: '写真を見る', close: '写真ビューアを閉じる', photoPrevious: '前の写真', photoNext: '次の写真', player: '写真ビューア', defaultAlt: 'アルバムの写真', undated: '撮影日未設定', photoCount: '枚', noPhoto: '表示する写真がありません' },
});

function dateKey(value, view) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) return 'undated';
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return 'undated';
  return match[0].slice(0, view === 'year' ? 4 : view === 'month' ? 7 : 10);
}

function safeURL(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return ['http:', 'https:'].includes(new URL(value, 'https://album.invalid/').protocol) ? value.trim() : null; } catch { return null; }
}

export function normalizeAlbumMedia(media) {
  const ids = new Set();
  return (Array.isArray(media) ? media : []).flatMap((item) => {
    const url = safeURL(item?.url);
    if (!item?.id || ids.has(String(item.id)) || !url) return [];
    ids.add(String(item.id));
    return [{ ...item, id: String(item.id), url, thumbnail: safeURL(item.thumbnail) || url,
      modelIds: Array.isArray(item.modelIds) ? item.modelIds.filter((id) => typeof id === 'string') : [],
      takenAt: dateKey(item.takenAt, 'day') === 'undated' ? null : item.takenAt,
      sourceKind: typeof item.sourceKind === 'string' ? item.sourceKind : 'photo' }];
  });
}

export function buildAlbumPages(media, { modelId = 'shiratsume', filter = 'model', view = 'day' } = {}) {
  const mode = ALBUM_VIEWS.includes(view) ? view : 'day';
  const filtered = normalizeAlbumMedia(media).filter((item) => filter === 'all' || item.modelIds.includes(modelId));
  const groups = new Map();
  for (const item of filtered) {
    const key = dateKey(item.takenAt, mode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort((a, b) => a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a));
  return keys.flatMap((key) => {
    const items = groups.get(key).sort((a, b) => String(b.takenAt || '').localeCompare(String(a.takenAt || '')));
    const pages = [];
    for (let offset = 0; offset < items.length; offset += PAGE_SIZES[mode]) pages.push({ key, items: items.slice(offset, offset + PAGE_SIZES[mode]), groupPage: pages.length });
    return pages;
  });
}

/** Stable, bounded jitter: language changes never reshuffle the same photo. */
export function albumPhotoPose(id, slot = 0) {
  const random = seededRandom(`album:${id}:${slot}`);
  return { x: (random() * 2 - 1) * 7, y: (random() * 2 - 1) * 7,
    rotation: (random() * 2 - 1) * 5.5, depth: 2 + Math.floor(random() * 8) };
}

export function createAlbum({ container, language = 'zh', modelId = 'shiratsume', media = ALBUM_MEDIA, reducedMotion = () => false, onReady = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An album container is required.');
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const bindings = [];
  let cardBindings = [];
  let locale = language === 'ja' ? 'ja' : 'zh';
  let records = normalizeAlbumMedia(media);
  let filter = 'model';
  let view = 'day';
  let pageIndex = 0;
  let pages = [];
  let enabled = true;
  let destroyed = false;
  let inspection = null;
  let pointerFrame = null;
  let pendingPointer = null;
  let keyboardFocus = false;
  let cards = [];
  let wrappers = [];
  let playerItems = [];
  let playerIndex = 0;
  let returnFocus = null;

  const element = (tag, className = '') => { const node = doc.createElement(tag); node.className = className; return node; };
  const bind = (node, name, handler, list = bindings) => {
    node.addEventListener(name, handler);
    list.push(() => node.removeEventListener(name, handler));
  };
  const button = (className) => { const node = element('button', className); node.type = 'button'; return node; };
  const text = () => COPY[locale];
  const altFor = (item) => typeof item.alt === 'string' ? item.alt : item.alt?.[locale] || item.alt?.zh || text().defaultAlt;
  const groupLabel = (key) => key === 'undated' ? text().unknown : key.replaceAll('-', ' / ');
  const root = element('div', 'album-desk');
  const back = element('div', 'album-paper layer-back');
  const middle = element('div', 'album-paper layer-middle');
  const front = element('div', 'album-paper layer-front');
  back.setAttribute('aria-hidden', 'true'); middle.setAttribute('aria-hidden', 'true');
  const cover = element('div', 'album-cover');
  const coverIcon = element('span', 'album-cover-clover'); coverIcon.innerHTML = cloverSVG({ className: 'clover-svg' });
  const title = element('h2', 'album-title'); const coverSmall = element('small', 'album-cover-note'); coverSmall.textContent = 'LITTLE CLOVER MEMORIES';
  cover.append(coverIcon, title, coverSmall);
  const filterButton = button('album-filter-tab');
  const heading = element('div', 'album-group-heading');
  const groupTitle = element('p', 'album-group-title'); const groupCount = element('span', 'album-group-count');
  heading.append(groupTitle, groupCount);
  const grid = element('div', 'album-photo-grid');
  const empty = element('p', 'album-empty');
  const footer = element('div', 'album-paper-footer');
  const pageStatus = element('span', 'album-page-status');
  pageStatus.setAttribute('role', 'status'); pageStatus.setAttribute('aria-live', 'polite'); pageStatus.setAttribute('aria-atomic', 'true');
  const sourceNote = element('span', 'album-source-note'); footer.append(pageStatus, sourceNote);
  front.append(heading, grid, empty, footer);
  const tabs = element('div', 'album-tabs'); const previous = button('album-tab album-previous'); const mode = button('album-tab album-view'); const next = button('album-tab album-next');
  tabs.append(previous, mode, next); root.append(back, middle, front, cover, filterButton, tabs); container.replaceChildren(root); container.classList.add('album-showcase');

  const dialog = element('dialog', 'album-player');
  const playerClose = button('album-player-close'); const playerPrevious = button('album-player-previous'); const playerNext = button('album-player-next');
  const playerFigure = element('figure', 'album-player-figure'); const playerImage = element('img', 'album-player-image'); const playerCaption = element('figcaption', 'album-player-caption');
  playerFigure.append(playerImage, playerCaption); dialog.append(playerClose, playerPrevious, playerFigure, playerNext); doc.body.append(dialog);

  function clearInspection() {
    if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = null; pendingPointer = null; inspection = null;
    cards.forEach((card, index) => {
      card.style.setProperty('--inspect-rx', '0deg'); card.style.setProperty('--inspect-ry', '0deg'); card.style.setProperty('--inspect-lift', '0px'); card.style.setProperty('--neighbor-shift', '0px');
      wrappers[index].classList.remove('is-inspected');
    });
  }
  function inspect(index, event) {
    if (!enabled || reducedMotion() || event?.pointerType === 'touch') return;
    inspection = index;
    cards.forEach((card, cardIndex) => {
      wrappers[cardIndex].classList.toggle('is-inspected', cardIndex === index);
      card.style.setProperty('--inspect-lift', cardIndex === index ? '-12px' : '0px');
      card.style.setProperty('--neighbor-shift', Math.abs(cardIndex - index) === 1 ? `${Math.sign(cardIndex - index) * 8}px` : '0px');
      if (cardIndex !== index) { card.style.setProperty('--inspect-rx', '0deg'); card.style.setProperty('--inspect-ry', '0deg'); }
    });
    if (!event || !Number.isFinite(event.clientX)) return;
    const bounds = wrappers[index].getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / (bounds.width || 1) * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / (bounds.height || 1) * 2 - 1));
    cards[index].style.setProperty('--inspect-rx', `${(-y * 5).toFixed(2)}deg`);
    cards[index].style.setProperty('--inspect-ry', `${(x * 5).toFixed(2)}deg`);
  }
  function paintPointer() {
    pointerFrame = null;
    const pending = pendingPointer; pendingPointer = null;
    if (pending && !destroyed) inspect(pending.index, pending.event);
  }
  function queueInspection(index, event) {
    if (event.pointerType === 'touch' || !enabled || reducedMotion()) return;
    pendingPointer = { index, event: { clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType } };
    if (pointerFrame === null) {
      if (win.requestAnimationFrame) pointerFrame = win.requestAnimationFrame(paintPointer);
      else paintPointer();
    }
  }
  function renderPlayer() {
    const item = playerItems[playerIndex]; if (!item) return;
    playerImage.src = item.url; playerImage.alt = altFor(item);
    const date = dateKey(item.takenAt, 'day');
    playerCaption.textContent = `${String(playerIndex + 1).padStart(2, '0')} / ${String(playerItems.length).padStart(2, '0')} · ${date === 'undated' ? text().undated : groupLabel(date)}`;
    playerPrevious.disabled = playerNext.disabled = playerItems.length < 2;
  }
  function restorePlayerFocus() {
    if (!doc.querySelector?.('dialog[open]')) doc.body.classList.remove('modal-open');
    if (returnFocus?.isConnected !== false) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
  function closePlayer() {
    if (dialog.open) dialog.close();
    else restorePlayerFocus();
  }
  function openPlayer(idOrIndex = 0) {
    if (!enabled || destroyed) return false;
    const current = pages[pageIndex]; if (!current?.items.length) return false;
    playerItems = pages.flatMap((page) => page.items);
    const id = typeof idOrIndex === 'number' ? current.items[idOrIndex]?.id : idOrIndex;
    playerIndex = playerItems.findIndex((item) => item.id === id); if (playerIndex < 0) return false;
    const existing = doc.querySelector?.('dialog[open]'); if (existing && existing !== dialog) return false;
    clearInspection(); returnFocus = doc.activeElement; renderPlayer();
    if (!dialog.open) dialog.showModal(); doc.body.classList.add('modal-open'); playerClose.focus?.(); return true;
  }
  function changePlayer(direction) {
    if (!playerItems.length) return;
    playerIndex = ((playerIndex + direction) % playerItems.length + playerItems.length) % playerItems.length;
    renderPlayer();
  }
  function render() {
    if (destroyed) return;
    clearInspection(); cardBindings.splice(0).forEach((dispose) => dispose());
    pages = buildAlbumPages(records, { modelId, filter, view }); pageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const page = pages[pageIndex]; const total = pages.reduce((sum, page) => sum + page.items.length, 0);
    root.classList.remove('view-day', 'view-month', 'view-year'); root.classList.add(`view-${view}`);
    title.textContent = text().title; filterButton.textContent = filter === 'all' ? text().all : text().current;
    filterButton.setAttribute('aria-label', `${text().toggle} · ${filterButton.textContent}`); filterButton.setAttribute('aria-pressed', String(filter === 'all'));
    previous.textContent = `↑ ${text().previous}`; next.textContent = `${text().next} ↓`; mode.textContent = `◌ ${text()[view]}`;
    previous.setAttribute('aria-label', text().previous); next.setAttribute('aria-label', text().next); mode.setAttribute('aria-label', `${text().view} · ${text()[view]}`);
    previous.disabled = !enabled || pageIndex <= 0; next.disabled = !enabled || pageIndex >= pages.length - 1; mode.disabled = filterButton.disabled = !enabled;
    groupTitle.textContent = page ? groupLabel(page.key) : text().noPhoto; groupCount.textContent = `${total} ${text().photoCount}`;
    pageStatus.textContent = pages.length ? `${String(pageIndex + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}` : '00 / 00';
    sourceNote.textContent = records.every((item) => item.sourceKind === 'video-still' && !item.takenAt) ? text().source : text().mixedSource;
    empty.hidden = Boolean(page?.items.length); empty.textContent = text().empty;
    wrappers = []; cards = []; const nodes = [];
    for (const [index, item] of (page?.items || []).entries()) {
      const wrapper = element('div', 'album-photo'); const card = button('album-photo-card');
      const pose = albumPhotoPose(item.id, index);
      for (const [key, value] of Object.entries({ '--jitter-x': `${pose.x}%`, '--jitter-y': `${pose.y}%`, '--jitter-rotation': `${pose.rotation}deg` })) card.style.setProperty(key, value);
      wrapper.style.setProperty('--photo-depth', String(pose.depth)); wrapper.style.setProperty('--photo-order', String(index));
      card.setAttribute('aria-label', `${text().open} · ${altFor(item)}`); card.disabled = !enabled;
      const image = element('img', 'album-photo-image'); image.src = item.thumbnail; image.alt = altFor(item); image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
      const label = element('span', 'album-photo-label'); label.textContent = item.sourceKind === 'video-still' ? `VIDEO STILL ${String(records.findIndex((record) => record.id === item.id) + 1).padStart(2, '0')}` : dateKey(item.takenAt, 'day') === 'undated' ? text().undated : groupLabel(dateKey(item.takenAt, 'day'));
      card.append(image, label); wrapper.append(card); nodes.push(wrapper); wrappers.push(wrapper); cards.push(card);
      bind(card, 'pointerenter', (event) => inspect(index, event), cardBindings);
      bind(card, 'pointermove', (event) => queueInspection(index, event), cardBindings);
      bind(card, 'pointerleave', clearInspection, cardBindings);
      bind(card, 'focus', () => { if (keyboardFocus) inspect(index); }, cardBindings);
      bind(card, 'blur', clearInspection, cardBindings);
      bind(card, 'click', () => openPlayer(item.id), cardBindings);
    }
    grid.replaceChildren(...nodes);
    dialog.setAttribute('aria-label', text().player); playerClose.textContent = '×'; playerClose.setAttribute('aria-label', text().close);
    playerPrevious.textContent = '←'; playerNext.textContent = '→'; playerPrevious.setAttribute('aria-label', text().photoPrevious); playerNext.setAttribute('aria-label', text().photoNext);
    if (dialog.open) renderPlayer();
    onReady({ pageIndex, pages: pages.length, count: total, view, filter });
  }
  function goToPage(index) {
    if (!enabled || destroyed || !Number.isInteger(index) || index < 0 || index >= pages.length) return false;
    pageIndex = index; render(); return true;
  }
  bind(previous, 'click', () => goToPage(pageIndex - 1)); bind(next, 'click', () => goToPage(pageIndex + 1));
  bind(mode, 'click', () => { view = ALBUM_VIEWS[(ALBUM_VIEWS.indexOf(view) + 1) % ALBUM_VIEWS.length]; pageIndex = 0; render(); });
  bind(filterButton, 'click', () => { filter = filter === 'model' ? 'all' : 'model'; pageIndex = 0; render(); });
  bind(grid, 'pointerdown', () => { keyboardFocus = false; });
  bind(doc, 'keydown', (event) => { if (event.key === 'Tab') keyboardFocus = true; });
  bind(doc, 'visibilitychange', clearInspection);
  bind(playerClose, 'click', closePlayer); bind(playerPrevious, 'click', () => changePlayer(-1)); bind(playerNext, 'click', () => changePlayer(1));
  bind(dialog, 'close', restorePlayerFocus); bind(dialog, 'click', (event) => { if (event.target === dialog) closePlayer(); });
  bind(dialog, 'keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); changePlayer(event.key === 'ArrowLeft' ? -1 : 1);
  });
  render();
  return {
    get state() { return { pageIndex, pageCount: pages.length, view, filter, count: pages.reduce((sum, page) => sum + page.items.length, 0), playerOpen: Boolean(dialog.open) }; },
    setLanguage(nextLanguage) { if (destroyed) return; locale = nextLanguage === 'ja' ? 'ja' : 'zh'; render(); },
    setModel(nextModel) { if (destroyed) return; closePlayer(); modelId = String(nextModel); pageIndex = 0; render(); },
    setEnabled(value) { if (destroyed) return; enabled = Boolean(value); if (!enabled) closePlayer(); render(); },
    setMedia(nextMedia) { if (destroyed) return; closePlayer(); records = normalizeAlbumMedia(nextMedia); pageIndex = 0; render(); },
    setView(nextView) { if (destroyed || !ALBUM_VIEWS.includes(nextView)) return false; view = nextView; pageIndex = 0; render(); return true; },
    setFilter(nextFilter) { if (destroyed || !['model', 'all'].includes(nextFilter)) return false; filter = nextFilter; pageIndex = 0; render(); return true; },
    goToPage, openPlayer, closePlayer,
    destroy() { if (destroyed) return; closePlayer(); clearInspection(); destroyed = true; bindings.splice(0).forEach((dispose) => dispose()); cardBindings.splice(0).forEach((dispose) => dispose()); dialog.remove(); container.replaceChildren(); container.classList.remove('album-showcase'); },
  };
}
