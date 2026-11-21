const PHOTO_LIKES_COPY = Object.freeze({
  zh: { like: '点赞', unlike: '取消点赞', saving: '正在保存点赞…', retry: '点赞暂时无法保存，请重试', loading: '正在读取点赞…', mainSite: '请在主站点赞', count: '个赞', holdHint: '长按点赞按钮约三秒可送出五个赞', boosted: '已为这张照片送出五个赞' },
  ja: { like: 'いいね', unlike: 'いいねを取り消す', saving: 'いいねを保存中…', retry: '保存できませんでした。もう一度お試しください', loading: 'いいねを読み込み中…', mainSite: 'いいねはメインサイトで利用できます', count: '件のいいね', holdHint: 'いいねボタンを約3秒長押しすると、いいねを5件送れます', boosted: 'この写真にいいねを5件送りました' },
});
const BOOST_WEIGHT = 5;
const HOLD_MS = 2950;
const CELEBRATION_MS = 810;
const HOLD_SLOP = 14;
const HEART_PATH = 'M12 20.1 3.9 12a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9a5.1 5.1 0 0 1 7.2 7.2L12 20.1Z';
let heartSerial = 0;

function likesBaseURL(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}

const likesError = (code, status = 0) => Object.assign(new Error(code), { code, status });
const ownWeight = item => item?.liked ? item.weight ?? 1 : 0;
function validLike(item) {
  if (typeof item?.photoId !== 'string' || !item.photoId || !Number.isSafeInteger(item.count) || typeof item.liked !== 'boolean') return false;
  const weight = ownWeight(item);
  return item.count >= weight && (item.weight === undefined || item.weight === weight) && (item.liked ? [1, BOOST_WEIGHT].includes(weight) : weight === 0);
}

