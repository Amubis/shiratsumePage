import { cloverSVG, seededRandom } from './scene.js';
import { createAlbumPlayerMotion } from './album-player-motion.js';
import { createAlbumPageMotion } from './album-page-motion.js';
import { createAnonymousComments } from './comments.js';
import { planAlbumLayout } from './album-layout.js';
import { albumNeighborOffsets } from './album-neighbors.js';
import { paginateAlbumGroup } from './album-pagination.js';
import { createPhotoLikeButton } from './photo-likes.js';

/** Public content records; a future CMS can replace this array through setMedia(). */
export const ALBUM_MEDIA = Object.freeze(Array.from({ length: 4 }, (_, index) => Object.freeze({
  id: `still-${String(index + 1).padStart(2, '0')}`,
  url: `./assets/frame-${String(index + 1).padStart(2, '0')}.jpg`,
  thumbnail: `./assets/frame-${String(index + 1).padStart(2, '0')}.jpg`,
  alt: Object.freeze({ zh: `しらつめ测试视频的第 ${index + 1} 个摘帧`, ja: `しらつめのテスト映像から切り出した${index + 1}枚目の画像` }),
  modelIds: Object.freeze(['shiratsume']), takenAt: null, sourceKind: 'video-still',
})));

export const ALBUM_VIEWS = Object.freeze(['month', 'year']);
export const ALBUM_ORDERS = Object.freeze(['desc', 'asc']);
const PAGE_SIZES = Object.freeze({ month: 8, year: 12 });
const popularitySnapshot = service => Object.fromEntries(Object.entries(service?.snapshot?.() || {}).filter(([, count]) => Number.isFinite(count) && count > 0));
export const ALBUM_COPY = Object.freeze({
  zh: { title: '超级相册', coverNote: 'LITTLE CLOVER MEMORIES', stillLabel: 'VIDEO STILL', unknown: '日期待补充', current: '当前模型', all: '全部照片', toggle: '切换当前模型与全部照片', month: '按月', year: '按年', largerView: '更大视图', smallerView: '更小视图', view: '切换照片分组密度', previous: '上一页', next: '下一页', empty: '这里还没有照片。', source: '测试视频摘帧 · 拍摄日期待补充', mixedSource: '按已有拍摄信息整理', open: '查看照片', close: '关闭照片播放器', photoPrevious: '上一张照片', photoNext: '下一张照片', player: '照片播放器', defaultAlt: '相册照片', undated: '未标注拍摄日期', photoCount: '张影像', noPhoto: '没有可显示的照片', pagePosition: '相册页位置', dateOrder: '拍摄时间排序', newestFirst: '由新到旧', oldestFirst: '由旧到新' },
  ja: { title: '超アルバム', coverNote: 'LITTLE CLOVER MEMORIES', stillLabel: 'VIDEO STILL', unknown: '日付未設定', current: 'このモデル', all: 'すべての写真', toggle: 'このモデルとすべての写真を切り替え', month: '月ごと', year: '年ごと', largerView: '大きく表示', smallerView: '小さく表示', view: '写真のグループと密度を切り替え', previous: '前のページ', next: '次のページ', empty: '写真はまだありません。', source: 'テスト映像のひとこま · 撮影日を準備中', mixedSource: '登録された撮影情報で整理', open: '写真を見る', close: '写真ビューアを閉じる', photoPrevious: '前の写真', photoNext: '次の写真', player: '写真ビューア', defaultAlt: 'アルバムの写真', undated: '撮影日未設定', photoCount: '枚', noPhoto: '表示する写真がありません', pagePosition: 'アルバムのページ位置', dateOrder: '撮影日時の並び順', newestFirst: '新しい順', oldestFirst: '古い順' },
});
const albumCopyDictionary = input => Object.fromEntries(['zh', 'ja'].map(locale => [locale,
  Object.fromEntries(Object.entries(ALBUM_COPY[locale]).map(([key, fallback]) => [key, typeof input?.[locale]?.[key] === 'string' ? input[locale][key] : fallback])),
]));

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

