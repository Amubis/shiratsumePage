const PHOTO_LIKES_COPY = Object.freeze({
  zh: { like: '点赞', unlike: '取消点赞', saving: '正在保存点赞…', retry: '点赞暂时无法保存，请重试', loading: '正在读取点赞…', mainSite: '请在主站点赞', count: '个赞' },
  ja: { like: 'いいね', unlike: 'いいねを取り消す', saving: 'いいねを保存中…', retry: '保存できませんでした。もう一度お試しください', loading: 'いいねを読み込み中…', mainSite: 'いいねはメインサイトで利用できます', count: '件のいいね' },
});

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
const validLike = item => typeof item?.photoId === 'string' && item.photoId && Number.isSafeInteger(item.count) && item.count >= 0 && typeof item.liked === 'boolean';

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
    return { photoId: id, count: value?.count || 0, liked: value?.liked === true, loaded,
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
          records.set(id, { count: item?.count || 0, liked: item?.liked === true, revision: current?.revision || 0, error: '' });
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
  async function toggle(photoId) {
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
    const operation = (async () => {
      try {
        const data = await request('POST', { photoId: id, liked: !before.liked }, version);
        if (!validLike(data) || data.photoId !== id) throw likesError('invalid_response');
        if (version !== generation || destroyed) throw likesError('likes_source_changed');
        records.set(id, { count: data.count, liked: data.liked, error: '', revision: before.revision + 2 });
        writes.delete(id); emit('toggle', id); return get(id);
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
    get, snapshot, refresh, toggle,
    setBaseUrl(value) { const next = likesBaseURL(value); if (next === endpoint) return; clear(); endpoint = next; emit('reset'); },
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { clear(); destroyed = true; listeners.clear(); },
  };
}

/** A sibling button avoids nesting interactive controls inside a photo button. */
export function createPhotoLikeButton({ document: doc = globalThis.document, service = null, photoId = '', language = 'zh', reducedMotion = () => false } = {}) {
  if (!doc?.createElement) throw new TypeError('A document is required.');
  let id = String(photoId), locale = language === 'ja' ? 'ja' : 'zh', destroyed = false, pulse = null;
  const element = doc.createElement('button'); element.type = 'button'; element.className = 'photo-like';
  const heart = doc.createElement('span'); heart.className = 'photo-like-heart'; heart.setAttribute('aria-hidden', 'true');
  heart.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 20.1 3.9 12a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9a5.1 5.1 0 0 1 7.2 7.2L12 20.1Z"/></svg>';
  const count = doc.createElement('span'); count.className = 'photo-like-count'; count.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('span'); label.className = 'photo-like-label'; label.setAttribute('data-language-text', '');
  const status = doc.createElement('span'); status.className = 'photo-like-status'; status.setAttribute('data-language-text', ''); status.setAttribute('aria-live', 'polite');
  element.append(heart, count, label, status);
  function render() {
    if (destroyed) return;
    const state = service?.get?.(id) || { count: 0, liked: false, pending: false, canLike: false, loaded: false };
    const words = PHOTO_LIKES_COPY[locale];
    const action = !state.canLike ? words.mainSite : state.pending ? words.saving : state.error ? words.retry : !state.loaded ? words.loading : state.liked ? words.unlike : words.like;
    count.textContent = state.loaded ? String(state.count) : '·';
    label.textContent = `${action} · ${state.count} ${words.count}`;
    status.textContent = state.error ? words.retry : '';
    element.title = action; element.disabled = state.pending || !state.canLike;
    element.setAttribute('aria-pressed', String(state.liked)); element.setAttribute('aria-busy', String(state.pending));
    element.setAttribute('data-photo-id', id);
    element.classList.toggle('is-liked', state.liked); element.classList.toggle('has-error', Boolean(state.error));
  }
  const unsubscribe = service?.subscribe?.(event => {
    render();
    if (event?.type === 'toggle' && event.photoId === id && service.get(id).liked && !reducedMotion() && typeof heart.animate === 'function') {
      pulse?.cancel(); pulse = heart.animate([{ transform: 'scale(.8)' }, { transform: 'scale(1.22)', offset: .52 }, { transform: 'scale(1)' }], { duration: 430, easing: 'cubic-bezier(.2,.7,.25,1)' });
    }
  }) || (() => {});
  const stop = event => event.stopPropagation();
  const click = async event => { event.preventDefault(); event.stopPropagation(); try { await service?.toggle?.(id); } catch { /* The shared state retains a retry hint. */ } render(); };
  element.addEventListener('pointerdown', stop); element.addEventListener('click', click);
  render();
  return { element,
    setLanguage(value) { locale = value === 'ja' ? 'ja' : 'zh'; render(); },
    setPhotoId(value) { id = String(value); render(); },
    destroy() { destroyed = true; pulse?.cancel(); unsubscribe(); element.removeEventListener('pointerdown', stop); element.removeEventListener('click', click); element.remove?.(); },
  };
}