/** Shared read state keeps cards and the photo viewer in sync without a reload. */
export function createPhotoLikesService({ baseUrl = null, fetchImpl = globalThis.fetch, pageURL = globalThis.location?.href } = {}) {
  let endpoint = likesBaseURL(baseUrl), generation = 0, loaded = false, loadError = '', loading = null, destroyed = false;
  const records = new Map(), listeners = new Set(), writes = new Map(), controllers = new Set();
  const sameOrigin = () => {
    if (!endpoint && endpoint !== null && !pageURL) return true;
    try { return new URL(endpoint || '/', pageURL).origin === new URL(pageURL).origin; } catch { return false; }
  };
  const enabled = () => !destroyed && endpoint !== null && typeof fetchImpl === 'function';
  const get = photoId => {
    const id = String(photoId || ''), value = records.get(id);
    return { photoId: id, count: value?.count || 0, liked: value?.liked === true, weight: ownWeight(value), loaded,
      pending: writes.has(id), error: value?.error || loadError, canLike: enabled() && sameOrigin() };
  };
  const snapshot = () => Object.fromEntries([...records].map(([id, item]) => [id, item.count]));
  const emit = (type, photoId = null) => {
    const event = { type, photoId, likes: snapshot() };
    for (const listener of listeners) { try { listener(event); } catch { /* A view must not break a saved vote. */ } }
  };
  const request = async (method, body, version) => {
    if (!enabled()) throw likesError('likes_unavailable', 503);
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetchImpl(`${endpoint}/api/photo-likes`, { method, credentials: 'same-origin', mode: 'cors', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      let data; try { data = await response.json(); } catch { throw likesError('invalid_response', response.status); }
      if (destroyed || version !== generation) throw likesError('likes_source_changed');
      if (!response.ok || data?.available === false) throw likesError(data?.code || 'likes_unavailable', response.status);
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  };
  function refresh() {
    if (loading) return loading;
    const version = generation;
    // Writes that start or finish during this read win over an older GET.
    const revisions = new Map([...records].map(([id, item]) => [id, item.revision || 0]));
    const pending = new Set(writes.keys());
    const operation = (async () => {
      try {
        const data = await request('GET', null, version);
        if (!Array.isArray(data?.likes) || data.likes.some(item => !validLike(item))) throw likesError('invalid_response');
        if (version !== generation || destroyed) throw likesError('likes_source_changed');
        const incoming = new Map(data.likes.map(item => [item.photoId, item]));
        for (const id of new Set([...records.keys(), ...incoming.keys()])) {
          const current = records.get(id);
          if (pending.has(id) || writes.has(id) || (current?.revision || 0) !== (revisions.get(id) || 0)) continue;
          const item = incoming.get(id);
          records.set(id, { count: item?.count || 0, liked: item?.liked === true, weight: ownWeight(item), revision: current?.revision || 0, error: '' });
        }
        loaded = true; loadError = ''; emit('refresh'); return snapshot();
      } catch (error) {
        if (version === generation && !destroyed) { loadError = error.code || 'likes_unavailable'; emit('error'); }
        throw error;
      } finally { if (loading === operation) loading = null; }
    })();
    loading = operation;
    return operation;
  }
  async function saveVote(photoId, boosted) {
    const id = typeof photoId === 'string' ? photoId : '';
    if (!id) throw likesError('invalid_photo');
    if (!enabled()) throw likesError('likes_unavailable', 503);
    if (!sameOrigin()) throw likesError('likes_main_site_only', 403);
    const version = generation;
    // Bootstrap the shared cookie once before any concurrent first votes.
    if (!loaded) await refresh();
    if (version !== generation || destroyed) throw likesError('likes_source_changed');
    if (writes.has(id)) return writes.get(id);
    const before = records.get(id) || { count: 0, liked: false, revision: 0 };
    records.set(id, { ...before, error: '', revision: before.revision + 1 });
    const body = { photoId: id, liked: boosted || !before.liked };
    if (boosted) body.weight = BOOST_WEIGHT;
    const operation = (async () => {
      try {
        const data = await request('POST', body, version);
        if (!validLike(data) || data.photoId !== id || (boosted && ownWeight(data) !== BOOST_WEIGHT)) throw likesError('invalid_response');
        if (version !== generation || destroyed) throw likesError('likes_source_changed');
        records.set(id, { count: data.count, liked: data.liked, weight: ownWeight(data), error: '', revision: before.revision + 2 });
        writes.delete(id); emit(boosted ? 'boost' : 'toggle', id); return get(id);
      } catch (error) {
        if (version === generation && !destroyed) {
          records.set(id, { ...before, error: error.code || 'likes_unavailable', revision: before.revision + 2 });
          writes.delete(id); emit('error', id);
        }
        throw error;
      } finally { if (writes.get(id) === operation) writes.delete(id); }
    })();
    writes.set(id, operation); emit('pending', id);
    return operation;
  }
  function clear() {
    generation++; controllers.forEach(controller => controller.abort()); controllers.clear();
    records.clear(); writes.clear(); loading = null; loaded = false; loadError = '';
  }
  return {
    get enabled() { return enabled(); },
    get baseUrl() { return endpoint; },
    get canLike() { return enabled() && sameOrigin(); },
    get, snapshot, refresh,
    toggle: photoId => saveVote(photoId, false),
    boost: photoId => saveVote(photoId, true),
    setBaseUrl(value) { const next = likesBaseURL(value); if (next === endpoint) return; clear(); endpoint = next; emit('reset'); },
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { clear(); destroyed = true; listeners.clear(); },
  };
}

/** A sibling button avoids nesting interactive controls inside a photo button. */
export function createPhotoLikeButton({ document: doc = globalThis.document, service = null, photoId = '', language = 'zh', reducedMotion = () => false, isActive = () => true, onHoldChange = () => {} } = {}) {
  if (!doc?.createElement) throw new TypeError('A document is required.');
  let id = String(photoId), locale = language === 'ja' ? 'ja' : 'zh';
  let destroyed = false, pulse = null, hold = null, discardPointerClick = false;
  let motion = '', motionVersion = 0, celebrationTimer = null, sparks = null;
  const canBoost = typeof service?.boost === 'function';
  const bindings = [];
  const element = doc.createElement('button'); element.type = 'button'; element.className = 'photo-like';
  element.style?.setProperty('--like-hold-duration', `${HOLD_MS}ms`);
  const heart = doc.createElement('span'); heart.className = 'photo-like-heart'; heart.setAttribute('aria-hidden', 'true');
  const shape = doc.createElement('span'); shape.className = 'photo-like-heart-shape';
  const gradient = `photo-like-gold-${++heartSerial}`;
  shape.innerHTML = `<svg class="photo-like-outline" viewBox="0 0 24 24" fill="none"><path d="${HEART_PATH}"/></svg>
    <span class="photo-like-energy">
      <svg viewBox="0 0 24 24">
        <defs><linearGradient id="${gradient}" x2="0%" y2="100%"><stop stop-color="#ffdb83"/><stop offset="1" stop-color="#e18b22"/></linearGradient></defs>
        <path d="${HEART_PATH}" fill="url(#${gradient})" stroke="#a96721"/>
      </svg>
    </span>`;
  heart.append(shape);
  const count = doc.createElement('span'); count.className = 'photo-like-count'; count.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('span'); label.className = 'photo-like-label'; label.setAttribute('data-language-text', '');
  const status = doc.createElement('span'); status.className = 'photo-like-status'; status.setAttribute('data-language-text', ''); status.setAttribute('aria-live', 'polite');
  element.append(heart, count, label, status);

  function setMotion(value) {
    motion = value;
    element.setAttribute('data-like-motion', value);
  }
  function prepareSparks() {
    if (sparks || reducedMotion()) return;
    sparks = doc.createElement('span'); sparks.className = 'photo-like-sparks';
    for (let index = 0; index < 9; index++) {
      const spark = doc.createElement('span'); spark.className = 'photo-like-spark';
      spark.style?.setProperty('--like-angle', `${index * 40 - 90 + index % 2 * 6}deg`);
      spark.style?.setProperty('--like-travel', `${16 + index % 3 * 3}px`);
      spark.style?.setProperty('--like-ray-delay', `${index % 3 * -110}ms`);
      spark.style?.setProperty('--like-burst-delay', `${index % 3 * 16}ms`);
      sparks.append(spark);
    }
    shape.append(sparks);
  }
  function stopHold(discardClick = false) {
    if (!hold) return;
    const { pointerType } = hold;
    clearTimeout(hold.timer);
    if (discardClick && hold.kind === 'pointer') discardPointerClick = true;
    hold = null;
    setMotion('');
    onHoldChange(false, pointerType);
  }
  function cancelInteraction() {
    stopHold(true);
    motionVersion++;
    clearTimeout(celebrationTimer);
    pulse?.cancel();
    setMotion('');
  }

  function render() {
    if (destroyed) return;
    const state = service?.get?.(id) || { count: 0, liked: false, pending: false, canLike: false, loaded: false };
    const words = PHOTO_LIKES_COPY[locale];
    const action = !state.canLike ? words.mainSite : state.pending ? words.saving : state.error ? words.retry : !state.loaded ? words.loading : state.liked ? words.unlike : words.like;
    count.textContent = state.loaded ? String(state.count) : '·';
    label.textContent = `${action} · ${state.count} ${words.count}`;
    status.textContent = state.error ? words.retry : motion === 'celebrating' ? words.boosted : '';
    element.title = action;
    element.disabled = !state.canLike;
    if (state.pending || element.disabled) stopHold(true);
    // Keep a focused button focused during a write so Space can be used again.
    element.setAttribute('aria-disabled', String(state.pending || element.disabled));
    element.setAttribute('aria-pressed', String(state.liked)); element.setAttribute('aria-busy', String(state.pending));
    element.setAttribute('aria-description', canBoost && state.canLike ? words.holdHint : '');
    element.setAttribute('data-photo-id', id);
    element.classList.toggle('is-liked', state.liked);
    element.classList.toggle('is-boosted', state.weight === BOOST_WEIGHT);
    element.classList.toggle('has-error', Boolean(state.error));
  }
  const unsubscribe = service?.subscribe?.(event => {
    if (event?.type === 'reset') cancelInteraction();
    render();
    if (event?.type === 'toggle' && event.photoId === id && service.get(id).liked && !reducedMotion() && typeof heart.animate === 'function') {
      pulse?.cancel(); pulse = heart.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.22)', offset: .52 }, { transform: 'scale(1)' }], { duration: 430, easing: 'cubic-bezier(.2,.7,.25,1)' });
    }
  }) || (() => {});

  const interactive = () => !destroyed && element.getAttribute('aria-disabled') !== 'true' && !doc.hidden && element.isConnected !== false && isActive();
  async function finishHold(press) {
    if (hold !== press) return;
    stopHold(true);
    if (!interactive()) return;
    const version = ++motionVersion;
    setMotion('saving');
    try {
      await service.boost(press.photoId);
      if (version !== motionVersion || destroyed) return;
      if (!isActive() || doc.hidden) { setMotion(''); return; }
      setMotion('celebrating');
      celebrationTimer = setTimeout(() => { setMotion(''); render(); }, CELEBRATION_MS);
    } catch {
      if (version !== motionVersion || destroyed) return;
      setMotion('');
    }
    render();
  }
  function beginHold(press) {
    if (!canBoost || hold || !interactive()) return false;
    cancelInteraction();
    prepareSparks();
    setMotion('charging');
    hold = press;
    press.photoId = id;
    press.timer = setTimeout(() => void finishHold(press), HOLD_MS);
    onHoldChange(true, press.pointerType);
    return true;
  }
  async function toggle() {
    if (!interactive()) return;
    cancelInteraction();
    try { await service?.toggle?.(id); } catch { /* The shared state retains a retry hint. */ }
    render();
  }

  const bind = (target, event, listener) => {
    if (!target?.addEventListener) return;
    target.addEventListener(event, listener);
    bindings.push(() => target.removeEventListener(event, listener));
  };
  const pointerMatches = event => hold?.kind === 'pointer' && hold.pointer === event.pointerId;
  const moved = event => Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_SLOP;
  const space = event => event.key === ' ' || event.key === 'Spacebar';
  bind(element, 'pointerdown', event => {
    event.stopPropagation();
    if ((event.button ?? 0) !== 0 || event.isPrimary === false || hold) return;
    discardPointerClick = !interactive();
    if (beginHold({ kind: 'pointer', pointer: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY })) {
      try { element.setPointerCapture?.(event.pointerId); } catch { /* A pointer may have already been cancelled. */ }
    }
  });
  bind(element, 'pointermove', event => { if (pointerMatches(event) && moved(event)) stopHold(true); });
  bind(element, 'pointerup', event => { if (pointerMatches(event)) stopHold(moved(event)); });
  for (const event of ['pointercancel', 'lostpointercapture']) {
    bind(element, event, pointer => { if (pointerMatches(pointer)) stopHold(true); });
  }
  bind(element, 'pointerleave', event => {
    if (pointerMatches(event) && !element.hasPointerCapture?.(event.pointerId)) stopHold(true);
  });
  bind(element, 'contextmenu', event => {
    if (hold?.kind === 'pointer' || discardPointerClick) event.preventDefault();
  });
  bind(element, 'blur', () => stopHold(true));
  bind(doc.defaultView, 'blur', () => stopHold(true));
  bind(doc.defaultView, 'pagehide', cancelInteraction);
  bind(doc, 'visibilitychange', () => { if (doc.hidden) cancelInteraction(); });
  bind(element, 'keydown', event => {
    if (!canBoost || !space(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) beginHold({ kind: 'keyboard' });
  });
  bind(element, 'keyup', event => {
    if (!canBoost || !space(event)) return;
    event.preventDefault(); event.stopPropagation();
    if (hold?.kind !== 'keyboard') return;
    stopHold();
    return toggle();
  });
  bind(element, 'click', event => {
    event.preventDefault(); event.stopPropagation();
    if (discardPointerClick && event.detail > 0) { discardPointerClick = false; return; }
    if (!hold) return toggle();
  });
  render();
  return { element,
    setLanguage(value) { locale = value === 'ja' ? 'ja' : 'zh'; render(); },
    setPhotoId(value) {
      const next = String(value);
      if (next !== id) { cancelInteraction(); id = next; }
      render();
    },
    cancelInteraction,
    destroy() {
      destroyed = true;
      cancelInteraction(); unsubscribe();
      for (const dispose of bindings.splice(0)) dispose();
      element.remove?.();
    },
  };
}