export function buildAlbumPages(media, { modelId = 'shiratsume', filter = 'all', view = 'month', order = 'desc', layout = null, likes = {} } = {}) {
  const mode = ALBUM_VIEWS.includes(view) ? view : 'month';
  const direction = order === 'asc' ? 1 : -1;
  const filtered = normalizeAlbumMedia(media).filter((item) => filter === 'all' || item.modelIds.includes(modelId));
  const groups = new Map();
  for (const item of filtered) {
    // A page belongs to one month or year; short groups never share a sheet.
    const key = dateKey(item.takenAt, mode);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const keys = [...groups.keys()].sort((a, b) => a === 'undated' ? 1 : b === 'undated' ? -1 : direction * a.localeCompare(b));
  return keys.flatMap((key) => {
    const items = groups.get(key).sort((a, b) => direction * String(a.takenAt || '').localeCompare(String(b.takenAt || '')));
    if (layout?.width > 0 && layout?.height > 0) return paginateAlbumGroup(items, { ...layout, view: mode, likes }).map((items, groupPage) => ({ key, items, groupPage }));
    const pages = [];
    for (let offset = 0; offset < items.length; offset += PAGE_SIZES[mode]) pages.push({ key, items: items.slice(offset, offset + PAGE_SIZES[mode]), groupPage: pages.length });
    return pages;
  });
}

/** Stable, bounded jitter: language changes never reshuffle the same photo. */
export function albumPhotoPose(id, slot = 0, count = 8) {
  const random = seededRandom(`album:${id}:${slot}`);
  const jitter=count<5?3:count<8?5:7;
  return { x: (random() * 2 - 1) * jitter, y: (random() * 2 - 1) * jitter,
    rotation: (random() * 2 - 1) * 5.5, depth: 2 + Math.floor(random() * 8), scale: .9 + random() * .2 };
}

export function createAlbum({ container, language = 'zh', modelId = 'shiratsume', media = ALBUM_MEDIA, copy, commentsService = null, commentsCopy, likesService = null, reducedMotion = () => false, onReady = () => {} } = {}) {
  if (!container?.ownerDocument) throw new TypeError('An album container is required.');
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const bindings = [];
  let cardBindings = [];
  let locale = language === 'ja' ? 'ja' : 'zh';
  let dictionary = albumCopyDictionary(copy);
  let records = normalizeAlbumMedia(media);
  let filter = 'all';
  let view = 'month';
  let order = 'desc';
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
  let photoAspects = [];
  let layoutFrame = null;
  let layoutObserver = null;
  let neighborLayout = [];
  let packingGeometry = null;
  let packingLikes = popularitySnapshot(likesService);
  let playerLike = null;
  const knownAspects = new Map();
  let pageCache = null;

  const element = (tag, className = '') => { const node = doc.createElement(tag); node.className = className; return node; };
  const bind = (node, name, handler, list = bindings) => {
    node.addEventListener(name, handler);
    list.push(() => node.removeEventListener(name, handler));
  };
  const button = (className) => { const node = element('button', className); node.type = 'button'; return node; };
  const text = () => dictionary[locale];
  const altFor = (item) => typeof item.alt === 'string' ? item.alt : item.alt?.[locale] || item.alt?.zh || text().defaultAlt;
  const groupLabel = (key) => key === 'undated' ? text().unknown : key.replaceAll('-', ' / ');
  const root = element('div', 'album-desk');
  const back = element('div', 'album-paper layer-back');
  const middle = element('div', 'album-paper layer-middle');
  const front = element('div', 'album-paper layer-front');
  back.setAttribute('aria-hidden', 'true'); middle.setAttribute('aria-hidden', 'true');
  const cover = element('div', 'album-cover');
  cover.setAttribute('aria-hidden', 'true');
  const coverIcon = element('span', 'album-cover-clover'); coverIcon.innerHTML = cloverSVG({ className: 'clover-svg' });
  const title = element('h2', 'album-title'); const coverSmall = element('small', 'album-cover-note'); coverSmall.textContent = text().coverNote;
  cover.append(coverIcon);
  const albumHeading = element('div', 'album-heading');
  const titleClover = element('span', 'album-title-clover');
  titleClover.setAttribute('aria-hidden', 'true');
  titleClover.innerHTML = cloverSVG({ className: 'clover-svg', variant: 'large' });
  albumHeading.append(titleClover, title, coverSmall);
  const filterButton = button('album-cover-tab album-filter-tab');
  const groupCount = element('span', 'album-group-count');
  const orderButton = button('album-cover-tab album-sort-tab album-sort');
  const grid = element('div', 'album-photo-grid');
  const empty = element('p', 'album-empty');
  const footer = element('div', 'album-paper-footer');
  const pageStatus = element('span', 'album-page-status');
  pageStatus.setAttribute('role', 'status'); pageStatus.setAttribute('aria-live', 'polite'); pageStatus.setAttribute('aria-atomic', 'true');
  const pageMeta = element('div', 'album-page-meta');
  const pagePosition = element('input', 'album-page-position');
  pagePosition.type = 'range'; pagePosition.min = '1'; pagePosition.max = '1'; pagePosition.step = '1';
  const pageRail = element('div', 'album-page-rail');
  const pageTrack = element('span', 'album-page-track'); const pageThumb = element('span', 'album-page-thumb');
  pageTrack.setAttribute('aria-hidden', 'true'); pageThumb.setAttribute('aria-hidden', 'true');
  pageRail.append(pageTrack, pageThumb, pagePosition);
  pageMeta.append(pageStatus, pageRail, groupCount);
  const sourceNote = element('span', 'album-source-note'); footer.append(sourceNote);
  albumHeading.append(pageMeta);
  const dateMark = element('div', 'album-date-mark');
  const dateYear = element('span', 'album-date-year'); const dateMonth = element('span', 'album-date-month');
  dateMark.append(dateYear, dateMonth);
  const composition = element('div', 'album-composition'); composition.setAttribute('aria-hidden', 'true');
  for (const classes of ['album-rule album-art-line rule-bottom line-bottom', 'album-angle album-art-line', 'album-dot-accent album-art-dots dot-top dots-top', 'album-dot-accent album-art-dots dot-bottom dots-bottom']) composition.append(element('span', classes));
  front.append(composition, albumHeading, grid, empty, dateMark, footer);
  const tabs = element('div', 'album-tabs'); const previous = button('album-tab album-previous'); const mode = button('album-tab album-view'); const next = button('album-tab album-next');
  const coverControls = element('div', 'album-cover-controls'); coverControls.append(filterButton, orderButton);
  const coverUnit=element('div','album-cover-unit');coverUnit.append(cover,coverControls);
  tabs.append(previous, mode, next); root.append(back, middle, front, coverUnit, tabs); container.replaceChildren(root); container.classList.add('album-showcase');

  const dialog = element('dialog', 'album-player');
  const playerClose = button('album-player-close'); const playerPrevious = button('album-player-previous'); const playerNext = button('album-player-next');
  const playerContent = element('div', 'album-player-content'); const playerStage = element('div', 'album-player-stage'); const playerComments = element('aside', 'album-player-comments');
  const playerFigure = element('figure', 'album-player-figure'); const playerImage = element('img', 'album-player-image'); const playerDescription = element('p', 'album-player-description'); const playerCaption = element('figcaption', 'album-player-caption');
  // Localized labels declare their text boundary where they are created, so
  // new controls do not depend on a distant list of CSS class selectors.
  for (const node of [title, coverSmall, filterButton, orderButton, groupCount, empty, sourceNote, previous, mode, next, playerDescription, playerCaption]) node.setAttribute('data-language-text', '');
  playerFigure.append(playerImage, playerDescription, playerCaption); playerStage.append(playerFigure); playerContent.append(playerStage, playerComments); dialog.append(playerClose, playerContent, playerPrevious, playerNext); doc.body.append(dialog);
  const commentPanel = createAnonymousComments({ container: playerComments, service: commentsService, targetType: 'photo', language: locale, copy: commentsCopy, active: false });
  const playerMotion = createAlbumPlayerMotion({dialog,reducedMotion,onRequestClose:()=>closePlayer()});
  const pageMotion = createAlbumPageMotion({root,reducedMotion,isActive(){
    const section=root.closest?.('.page-section');
    return Boolean(section?.classList.contains('is-current') && !['album-entry-prepared','album-entry-playing','album-exit-playing','album-boundary-seeking'].some(name=>section.classList.contains(name)));
  }});

  function measurePackingSpace() {
    // client sizes exclude the entrance's transient transforms. A narrow page
    // may grow, so use its viewport budget rather than its own packed height.
    const width = grid.clientWidth, height = grid.clientHeight;
    if (!(width > 0 && height > 0) || !Number.isFinite(win.innerWidth)) return packingGeometry;
    const mobile = win.innerWidth <= 760;
    const style = cards[0] ? win.getComputedStyle?.(cards[0]) || {} : {};
    const edge = (padding, border, fallback) => {
      const value = parseFloat(style[padding]), line = parseFloat(style[border]);
      return Number.isFinite(value) ? value + (Number.isFinite(line) ? line : 0) : fallback;
    };
    return { width: Math.round(width), height: mobile ? Math.max(180, win.innerHeight * .6 || 400) : Math.round(height), mobile,
      paper: { left: edge('paddingLeft', 'borderLeftWidth', mobile ? 6 : 9), right: edge('paddingRight', 'borderRightWidth', mobile ? 6 : 9), top: edge('paddingTop', 'borderTopWidth', mobile ? 6 : 9), bottom: edge('paddingBottom', 'borderBottomWidth', mobile ? 21 : 26) } };
  }
  function currentPages() {
    const key = JSON.stringify([modelId, filter, view, order, packingGeometry, packingLikes]);
    if (pageCache?.records === records && pageCache.key === key) return pageCache.pages;
    const media = records.map(item => knownAspects.has(item.id) ? { ...item, width: knownAspects.get(item.id), height: 1 } : item);
    const result = buildAlbumPages(media, { modelId, filter, view, order, layout: packingGeometry, likes: packingLikes });
    pageCache = { records, key, pages: result };
    return result;
  }
  function syncPacking(reason, preserveAnchor = false) {
    const anchor = preserveAnchor ? pages[pageIndex]?.items[0]?.id : null;
    packingGeometry = measurePackingSpace();
    // Counts update immediately, but a click never moves its own photograph.
    // A new composition adopts popularity at an explicit navigation boundary.
    if (['initial', 'media', 'view', 'filter', 'order', 'model', 'likes', 'reflow'].includes(reason)) packingLikes = popularitySnapshot(likesService);
    const result = currentPages();
    if (anchor) {
      const nextIndex = result.findIndex(page => page.items.some(item => item.id === anchor));
      if (nextIndex >= 0) pageIndex = nextIndex;
    }
    return result;
  }

  function updatePageRail(index, count) {
    const progress = count > 1 ? Math.max(0, Math.min(1, index / (count - 1))) : 0;
    const position = `${progress * 100}%`;
    pagePosition.style.setProperty('--album-page-position', position);
    pageRail.style.setProperty('--album-page-position', position);
    pageRail.style.setProperty('--album-page-offset', `${progress * 26}px`);
    pageRail.classList.toggle('is-disabled', !enabled || count <= 1);
  }
  function layoutPhotos() {
    if (destroyed || !wrappers.length) return;
    const bounds = grid.getBoundingClientRect?.();
    const width = grid.clientWidth || bounds?.width || 0;
    const height = grid.clientHeight || bounds?.height || 0;
    if (!(width > 0 && height > 0)) return;
    const mobile = Number.isFinite(win.innerWidth) && win.innerWidth <= 760;
    const style = win.getComputedStyle?.(cards[0]) || {};
    const edge = (padding, border, fallback) => {
      const value = parseFloat(style[padding]), line = parseFloat(style[border]);
      return Number.isFinite(value) ? value + (Number.isFinite(line) ? line : 0) : fallback;
    };
    const paper = { left: edge('paddingLeft', 'borderLeftWidth', mobile ? 6 : 9), right: edge('paddingRight', 'borderRightWidth', mobile ? 6 : 9), top: edge('paddingTop', 'borderTopWidth', mobile ? 6 : 9), bottom: edge('paddingBottom', 'borderBottomWidth', mobile ? 21 : 26) };
    const plan = planAlbumLayout({ aspects: photoAspects, width, height, mobile, view, paper, likes: (pages[pageIndex]?.items || []).map(item => packingLikes[item.id] || 0) });
    // Jitter belongs to the resting composition; inspection never feeds its
    // own lift, push or tilt back into the geometry of the next pointer frame.
    neighborLayout = plan.items.map(item => ({ ...item,
      x: item.x + item.width * (parseFloat(cards[item.index]?.style.getPropertyValue('--jitter-x')) || 0) / 100,
      y: item.y + item.height * (parseFloat(cards[item.index]?.style.getPropertyValue('--jitter-y')) || 0) / 100,
    }));
    grid.classList.add('is-packed');
    grid.setAttribute('data-layout-rows', String(plan.rowCount));
    grid.setAttribute('data-layout-kind', plan.kind || 'rows');
    if (mobile) grid.style.setProperty('--album-packed-height', `${plan.height}px`);
    for (const item of plan.items) {
      const wrapper = wrappers[item.index];
      if (!wrapper) continue;
      const pose = albumPhotoPose(pages[pageIndex].items[item.index].id, item.index, wrappers.length);
      wrapper.style.setProperty('--photo-depth', String((item.z || 0) + pose.depth));
      wrapper.classList.toggle('is-featured', Boolean(item.featured));
      for (const [name, value] of Object.entries({ left: item.x, top: item.y, width: item.width, height: item.height })) wrapper.style.setProperty(name, `${value.toFixed(3)}px`);
    }
    if (grid.classList.contains('is-layout-initializing')) {
      // New absolute wrappers inherit 100% of an already packed grid. Commit
      // their real rectangles before enabling resize transitions or entrance
      // would visibly shrink each print from the size of the entire sheet.
      grid.getBoundingClientRect?.();
      grid.classList.remove('is-layout-initializing');
    }
    if (inspection !== null) updateInspectionNeighbors(inspection);
  }
  function queueLayout() {
    if (destroyed || layoutFrame !== null) return;
    if (typeof win.requestAnimationFrame === 'function') {
      layoutFrame = win.requestAnimationFrame(() => {
        layoutFrame = null;
        if (pageMotion.busy) { layoutPhotos(); return; }
        const before = pages.map(page => page.items.map(item => item.id).join(',')).join('|');
        const next = syncPacking('reflow', true);
        if (before !== next.map(page => page.items.map(item => item.id).join(',')).join('|')) render('reflow');
        else { pages = next; layoutPhotos(); }
      });
    } else layoutPhotos();
  }
  function clearInspection() {
    if (pointerFrame !== null) win.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = null; pendingPointer = null; inspection = null;
    cards.forEach((card, index) => {
      card.style.setProperty('--inspect-rx', '0deg'); card.style.setProperty('--inspect-ry', '0deg'); card.style.setProperty('--inspect-lift', '0px'); card.style.setProperty('--neighbor-x', '0px'); card.style.setProperty('--neighbor-y', '0px');
      wrappers[index].classList.remove('is-inspected');
    });
  }
  function updateInspectionNeighbors(index) {
    const offsets = albumNeighborOffsets(neighborLayout, index);
    cards.forEach((card, cardIndex) => {
      wrappers[cardIndex].classList.toggle('is-inspected', cardIndex === index);
      card.style.setProperty('--inspect-lift', cardIndex === index ? '-12px' : '0px');
      card.style.setProperty('--neighbor-x', `${(offsets[cardIndex]?.x || 0).toFixed(3)}px`);
      card.style.setProperty('--neighbor-y', `${(offsets[cardIndex]?.y || 0).toFixed(3)}px`);
      if (cardIndex !== index) { card.style.setProperty('--inspect-rx', '0deg'); card.style.setProperty('--inspect-ry', '0deg'); }
    });
  }
  function inspect(index, event) {
    if (!enabled || reducedMotion() || event?.pointerType === 'touch') return;
    if (inspection !== index) updateInspectionNeighbors(index);
    inspection = index;
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
  function setPlayerAspect(width, height) {
    const ratio = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width / height : 16 / 9;
    dialog.style.setProperty('--player-image-aspect', ratio.toFixed(6));
    dialog.setAttribute('data-photo-orientation', ratio < .9 ? 'portrait' : ratio > 1.1 ? 'landscape' : 'square');
  }
  bind(playerImage, 'load', () => {
    if (playerImage.naturalWidth > 0 && playerImage.naturalHeight > 0) setPlayerAspect(playerImage.naturalWidth, playerImage.naturalHeight);
  });
  function renderPlayer() {
    const item = playerItems[playerIndex]; if (!item) return;
    dialog.setAttribute('data-photo-id', item.id);
    setPlayerAspect(item.width, item.height);
    playerImage.src = item.url; playerImage.alt = altFor(item);
    const date = dateKey(item.takenAt, 'day');
    const caption = typeof item.caption === 'string' ? item.caption : item.caption?.[locale] || item.caption?.zh || '';
    playerDescription.textContent = caption; playerDescription.hidden = !caption;
    if (likesService) {
      if (!playerLike) {
        playerLike = createPhotoLikeButton({ document: doc, service: likesService, photoId: item.id, language: locale, reducedMotion });
        playerLike.element.classList.add('album-player-like'); playerFigure.append(playerLike.element);
      } else { playerLike.setPhotoId(item.id); playerLike.setLanguage(locale); }
    }
    playerCaption.textContent = [`${String(playerIndex + 1).padStart(2, '0')} / ${String(playerItems.length).padStart(2, '0')}`, date === 'undated' ? text().undated : groupLabel(date), item.worldName].filter(Boolean).join(' · ');
    playerPrevious.disabled = playerNext.disabled = playerItems.length < 2;
    commentPanel.setTarget('photo', item.id);
  }
  function restorePlayerFocus() {
    commentPanel.setActive(false);
    if (!doc.querySelector?.('dialog[open]')) doc.body.classList.remove('modal-open');
    if (returnFocus?.isConnected !== false) returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
  function closePlayer(immediate = false) {
    commentPanel.setActive(false);
    const hide = () => { if(dialog.open)dialog.close();else restorePlayerFocus(); };
    if (immediate === true) { playerMotion.cancel({hide}); return; }
    if (playerMotion.phase === 'close') return;
    if (!dialog.open) { restorePlayerFocus(); return; }
    const selectedId = playerItems[playerIndex]?.id;
    const targetPage = pages.findIndex(page => page.items.some(item => item.id === selectedId));
    let target = null;
    if (targetPage >= 0) {
      // Update the covered paper without replaying its page or chapter entrance.
      // This also settles an interrupted page motion before measuring the landing.
      pageMotion.cancel({commitPending:false});
      if (targetPage !== pageIndex) { pageIndex = targetPage; render('player-return'); }
      else clearInspection();
      const slot = pages[pageIndex]?.items.findIndex(item => item.id === selectedId) ?? -1;
      const card = cards[slot];
      if (card && card.isConnected !== false) {
        target = card;
        if (card.children[0]) card.children[0].loading = 'eager';
        try { card.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'}); }
        catch { card.scrollIntoView?.({block:'nearest',inline:'nearest'}); }
        returnFocus = card;
      }
    }
    playerPrevious.disabled = playerNext.disabled = true;
    void playerMotion.close({target,image:playerImage,hide});
  }
  function openPlayer(idOrIndex = 0) {
    if (!enabled || destroyed) return false;
    const current = pages[pageIndex]; if (!current?.items.length) return false;
    playerItems = pages.flatMap((page) => page.items);
    const id = typeof idOrIndex === 'number' ? current.items[idOrIndex]?.id : idOrIndex;
    playerIndex = playerItems.findIndex((item) => item.id === id); if (playerIndex < 0) return false;
    const existing = doc.querySelector?.('dialog[open]'); if (existing && existing !== dialog) return false;
    clearInspection(); returnFocus = doc.activeElement; renderPlayer(); commentPanel.setActive(true);
    const card = cards[current.items.findIndex(item=>item.id===id)];
    void playerMotion.open({source:card,image:card?.children[0],show(){
      if (!dialog.open) dialog.showModal();
      doc.body.classList.add('modal-open');playerClose.focus?.();
    }});
    return true;
  }
  function changePlayer(direction) {
    if (!playerItems.length || playerMotion.phase === 'close') return;
    playerIndex = ((playerIndex + direction) % playerItems.length + playerItems.length) % playerItems.length;
    renderPlayer();
  }
  const dateDisplayParts = page => page && page.key !== 'undated'
    ? { year: page.key.slice(0, 4), month: view === 'month' ? page.key.slice(5, 7) : '' }
    : { year: 'None', month: '' };
  function transitionPage(reason) {
    const nextPages = syncPacking(reason);
    const nextPage = nextPages[Math.max(0, Math.min(pageIndex, nextPages.length - 1))];
    // A pending request already owns pageIndex. Compare the target against the
    // date actually rendered, including after a rapid cancelled page request.
    const nextDate = dateDisplayParts(nextPage);
    const dateParts = { year: dateYear.textContent !== nextDate.year, month: (dateMonth.hidden ? '' : dateMonth.textContent) !== nextDate.month };
    void pageMotion.run(() => render(reason), { animateDate: dateParts.year || dateParts.month, dateParts });
  }
  function render(reason = 'initial') {
    if (destroyed) return;
    clearInspection(); cardBindings.splice(0).forEach((dispose) => dispose());
    pages = syncPacking(reason); pageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
    const page = pages[pageIndex]; const total = pages.reduce((sum, page) => sum + page.items.length, 0);
    root.setAttribute('data-photo-count', String(page?.items.length || 0));
    root.style.setProperty('--album-photo-count', String(page?.items.length || 0));
    root.classList.remove('view-month', 'view-year'); root.classList.add(`view-${view}`);
    title.textContent = text().title; coverSmall.textContent = dictionary[locale === 'zh' ? 'ja' : 'zh'].title; filterButton.textContent = filter === 'all' ? text().all : text().current;
    coverSmall.setAttribute('lang', locale === 'zh' ? 'ja' : 'zh-CN');
    filterButton.setAttribute('aria-label', `${text().toggle} · ${filterButton.textContent}`); filterButton.setAttribute('aria-pressed', String(filter === 'all'));
    previous.textContent = `↑ ${text().previous}`; next.textContent = `${text().next} ↓`; mode.textContent = view === 'month' ? text().smallerView : text().largerView;
    previous.setAttribute('aria-label', text().previous); next.setAttribute('aria-label', text().next); mode.setAttribute('aria-label', `${text().view} · ${mode.textContent}`);
    previous.disabled = !enabled || pageIndex <= 0; next.disabled = !enabled || pageIndex >= pages.length - 1; mode.disabled = filterButton.disabled = orderButton.disabled = !enabled;
    orderButton.textContent = order === 'desc' ? text().newestFirst : text().oldestFirst;
    orderButton.setAttribute('aria-label', `${text().dateOrder} · ${orderButton.textContent}`);
    orderButton.setAttribute('aria-pressed', String(order === 'asc'));
    groupCount.textContent = `${total} ${text().photoCount}`;
    pageStatus.textContent = pages.length ? `${String(pageIndex + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}` : '00 / 00';
    pagePosition.max = String(Math.max(1, pages.length)); pagePosition.value = String(pageIndex + 1);
    pagePosition.disabled = !enabled || pages.length <= 1;
    pagePosition.setAttribute('aria-label', text().pagePosition); pagePosition.setAttribute('aria-valuetext', pageStatus.textContent);
    updatePageRail(pageIndex, pages.length);
    const dated = page && page.key !== 'undated';
    dateMark.classList.toggle('is-undated', !dated);
    dateMark.setAttribute('aria-label', page ? groupLabel(page.key) : text().noPhoto);
    const date = dateDisplayParts(page);
    dateYear.textContent = date.year;
    dateMonth.textContent = date.month;
    dateMonth.hidden = !dateMonth.textContent;
    sourceNote.textContent = records.every((item) => item.sourceKind === 'video-still' && !item.takenAt) ? text().source : text().mixedSource;
    empty.hidden = Boolean(page?.items.length); empty.textContent = text().empty;
    wrappers = []; cards = []; photoAspects = []; neighborLayout = []; const nodes = [];
    for (const [index, item] of (page?.items || []).entries()) {
      const wrapper = element('div', 'album-photo'); const card = button('album-photo-card');
      const pose = albumPhotoPose(item.id,index,page.items.length);
      for (const [key, value] of Object.entries({ '--jitter-x': `${pose.x}%`, '--jitter-y': `${pose.y}%`, '--jitter-rotation': `${pose.rotation}deg`, '--photo-scale': pose.scale.toFixed(5) })) card.style.setProperty(key, value);
      wrapper.style.setProperty('--photo-depth', String(pose.depth)); wrapper.style.setProperty('--photo-order', String(index));
      wrapper.style.setProperty('--photo-scale', pose.scale.toFixed(5));
      card.setAttribute('aria-label', `${text().open} · ${altFor(item)}`); card.disabled = !enabled;
      const image = element('img', 'album-photo-image'); image.src = item.thumbnail; image.alt = altFor(item); image.loading = 'lazy'; image.decoding = 'async'; image.draggable = false;
      function setAspect(width, height, relayout = false) {
        const ratio = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? width / height : 16 / 9;
        for (const node of [wrapper, card]) { node.style.setProperty('--photo-aspect', ratio.toFixed(6)); node.style.setProperty('--photo-ratio', ratio.toFixed(6)); }
        wrapper.setAttribute('data-orientation', ratio < .9 ? 'portrait' : ratio > 1.1 ? 'landscape' : 'square');
        const changed = photoAspects[index] !== ratio; photoAspects[index] = ratio;
        if (relayout && changed) { knownAspects.set(item.id, ratio); pageCache = null; queueLayout(); }
      }
      const known = knownAspects.get(item.id);
      setAspect(known || item.width, known ? 1 : item.height);
      bind(image, 'load', () => setAspect(image.naturalWidth, image.naturalHeight, true), cardBindings);
      if (image.complete && image.naturalWidth) setAspect(image.naturalWidth, image.naturalHeight);
      const label = element('span', 'album-photo-label'); label.textContent = `PHOTO ${String(pageIndex + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
      card.append(image, label); wrapper.append(card); nodes.push(wrapper); wrappers.push(wrapper); cards.push(card);
      wrapper.setAttribute('data-photo-id', item.id);
      if (likesService) {
        const like = createPhotoLikeButton({ document: doc, service: likesService, photoId: item.id, language: locale, reducedMotion });
        wrapper.append(like.element); cardBindings.push(() => like.destroy());
        bind(like.element, 'pointerenter', event => inspect(index, event), cardBindings);
        bind(wrapper, 'pointerleave', clearInspection, cardBindings);
        bind(like.element, 'focus', () => { if (keyboardFocus) inspect(index); }, cardBindings);
        bind(like.element, 'blur', clearInspection, cardBindings);
      }
      bind(card, 'pointerenter', (event) => inspect(index, event), cardBindings);
      bind(card, 'pointermove', (event) => queueInspection(index, event), cardBindings);
      bind(card, 'pointerleave', clearInspection, cardBindings);
      bind(card, 'focus', () => { if (keyboardFocus) inspect(index); }, cardBindings);
      bind(card, 'blur', clearInspection, cardBindings);
      bind(card, 'click', () => openPlayer(item.id), cardBindings);
    }
    grid.classList.add('is-layout-initializing');
    grid.replaceChildren(...nodes);
    layoutPhotos();
    dialog.setAttribute('aria-label', text().player); playerClose.textContent = '×'; playerClose.setAttribute('aria-label', text().close);
    playerPrevious.textContent = '←'; playerNext.textContent = '→'; playerPrevious.setAttribute('aria-label', text().photoPrevious); playerNext.setAttribute('aria-label', text().photoNext);
    if (dialog.open) renderPlayer();
    onReady({ pageIndex, pages: pages.length, count: total, view, filter, order, reason, pageKey: page?.key || null });
  }
  function goToPage(index) {
    if (!enabled || destroyed || !Number.isInteger(index) || index < 0 || index >= pages.length) return false;
    if(index===pageIndex)return true;
    const anchor = pages[index]?.items[0]?.id;
    const nextLikes = popularitySnapshot(likesService);
    if (JSON.stringify(nextLikes) !== JSON.stringify(packingLikes)) {
      // Adopt new popularity only as the visitor leaves. Follow the intended
      // photograph if its chronological page boundary has changed.
      packingLikes = nextLikes; pages = currentPages();
      const nextIndex = pages.findIndex(page => page.items.some(item => item.id === anchor));
      index = nextIndex >= 0 ? nextIndex : Math.min(index, pages.length - 1);
    }
    pageIndex = index; updatePageRail(index, pages.length); transitionPage('page'); return true;
  }
  function redraw(reason){pageMotion.cancel({commitPending:false});render(reason);}
  function setOrder(nextOrder) {
    if (destroyed || !ALBUM_ORDERS.includes(nextOrder)) return false;
    order = nextOrder; pageIndex = 0; transitionPage('order'); return true;
  }
  bind(previous, 'click', () => goToPage(pageIndex - 1)); bind(next, 'click', () => goToPage(pageIndex + 1));
  bind(mode, 'click', () => { view = ALBUM_VIEWS[(ALBUM_VIEWS.indexOf(view) + 1) % ALBUM_VIEWS.length]; pageIndex = 0; transitionPage('view'); });
  bind(filterButton, 'click', () => { filter = filter === 'model' ? 'all' : 'model'; pageIndex = 0; transitionPage('filter'); });
  bind(orderButton, 'click', () => { if (enabled) setOrder(order === 'desc' ? 'asc' : 'desc'); });
  bind(pagePosition, 'input', () => {
    const index = Math.max(0, Math.min(pages.length - 1, Math.round(Number(pagePosition.value)) - 1));
    if (!Number.isFinite(index)) return;
    updatePageRail(index, pages.length);
    pagePosition.setAttribute('aria-valuetext', pages.length ? `${String(index + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}` : '00 / 00');
  });
  bind(pagePosition, 'change', () => {
    const index = Math.max(0, Math.min(pages.length - 1, Math.round(Number(pagePosition.value)) - 1));
    if (!goToPage(index)) { pagePosition.value = String(pageIndex + 1); pagePosition.setAttribute('aria-valuetext', pageStatus.textContent); }
  });
  bind(grid, 'pointerdown', () => { keyboardFocus = false; });
  bind(doc, 'keydown', (event) => { if (event.key === 'Tab') keyboardFocus = true; });
  bind(doc, 'visibilitychange', clearInspection);
  bind(playerClose, 'click', closePlayer); bind(playerPrevious, 'click', () => changePlayer(-1)); bind(playerNext, 'click', () => changePlayer(1));
  bind(dialog, 'close', restorePlayerFocus); bind(dialog, 'click', (event) => { if (event.target === dialog) closePlayer(); });
  bind(dialog, 'keydown', (event) => {
    if (['input', 'textarea', 'select'].includes(event.target?.localName) || event.target?.isContentEditable) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); event.stopPropagation(); changePlayer(event.key === 'ArrowLeft' ? -1 : 1);
  });
  if (typeof win.ResizeObserver === 'function') { layoutObserver = new win.ResizeObserver(queueLayout); layoutObserver.observe(grid); }
  else bind(win, 'resize', queueLayout);
  if (likesService?.subscribe) bindings.push(likesService.subscribe(event => {
    if (event?.type !== 'refresh' || destroyed) return;
    if (!dialog.open && !pageMotion.busy) {
      const before = JSON.stringify(packingLikes);
      const next = popularitySnapshot(likesService);
      if (before !== JSON.stringify(next)) { syncPacking('likes', true); render('likes'); }
    }
  }));
  render();
  return {
    get state() { return { pageIndex, pageCount: pages.length, view, filter, order, count: pages.reduce((sum, page) => sum + page.items.length, 0), playerOpen: Boolean(dialog.open) }; },
    setLanguage(nextLanguage) { if (destroyed) return; locale = nextLanguage === 'ja' ? 'ja' : 'zh'; commentPanel.setLanguage(locale); redraw('language'); },
    setCopy(nextCopy) { if (destroyed) return; dictionary = albumCopyDictionary(nextCopy); redraw('copy'); },
    setCommentsService(next) { if (!destroyed) commentPanel.setService(next); },
    setCommentsCopy(next) { if (!destroyed) commentPanel.setCopy(next); },
    setModel(nextModel) { if (destroyed) return; closePlayer(true); modelId = String(nextModel); pageIndex = 0; redraw('model'); },
    setEnabled(value) { if (destroyed) return; enabled = Boolean(value); if (!enabled) closePlayer(true); redraw('enabled'); },
    setMedia(nextMedia, { preservePlayer = false } = {}) {
      if (destroyed) return;
      const selectedId = preservePlayer && dialog.open ? playerItems[playerIndex]?.id : null;
      if (!preservePlayer) closePlayer(true);
      records = normalizeAlbumMedia(nextMedia);
      if (preservePlayer) {
        pageCache = null;
        const nextPages = syncPacking('inline-edit');
        const nextItems = nextPages.flatMap(page => page.items);
        const nextIndex = selectedId ? nextItems.findIndex(item => item.id === selectedId) : -1;
        if (selectedId && nextIndex >= 0) { playerItems = nextItems; playerIndex = nextIndex; }
        else if (dialog.open) closePlayer(true);
        pageIndex = Math.max(0, Math.min(pageIndex, nextPages.length - 1));
        redraw('inline-edit');
      } else { pageIndex = 0; redraw('media'); }
    },
    setView(nextView) { if (destroyed || !ALBUM_VIEWS.includes(nextView)) return false; view = nextView; pageIndex = 0; transitionPage('view'); return true; },
    setFilter(nextFilter) { if (destroyed || !['model', 'all'].includes(nextFilter)) return false; filter = nextFilter; pageIndex = 0; transitionPage('filter'); return true; },
    setOrder, goToPage, openPlayer, closePlayer,
    destroy() { if (destroyed) return; layoutObserver?.disconnect(); if (layoutFrame !== null) win.cancelAnimationFrame?.(layoutFrame); layoutFrame = null; closePlayer(true); commentPanel.destroy(); playerLike?.destroy(); playerMotion.destroy(); pageMotion.destroy(); clearInspection(); destroyed = true; bindings.splice(0).forEach((dispose) => dispose()); cardBindings.splice(0).forEach((dispose) => dispose()); dialog.remove(); container.replaceChildren(); container.classList.remove('album-showcase'); },
  };
}
