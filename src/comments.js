/** Public comment labels are editable alongside the other site dictionaries. */
export const COMMENTS_COPY = Object.freeze({
  zh: Object.freeze({ title: '留言', note: '无需登录。留言审核后显示。', unavailable: '评论暂未开放', loading: '正在读取留言…', empty: '还没有留言，留下一点想法吧。', loadError: '留言暂时无法读取。', retry: '重新读取', nickname: '昵称（选填）', nicknamePlaceholder: '匿名访客', body: '想说的话', bodyPlaceholder: '留下一点想法…', submit: '发送留言', submitting: '正在发送…', pending: '留言已收到，审核后显示。', submitError: '发送失败，文字已保留，请稍后重试。', rateLimited: '发送得有些频繁，文字已保留，请稍后再试。', invalidBody: '请填写 1 至 2000 字的留言。', invalidNickname: '昵称请保持在 40 字以内。', anonymous: '匿名访客', owner: '作者', reply: '回复', replyTo: '正在回复', replyLoading: '正在确认回复对象，请稍候或取消回复。', replyUnavailable: '暂时无法回复这条留言，请重新读取或取消回复。', cancelReply: '取消回复', website: '网站（请留空）', count: '字', open: '查看留言', ownerNote: '已以站长身份登录。选择留言下方的「回复」即可直接回复。', ownerReply: '站长回复', ownerSent: '回复已发布。', ownerModerationNote: '站长模式：待审核留言仅你可见，可直接审核、回复或删除。', pendingReview: '待审核', approve: '通过', reject: '拒绝', remove: '删除', reviewFirst: '请先通过留言，再回复。', moderationError: '操作未完成，请稍后重试。', approved: '留言已通过。', rejected: '留言已拒绝。', deleted: '留言已删除。' }),
  ja: Object.freeze({ title: 'コメント', note: 'ログイン不要です。承認後に表示されます。', unavailable: 'コメントは準備中です', loading: 'コメントを読み込み中…', empty: '最初のひとことを残してみませんか。', loadError: 'コメントを読み込めませんでした。', retry: 'もう一度読み込む', nickname: 'お名前（任意）', nicknamePlaceholder: '匿名の訪問者', body: 'メッセージ', bodyPlaceholder: 'ひとことをどうぞ…', submit: 'コメントを送る', submitting: '送信中…', pending: 'コメントを受け付けました。承認後に表示されます。', submitError: '送信できませんでした。入力は残っています。しばらくしてからお試しください。', rateLimited: '送信が続いています。入力は残っています。少し待ってからお試しください。', invalidBody: '1〜2000文字のコメントを入力してください。', invalidNickname: 'お名前は40文字以内で入力してください。', anonymous: '匿名の訪問者', owner: '作者', reply: '返信', replyTo: '返信先', replyLoading: '返信先を確認中です。少し待つか、返信を取り消してください。', replyUnavailable: 'このコメントには返信できません。再読み込みするか、返信を取り消してください。', cancelReply: '返信を取り消す', website: 'ウェブサイト（入力しないでください）', count: '文字', open: 'コメントを見る', ownerNote: '管理者としてログイン中です。コメントの「返信」を選ぶと直接返信できます。', ownerReply: '管理者として返信', ownerSent: '返信を公開しました。', ownerModerationNote: '管理者モード：承認待ちのコメントは管理者だけに表示されます。承認・返信・削除ができます。', pendingReview: '承認待ち', approve: '承認', reject: '非承認', remove: '削除', reviewFirst: '承認してから返信してください。', moderationError: '操作できませんでした。もう一度お試しください。', approved: 'コメントを承認しました。', rejected: 'コメントを非承認にしました。', deleted: 'コメントを削除しました。' }),
});

export const normalizeCommentsCopy = input => Object.fromEntries(['zh', 'ja'].map(locale => [locale,
  Object.fromEntries(Object.entries(COMMENTS_COPY[locale]).map(([key, fallback]) => [key, typeof input?.[locale]?.[key] === 'string' ? input[locale][key] : fallback])),
]));

function normalizeBaseUrl(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}

function commentError(code, status = 0) {
  return Object.assign(new Error(code), { code, status });
}

function normalizeComments(input, { owner = false } = {}) {
  const seen = new Set();
  const records = (Array.isArray(input) ? input : []).flatMap(item => {
    const status = item?.status || 'approved';
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || typeof item.body !== 'string' || (status !== 'approved' && !(owner && status === 'pending'))) return [];
    seen.add(item.id);
    return [{ id: item.id, parentId: typeof item.parentId === 'string' ? item.parentId : null,
      nickname: typeof item.nickname === 'string' ? item.nickname : '', body: item.body,
      status, createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', verified: item.verified === true }];
  });
  const parents = new Set(records.filter(item => !item.parentId).map(item => item.id));
  return records.filter(item => !item.parentId || parents.has(item.parentId));
}

/** Public requests omit cookies; signed-in owner replies use the same-origin admin API. */
export function createCommentService({ baseUrl = null, fetchImpl = globalThis.fetch, pageURL = globalThis.location?.href } = {}) {
  let owner = null, sessionVersion = 0;
  const sameOrigin = () => { try { return new URL(endpoint || '/', pageURL).origin === new URL(pageURL).origin; } catch { return false; } };
  let endpoint = normalizeBaseUrl(baseUrl);
  const listeners = new Set();
  const threadCache = new Map();
  const keyFor = (type, id) => JSON.stringify([type, String(id)]);
  const copyThread = records => records.map(record => ({ ...record }));
  function invalidateThread(type, id) { threadCache.delete(keyFor(type, id)); }
  function waitForThread(promise, signal) {
    if (!signal) return promise.then(copyThread);
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(records => { cleanup(); resolve(copyThread(records)); }, error => { cleanup(); reject(error); });
    });
  }
  const request = async (path, options) => {
    if (endpoint === null || typeof fetchImpl !== 'function') throw commentError('comments_unavailable', 503);
    const response = await fetchImpl(`${endpoint}/api/comments${path}`, { ...options, credentials: 'omit', mode: 'cors' });
    let data;
    try { data = await response.json(); } catch { throw commentError('invalid_response', response.status); }
    if (!response.ok) throw commentError(data?.code || 'request_failed', response.status);
    return data;
  };
  const clearOwner = () => { owner = null; sessionVersion++; threadCache.clear(); listeners.forEach(listener => listener()); };
  const ownerRequest = async (path, { method = 'GET', body, signal } = {}) => {
    if (endpoint === null || typeof fetchImpl !== 'function') throw commentError('comments_unavailable', 503);
    if (!owner || !sameOrigin()) throw commentError('owner_required', 401);
    const access = owner, version = sessionVersion, base = endpoint;
    const response = await fetchImpl(`${base}/api/admin/comments${path}`, { method, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Garden-CSRF': access.csrfToken }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let data; try { data = await response.json(); } catch { throw commentError('invalid_response', response.status); }
    if (version !== sessionVersion || owner !== access || endpoint !== base || !sameOrigin()) throw commentError('owner_session_changed', 401);
    if (!response.ok) { if (response.status === 401) clearOwner(); throw commentError(data?.code || 'request_failed', response.status); }
    return data;
  };
  return {
    get enabled() { return endpoint !== null && typeof fetchImpl === 'function'; },
    get baseUrl() { return endpoint; },
    get ownerSession() { return endpoint !== null && owner && sameOrigin() ? { authenticated: true, username: owner.username } : { authenticated: false }; },
    setOwnerSession(value) {
      const next = value?.authenticated === true && typeof value.csrfToken === 'string' && value.csrfToken && sameOrigin() ? { csrfToken: value.csrfToken, username: typeof value.username === 'string' ? value.username.slice(0, 40) : 'Amubis' } : null;
      if (next?.csrfToken === owner?.csrfToken && next?.username === owner?.username) return;
      owner = next;
      sessionVersion++;
      threadCache.clear();
      listeners.forEach(listener => listener());
    },
    setBaseUrl(value) {
      const next = normalizeBaseUrl(value);
      if (next === endpoint) { if (next === null && owner) clearOwner(); return; }
      endpoint = next;
      sessionVersion++;
      threadCache.clear();
      if (endpoint === null || !sameOrigin()) owner = null;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async getComments({ targetType, targetId, signal, force = false } = {}) {
      if (!['photo', 'note'].includes(targetType) || !targetId) throw commentError('invalid_target');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const key = keyFor(targetType, targetId);
      if (force) threadCache.delete(key);
      let entry = threadCache.get(key);
      if (!entry) {
        const version = sessionVersion;
        entry = { type: targetType, id: String(targetId), records: null, promise: null };
        // A panel closing must not cancel a read shared by a second panel.
        entry.promise = (async () => {
          const query = new URLSearchParams({ targetType, targetId: String(targetId) });
          let records;
          if (owner && sameOrigin()) {
            query.set('limit', '500');
            const data = await ownerRequest(`?${query}`);
            const matching = (Array.isArray(data) ? data : data?.comments || []).filter(item => item.targetType === targetType && item.targetId === String(targetId));
            records = normalizeComments(matching, { owner: true });
          } else {
            const data = await request(`?${query}`, { method: 'GET', headers: { Accept: 'application/json' } });
            if (data?.available === false) throw commentError('comments_unavailable', 503);
            records = normalizeComments(Array.isArray(data) ? data : data?.comments);
          }
          if (version !== sessionVersion) throw commentError('owner_session_changed', 401);
          entry.records = records;
          return records;
        })().catch(error => { if (threadCache.get(key) === entry) threadCache.delete(key); throw error; });
        threadCache.set(key, entry);
      }
      return waitForThread(entry.promise, signal);
    },
    async postComment(payload, { signal } = {}) {
      if (owner && sameOrigin()) {
        if (!payload?.parentId) throw commentError('owner_reply_required', 400);
        const result = await ownerRequest(`/${encodeURIComponent(payload.parentId)}/reply`, { method: 'POST', signal, body: { body: payload.body } });
        invalidateThread(payload.targetType, payload.targetId); return result;
      }
      const result = await request('', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
      invalidateThread(payload.targetType, payload.targetId); return result;
    },
    async moderateComment(commentId, status, { signal } = {}) {
      if (typeof commentId !== 'string' || !commentId || !['approved', 'rejected', 'deleted'].includes(status)) throw commentError('invalid_moderation', 400);
      const result = await ownerRequest(`/${encodeURIComponent(commentId)}`, { method: 'PATCH', signal, body: { status, read: true } });
      for (const [key, entry] of threadCache) if (entry.records?.some(comment => comment.id === commentId)) threadCache.delete(key);
      return result;
    },
  };
}

/** One panel owns a single visible thread; changing its target aborts stale work. */
export function createAnonymousComments({ container, service = null, targetType = 'photo', targetId = null, language = 'zh', copy, active = true, previewLimit = 0, compact = false, onOpenThread = null } = {}) {
  if (!container?.ownerDocument) throw new TypeError('A comments container is required.');
  const doc = container.ownerDocument;
  let locale = language === 'ja' ? 'ja' : 'zh';
  let dictionary = normalizeCommentsCopy(copy);
  let client = service;
  let type = targetType;
  let id = targetId === null ? null : String(targetId);
  let isActive = Boolean(active);
  let destroyed = false;
  let generation = 0;
  let loadController = null;
  let submitController = null;
  let moderationController = null, moderating = null;
  let unsubscribe = () => {};
  let comments = [];
  let loadState = 'idle';
  let submitState = '';
  let submitting = false;
  let replyId = null;
  let wasOwner = false, anonymousNickname = '';
  const configuredLimit = Number.isFinite(Number(previewLimit)) ? Math.max(0, Math.floor(Number(previewLimit))) : 0;
  let isCompact = Boolean(compact), openThreadHandler = typeof onOpenThread === 'function' ? onOpenThread : null;
  let limit = configuredLimit || (isCompact ? 3 : 0);
  let expanded = false, listAnimation = null;
  const expandedReplies = new Set();
  const ownerMode = () => client?.ownerSession?.authenticated === true;
  const canModerate = () => ownerMode() && typeof client?.moderateComment === 'function';
  const selectedReply = () => comments.find(comment => comment.id === replyId && !comment.parentId);
  const canReplyTo = comment => Boolean(comment && comment.status === 'approved' && !comment.parentId);
  const drafts = new Map();
  const bindings = [];
  const words = () => dictionary[locale];
  const available = () => Boolean(client?.enabled && id && ['photo', 'note'].includes(type));
  const element = (tag, className, text) => { const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const languageText = node => { node.setAttribute('data-language-text', ''); return node; };
  const bind = (node, event, fn) => { node.addEventListener(event, fn); bindings.push(() => node.removeEventListener(event, fn)); };
  const button = className => { const node = element('button', className); node.type = 'button'; return node; };
  const root = element('section', 'anonymous-comments');
  if (limit) root.classList.add('comments-preview');
  const heading = element('h3', 'comments-heading');
  const note = element('p', 'comments-note');
  const loadMessage = element('p', 'comments-load-state'); loadMessage.setAttribute('role', 'status');
  const retry = button('comments-retry');
  const list = element('div', 'comments-list');
  list.tabIndex = -1;
  const more = button('comments-more'); more.hidden = true;
  const openThread = button('comments-open-thread'); openThread.hidden = true;
  const form = element('form', 'comments-form');
  const nicknameLabel = element('label', 'comments-label comments-nickname-label'); const nicknameText = element('span', 'comments-label-text');
  const nickname = element('input', 'comments-nickname'); nickname.type = 'text'; nickname.name = 'nickname'; nickname.autocomplete = 'nickname';
  nicknameLabel.append(nicknameText, nickname);
  const bodyLabel = element('label', 'comments-label'); const bodyText = element('span', 'comments-label-text');
  const body = element('textarea', 'comments-body'); body.name = 'body'; body.rows = 4; body.required = true;
  bodyLabel.append(bodyText, body);
  const trap = element('label', 'comments-honeypot'); trap.setAttribute('aria-hidden', 'true');
  const trapText = element('span', ''); const website = element('input', ''); website.type = 'text'; website.name = 'website'; website.tabIndex = -1; website.autocomplete = 'off'; trap.append(trapText, website);
  const reply = element('div', 'comments-reply-target'); const replyText = element('span', ''); const cancelReply = button('comments-cancel-reply'); reply.append(replyText, cancelReply);
  const footer = element('div', 'comments-form-footer'); const count = element('span', 'comments-count'); const submit = element('button', 'comments-submit'); submit.type = 'submit'; footer.append(count, submit);
  const status = element('p', 'comments-submit-state'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  [heading, note, loadMessage, retry, more, openThread, nicknameText, bodyText, replyText, cancelReply, count, submit, status].forEach(languageText);
  form.append(nicknameLabel, reply, bodyLabel, trap, footer, status);
  root.append(heading, note, loadMessage, retry, list, more, openThread, form); container.replaceChildren(root);

  const draftKey = () => `${type}:${id}`;
  function saveDraft() { if (id) drafts.set(draftKey(), { body: body.value || '', nickname: ownerMode() ? anonymousNickname : nickname.value || '', website: website.value || '', replyId, expanded, expandedReplies: [...expandedReplies] }); }
  function restoreDraft() {
    const draft = drafts.get(draftKey());
    body.value = draft?.body || ''; nickname.value = draft?.nickname || ''; website.value = draft?.website || ''; replyId = draft?.replyId || null;
    expanded = draft?.expanded === true; expandedReplies.clear();
    for (const parentId of draft?.expandedReplies || []) expandedReplies.add(parentId);
  }
  function abort() {
    generation++;
    loadController?.abort(); submitController?.abort(); moderationController?.abort(); loadController = submitController = moderationController = null; submitting = false; moderating = null;
  }
  function renderComments() {
    listAnimation?.cancel(); listAnimation = null;
    const topLevel = comments.filter(comment => !comment.parentId);
    const createComment = comment => {
      const article = element('article', `comment${comment.parentId ? ' comment-reply' : ''}`);
      article.setAttribute('data-comment-id', comment.id);
      article.classList.toggle('comment-pending', comment.status === 'pending');
      const meta = element('div', 'comment-meta');
      const author = element('span', 'comment-author', comment.nickname.trim() || words().anonymous);
      if (!comment.nickname.trim()) languageText(author);
      meta.append(author);
      if (comment.verified === true) meta.append(languageText(element('span', 'comment-owner', words().owner)));
      if (comment.status === 'pending') meta.append(languageText(element('span', 'comment-review-state', words().pendingReview)));
      const parsed = Date.parse(comment.createdAt);
      if (Number.isFinite(parsed)) {
        const date = new Date(parsed); const time = languageText(element('time', 'comment-date', date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }))); time.dateTime = date.toISOString(); meta.append(time);
      }
      article.append(meta, element('p', 'comment-body', comment.body));
      const actions = element('div', 'comment-actions');
      if (!comment.parentId) {
        const replyButton = languageText(button('comment-reply-button')); replyButton.textContent = words().reply;
        replyButton.disabled = Boolean(moderating) || !canReplyTo(comment);
        if (!canReplyTo(comment)) replyButton.title = words().reviewFirst;
        replyButton.addEventListener('click', () => {
          replyId = comment.id; submitState = ''; saveDraft(); update();
          if (isCompact) requestOpenThread();
          else body.focus?.();
        });
        actions.append(replyButton);
      }
      if (canModerate()) {
        if (comment.status === 'pending') for (const [status, label] of [['approved', 'approve'], ['rejected', 'reject']]) {
          const reviewButton = languageText(button(`comment-moderation-button comment-${label}-button`)); reviewButton.textContent = words()[label]; reviewButton.disabled = Boolean(moderating) || submitting;
          reviewButton.addEventListener('click', () => moderate(comment, status)); actions.append(reviewButton);
        }
        const remove = languageText(button('comment-moderation-button comment-delete-button')); remove.textContent = words().remove; remove.disabled = Boolean(moderating) || submitting;
        remove.setAttribute('aria-label', `${words().remove} · ${comment.nickname.trim() || words().anonymous}`);
        remove.addEventListener('click', () => moderate(comment, 'deleted')); actions.append(remove);
      }
      if (actions.children.length) article.append(actions);
      if (!comment.parentId) {
        const children = comments.filter(child => child.parentId === comment.id);
        if (children.length) {
          const replies = element('div', 'comment-replies');
          const open = expandedReplies.has(comment.id);
          // Pending replies remain visible to their moderator even in a short preview.
          const visible = !isCompact || open ? children : children.filter((child, index) => index === 0 || (ownerMode() && child.status === 'pending'));
          replies.append(...visible.map(createComment));
          if (isCompact && children.length > 1 && (open || visible.length < children.length)) {
            const toggle = languageText(button('comment-replies-more'));
            toggle.textContent = open ? (locale === 'ja' ? '返信を折りたたむ' : '收起回复') : (locale === 'ja' ? `残り${children.length - visible.length}件の返信を見る` : `展开其余 ${children.length - visible.length} 条回复`);
            toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('data-parent-id', comment.id);
            toggle.addEventListener('click', () => setRepliesExpanded(comment.id, !open, true));
            replies.append(toggle);
          }
          article.append(replies);
        }
      }
      return article;
    };
    list.replaceChildren(...(limit && !expanded && !ownerMode() ? topLevel.slice(0, limit) : topLevel).map(createComment));
    const remainder = Math.max(0, topLevel.length - limit);
    more.hidden = !available() || !limit || !remainder || ownerMode();
    more.textContent = expanded ? (locale === 'ja' ? 'コメントを折りたたむ' : '收起留言') : (locale === 'ja' ? `残り${remainder}件のコメントを見る` : `展开其余 ${remainder} 条留言`);
    more.setAttribute('aria-expanded', String(expanded));
    root.classList.toggle('comments-expanded', expanded || ownerMode());
    root.classList.toggle('comments-owner-mode', ownerMode());
    root.classList.toggle('comments-compact', isCompact);
    root.classList.toggle('comments-preview', Boolean(limit));
  }
  function revealReply() {
    if (limit && comments.filter(comment => !comment.parentId).findIndex(comment => comment.id === replyId) >= limit) expanded = true;
  }
  function setExpanded(next, animate = false) {
    const value = Boolean(next);
    if (destroyed || value === expanded) return;
    const previousHeight = list.getBoundingClientRect?.().height;
    listAnimation?.cancel(); listAnimation = null;
    expanded = value; renderComments(); update(); saveDraft();
    animateListHeight(previousHeight, animate);
  }
  function animateListHeight(previousHeight, animate = false) {
    const nextHeight = list.getBoundingClientRect?.().height;
    if (!animate || !list.animate || doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !previousHeight || previousHeight === nextHeight) return;
    const animation = list.animate([{ height: `${previousHeight}px`, overflow: 'hidden' }, { height: `${nextHeight}px`, overflow: 'hidden' }], { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' });
    listAnimation = animation;
    animation.finished.then(() => { if (listAnimation === animation) listAnimation = null; }, () => {});
  }
  function setRepliesExpanded(parentId, value, animate = false) {
    if (destroyed) return;
    const previousHeight = list.getBoundingClientRect?.().height;
    if (value) expandedReplies.add(parentId); else expandedReplies.delete(parentId);
    renderComments(); update(); saveDraft(); animateListHeight(previousHeight, animate);
    if (animate) [...list.querySelectorAll('.comment-replies-more')].find(node => node.getAttribute('data-parent-id') === parentId)?.focus?.({ preventScroll: true });
  }
  function requestOpenThread() {
    if (destroyed) return;
    saveDraft();
    if (openThreadHandler) openThreadHandler({ targetType: type, targetId: id, replyId });
    else setCompact(false);
    if (!isCompact) body.focus?.({ preventScroll: true });
  }
  function setCompact(next) {
    const value = Boolean(next);
    if (destroyed || value === isCompact) return;
    saveDraft(); isCompact = value; limit = value ? configuredLimit || 3 : 0;
    renderComments(); update();
  }
  function update() {
    if (destroyed) return;
    const enabled = available();
    heading.textContent = words().title; root.setAttribute('aria-label', words().title);
    const loggedIn = ownerMode();
    if (loggedIn && !wasOwner) anonymousNickname = nickname.value || '';
    if (!loggedIn && wasOwner) nickname.value = anonymousNickname;
    if (loggedIn) nickname.value = client.ownerSession.username || 'Amubis';
    wasOwner = loggedIn;
    note.textContent = loggedIn ? words()[canModerate() ? 'ownerModerationNote' : 'ownerNote'] : words().note; note.hidden = isCompact || !enabled || loadState === 'unavailable';
    form.hidden = isCompact || !enabled || loadState === 'unavailable'; list.hidden = !enabled;
    openThread.hidden = !isCompact || !enabled || loadState === 'unavailable';
    openThread.textContent = locale === 'ja' ? 'コメントを書く／会話を見る' : '写留言／查看讨论';
    nicknameText.textContent = words().nickname; nickname.placeholder = words().nicknamePlaceholder;
    bodyText.textContent = words().body; body.placeholder = words().bodyPlaceholder; trapText.textContent = words().website;
    const message = !enabled || loadState === 'unavailable' ? 'unavailable' : loadState === 'loading' ? 'loading' : loadState === 'error' ? 'loadError' : !comments.length ? 'empty' : '';
    loadMessage.textContent = words()[message] || ''; loadMessage.hidden = !message;
    retry.textContent = words().retry; retry.hidden = !enabled || loadState !== 'error';
    const parent = selectedReply();
    reply.hidden = !replyId;
    replyText.textContent = parent ? `${words().replyTo} ${parent.nickname.trim() || words().anonymous}` : replyId ? words()[['loading', 'idle'].includes(loadState) ? 'replyLoading' : 'replyUnavailable'] : '';
    cancelReply.textContent = words().cancelReply;
    count.textContent = `${Array.from(body.value || '').length} / 2000 ${words().count}`;
    submit.disabled = submitting || Boolean(moderating) || !enabled || Boolean(replyId && !canReplyTo(parent)) || (loggedIn && !canReplyTo(parent)); submit.textContent = submitting ? words().submitting : loggedIn ? words().ownerReply : words().submit;
    nickname.disabled = submitting || loggedIn; body.disabled = submitting; cancelReply.disabled = submitting;
    status.textContent = words()[submitState] || ''; status.hidden = !submitState;
  }
  async function load({ force = false } = {}) {
    abort(); comments = []; submitState = ''; loadState = 'idle'; renderComments(); update();
    if (!isActive || !available()) return;
    const current = generation; loadController = new AbortController(); loadState = 'loading'; update();
    try {
      const result = await client.getComments({ targetType: type, targetId: id, signal: loadController.signal, force });
      if (destroyed || current !== generation) return;
      comments = normalizeComments(result, { owner: ownerMode() }); loadState = 'loaded'; revealReply(); renderComments();
    } catch (error) {
      if (destroyed || current !== generation || error?.name === 'AbortError') return;
      loadState = error?.code === 'comments_unavailable' ? 'unavailable' : 'error';
    } finally { if (!destroyed && current === generation) { loadController = null; update(); } }
  }
  async function send(event) {
    event.preventDefault();
    if (destroyed || submitting || moderating || !isActive || !available()) return;
    const parent = selectedReply();
    if ((replyId && !canReplyTo(parent)) || (ownerMode() && !canReplyTo(parent))) { update(); return; }
    const message = (body.value || '').trim(); const name = (nickname.value || '').trim();
    if (!message || Array.from(message).length > 2000) { submitState = 'invalidBody'; update(); body.focus?.(); return; }
    if (Array.from(name).length > 40) { submitState = 'invalidNickname'; update(); nickname.focus?.(); return; }
    const current = generation; submitting = true; submitState = ''; submitController = new AbortController(); update();
    const payload = { targetType: type, targetId: id, nickname: name, body: message, website: website.value || '' };
    if (parent) payload.parentId = parent.id;
    try {
      const result = await client.postComment(payload, { signal: submitController.signal });
      if (destroyed || current !== generation) return;
      const publishedReply = ownerMode() && result?.comment?.verified === true && result.comment.status === 'approved';
      if (publishedReply) { comments = normalizeComments([...comments, result.comment], { owner: true }); if (parent) expandedReplies.add(parent.id); renderComments(); }
      body.value = ''; website.value = ''; replyId = null; submitState = publishedReply ? 'ownerSent' : 'pending'; saveDraft();
    } catch (error) {
      if (destroyed || current !== generation || error?.name === 'AbortError') return;
      submitState = error?.status === 429 ? 'rateLimited' : error?.code === 'comments_unavailable' ? 'unavailable' : 'submitError';
    } finally { if (!destroyed && current === generation) { submitting = false; submitController = null; update(); } }
  }
  async function moderate(comment, nextStatus) {
    if (destroyed || moderating || submitting || !isActive || !canModerate()) return;
    const current = generation; moderating = comment.id; moderationController = new AbortController(); submitState = ''; renderComments(); update();
    try {
      const result = await client.moderateComment(comment.id, nextStatus, { signal: moderationController.signal });
      if (destroyed || current !== generation || !ownerMode()) return;
      if (nextStatus === 'approved') comments = normalizeComments(comments.map(item => item.id === comment.id ? { ...item, ...result?.comment, status: 'approved' } : item), { owner: true });
      else {
        const removed = new Set(comments.filter(item => item.id === comment.id || item.parentId === comment.id).map(item => item.id));
        comments = comments.filter(item => !removed.has(item.id));
        if (removed.has(replyId)) { replyId = null; saveDraft(); }
      }
      submitState = nextStatus;
    } catch (error) {
      if (destroyed || current !== generation || error?.name === 'AbortError') return;
      submitState = 'moderationError';
    } finally {
      if (!destroyed && current === generation) { moderationController = null; moderating = null; renderComments(); update(); list.focus?.({ preventScroll: true }); }
    }
  }
  function setService(next) {
    unsubscribe(); client = next;
    unsubscribe = typeof client?.subscribe === 'function' ? client.subscribe(() => { void load(); }) : () => {};
    void load();
  }
  bind(form, 'submit', send);
  bind(body, 'input', () => { saveDraft(); update(); }); bind(nickname, 'input', saveDraft);
  bind(cancelReply, 'click', () => { replyId = null; saveDraft(); update(); });
  bind(retry, 'click', () => { void load({ force: true }); });
  bind(more, 'click', () => setExpanded(!expanded, true));
  bind(openThread, 'click', requestOpenThread);
  setService(service);
  return {
    get draft() { return { body: body.value || '', nickname: nickname.value || '', website: website.value || '', replyId }; },
    setDraft(next) { if (destroyed || !next) return; body.value = typeof next.body === 'string' ? next.body : ''; nickname.value = typeof next.nickname === 'string' ? next.nickname : ''; website.value = typeof next.website === 'string' ? next.website : ''; replyId = typeof next.replyId === 'string' ? next.replyId : null; revealReply(); saveDraft(); renderComments(); update(); },
    get expanded() { return expanded; },
    setExpanded(next) { setExpanded(next); },
    get compact() { return isCompact; },
    setCompact,
    get replyExpansion() { return [...expandedReplies]; },
    setReplyExpansion(next) { if (destroyed) return; expandedReplies.clear(); for (const parentId of Array.isArray(next) ? next : []) if (typeof parentId === 'string') expandedReplies.add(parentId); saveDraft(); renderComments(); update(); },
    setOpenThreadHandler(next) { if (!destroyed) openThreadHandler = typeof next === 'function' ? next : null; },
    setTarget(nextType, nextId) {
      if (destroyed) return;
      if (nextType && typeof nextType === 'object') { nextId = nextType.targetId; nextType = nextType.targetType; }
      const next = nextId === null || nextId === undefined ? null : String(nextId);
      if (nextType === type && next === id) return;
      saveDraft(); type = nextType; id = next; expanded = false; restoreDraft(); void load();
    },
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; renderComments(); update(); },
    setCopy(next) { if (destroyed) return; dictionary = normalizeCommentsCopy(next); renderComments(); update(); },
    setService(next) { if (!destroyed) setService(next); },
    setActive(next) { if (destroyed || Boolean(next) === isActive) return; saveDraft(); isActive = Boolean(next); if (isActive) void load(); else { abort(); loadState = 'idle'; update(); } },
    destroy() { if (destroyed) return; destroyed = true; listAnimation?.cancel(); abort(); unsubscribe(); bindings.splice(0).forEach(remove => remove()); drafts.clear(); container.replaceChildren(); },
  };
}
