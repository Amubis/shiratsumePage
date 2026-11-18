/** Public comment labels are editable alongside the other site dictionaries. */
export const COMMENTS_COPY = Object.freeze({
  zh: Object.freeze({ title: '留言', note: '无需登录。留言审核后显示。', unavailable: '评论暂未开放', loading: '正在读取留言…', empty: '还没有留言，留下一点想法吧。', loadError: '留言暂时无法读取。', retry: '重新读取', nickname: '昵称（选填）', nicknamePlaceholder: '匿名访客', body: '想说的话', bodyPlaceholder: '留下一点想法…', submit: '发送留言', submitting: '正在发送…', pending: '留言已收到，审核后显示。', submitError: '发送失败，文字已保留，请稍后重试。', rateLimited: '发送得有些频繁，文字已保留，请稍后再试。', invalidBody: '请填写 1 至 2000 字的留言。', invalidNickname: '昵称请保持在 40 字以内。', anonymous: '匿名访客', owner: '作者', reply: '回复', replyTo: '正在回复', replyLoading: '正在确认回复对象，请稍候或取消回复。', replyUnavailable: '暂时无法回复这条留言，请重新读取或取消回复。', cancelReply: '取消回复', website: '网站（请留空）', count: '字', open: '查看留言', ownerNote: '已以站长身份登录。选择留言下方的「回复」即可直接回复。', ownerReply: '站长回复', ownerSent: '回复已发布。' }),
  ja: Object.freeze({ title: 'コメント', note: 'ログイン不要です。承認後に表示されます。', unavailable: 'コメントは準備中です', loading: 'コメントを読み込み中…', empty: '最初のひとことを残してみませんか。', loadError: 'コメントを読み込めませんでした。', retry: 'もう一度読み込む', nickname: 'お名前（任意）', nicknamePlaceholder: '匿名の訪問者', body: 'メッセージ', bodyPlaceholder: 'ひとことをどうぞ…', submit: 'コメントを送る', submitting: '送信中…', pending: 'コメントを受け付けました。承認後に表示されます。', submitError: '送信できませんでした。入力は残っています。しばらくしてからお試しください。', rateLimited: '送信が続いています。入力は残っています。少し待ってからお試しください。', invalidBody: '1〜2000文字のコメントを入力してください。', invalidNickname: 'お名前は40文字以内で入力してください。', anonymous: '匿名の訪問者', owner: '作者', reply: '返信', replyTo: '返信先', replyLoading: '返信先を確認中です。少し待つか、返信を取り消してください。', replyUnavailable: 'このコメントには返信できません。再読み込みするか、返信を取り消してください。', cancelReply: '返信を取り消す', website: 'ウェブサイト（入力しないでください）', count: '文字', open: 'コメントを見る', ownerNote: '管理者としてログイン中です。コメントの「返信」を選ぶと直接返信できます。', ownerReply: '管理者として返信', ownerSent: '返信を公開しました。' }),
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

function normalizeComments(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).flatMap(item => {
    if (!item || typeof item.id !== 'string' || seen.has(item.id) || typeof item.body !== 'string' || (item.status && item.status !== 'approved')) return [];
    seen.add(item.id);
    return [{ id: item.id, parentId: typeof item.parentId === 'string' ? item.parentId : null,
      nickname: typeof item.nickname === 'string' ? item.nickname : '', body: item.body,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '', verified: item.verified === true }];
  });
}

/** Public requests omit cookies; signed-in owner replies use the same-origin admin API. */
export function createCommentService({ baseUrl = null, fetchImpl = globalThis.fetch, pageURL = globalThis.location?.href } = {}) {
  let owner = null;
  const sameOrigin = () => { try { return new URL(endpoint || '/', pageURL).origin === new URL(pageURL).origin; } catch { return false; } };
  let endpoint = normalizeBaseUrl(baseUrl);
  const listeners = new Set();
  const request = async (path, options) => {
    if (endpoint === null || typeof fetchImpl !== 'function') throw commentError('comments_unavailable', 503);
    const response = await fetchImpl(`${endpoint}/api/comments${path}`, { ...options, credentials: 'omit', mode: 'cors' });
    let data;
    try { data = await response.json(); } catch { throw commentError('invalid_response', response.status); }
    if (!response.ok) throw commentError(data?.code || 'request_failed', response.status);
    return data;
  };
  return {
    get enabled() { return endpoint !== null && typeof fetchImpl === 'function'; },
    get baseUrl() { return endpoint; },
    get ownerSession() { return owner && sameOrigin() ? { authenticated: true, username: owner.username } : { authenticated: false }; },
    setOwnerSession(value) {
      owner = value?.authenticated === true && typeof value.csrfToken === 'string' && value.csrfToken && sameOrigin() ? { csrfToken: value.csrfToken, username: typeof value.username === 'string' ? value.username.slice(0, 40) : 'Amubis' } : null;
      listeners.forEach(listener => listener());
    },
    setBaseUrl(value) {
      const next = normalizeBaseUrl(value);
      if (next === endpoint) return;
      endpoint = next;
      if (!sameOrigin()) owner = null;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async getComments({ targetType, targetId, signal } = {}) {
      if (!['photo', 'note'].includes(targetType) || !targetId) throw commentError('invalid_target');
      const query = new URLSearchParams({ targetType, targetId: String(targetId) });
      const data = await request(`?${query}`, { method: 'GET', signal, headers: { Accept: 'application/json' } });
      if (data?.available === false) throw commentError('comments_unavailable', 503);
      return normalizeComments(Array.isArray(data) ? data : data?.comments);
    },
    async postComment(payload, { signal } = {}) {
      if (owner && sameOrigin()) {
        if (!payload?.parentId) throw commentError('owner_reply_required', 400);
        const response = await fetchImpl(`${endpoint}/api/admin/comments/${encodeURIComponent(payload.parentId)}/reply`, { method: 'POST', credentials: 'same-origin', mode: 'same-origin', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Garden-CSRF': owner.csrfToken }, body: JSON.stringify({ body: payload.body }) });
        let data; try { data = await response.json(); } catch { throw commentError('invalid_response', response.status); }
        if (!response.ok) throw commentError(data?.code || 'request_failed', response.status);
        return data;
      }
      return request('', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    },
  };
}

/** One panel owns a single visible thread; changing its target aborts stale work. */
export function createAnonymousComments({ container, service = null, targetType = 'photo', targetId = null, language = 'zh', copy, active = true } = {}) {
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
  let unsubscribe = () => {};
  let comments = [];
  let loadState = 'idle';
  let submitState = '';
  let submitting = false;
  let replyId = null;
  let wasOwner = false, anonymousNickname = '';
  const ownerMode = () => client?.ownerSession?.authenticated === true;
  const drafts = new Map();
  const bindings = [];
  const words = () => dictionary[locale];
  const available = () => Boolean(client?.enabled && id && ['photo', 'note'].includes(type));
  const element = (tag, className, text) => { const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const bind = (node, event, fn) => { node.addEventListener(event, fn); bindings.push(() => node.removeEventListener(event, fn)); };
  const button = className => { const node = element('button', className); node.type = 'button'; return node; };
  const root = element('section', 'anonymous-comments');
  const heading = element('h3', 'comments-heading');
  const note = element('p', 'comments-note');
  const loadMessage = element('p', 'comments-load-state'); loadMessage.setAttribute('role', 'status');
  const retry = button('comments-retry');
  const list = element('div', 'comments-list');
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
  form.append(nicknameLabel, reply, bodyLabel, trap, footer, status);
  root.append(heading, note, loadMessage, retry, list, form); container.replaceChildren(root);

  const draftKey = () => `${type}:${id}`;
  function saveDraft() { if (id) drafts.set(draftKey(), { body: body.value || '', nickname: ownerMode() ? anonymousNickname : nickname.value || '', website: website.value || '', replyId }); }
  function restoreDraft() {
    const draft = drafts.get(draftKey());
    body.value = draft?.body || ''; nickname.value = draft?.nickname || ''; website.value = draft?.website || ''; replyId = draft?.replyId || null;
  }
  function abort() {
    generation++;
    loadController?.abort(); submitController?.abort(); loadController = submitController = null; submitting = false;
  }
  function renderComments() {
    const topLevel = comments.filter(comment => !comment.parentId);
    const createComment = comment => {
      const article = element('article', `comment${comment.parentId ? ' comment-reply' : ''}`);
      const meta = element('div', 'comment-meta');
      const author = element('span', 'comment-author', comment.nickname.trim() || words().anonymous); meta.append(author);
      if (comment.verified === true) meta.append(element('span', 'comment-owner', words().owner));
      const parsed = Date.parse(comment.createdAt);
      if (Number.isFinite(parsed)) {
        const date = new Date(parsed); const time = element('time', 'comment-date', date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })); time.dateTime = date.toISOString(); meta.append(time);
      }
      article.append(meta, element('p', 'comment-body', comment.body));
      if (!comment.parentId) {
        const replyButton = button('comment-reply-button'); replyButton.textContent = words().reply;
        replyButton.addEventListener('click', () => { replyId = comment.id; submitState = ''; update(); body.focus?.(); });
        article.append(replyButton);
        const children = comments.filter(child => child.parentId === comment.id);
        if (children.length) { const replies = element('div', 'comment-replies'); replies.append(...children.map(createComment)); article.append(replies); }
      }
      return article;
    };
    list.replaceChildren(...topLevel.map(createComment));
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
    note.textContent = loggedIn ? words().ownerNote : words().note; note.hidden = !enabled || loadState === 'unavailable';
    form.hidden = !enabled || loadState === 'unavailable'; list.hidden = !enabled;
    nicknameText.textContent = words().nickname; nickname.placeholder = words().nicknamePlaceholder;
    bodyText.textContent = words().body; body.placeholder = words().bodyPlaceholder; trapText.textContent = words().website;
    const message = !enabled || loadState === 'unavailable' ? 'unavailable' : loadState === 'loading' ? 'loading' : loadState === 'error' ? 'loadError' : !comments.length ? 'empty' : '';
    loadMessage.textContent = words()[message] || ''; loadMessage.hidden = !message;
    retry.textContent = words().retry; retry.hidden = !enabled || loadState !== 'error';
    const parent = comments.find(comment => comment.id === replyId && !comment.parentId);
    reply.hidden = !replyId;
    replyText.textContent = parent ? `${words().replyTo} ${parent.nickname.trim() || words().anonymous}` : replyId ? words()[['loading', 'idle'].includes(loadState) ? 'replyLoading' : 'replyUnavailable'] : '';
    cancelReply.textContent = words().cancelReply;
    count.textContent = `${Array.from(body.value || '').length} / 2000 ${words().count}`;
    submit.disabled = submitting || !enabled || Boolean(replyId && !parent) || (loggedIn && !parent); submit.textContent = submitting ? words().submitting : loggedIn ? words().ownerReply : words().submit;
    nickname.disabled = submitting || loggedIn; body.disabled = submitting; cancelReply.disabled = submitting;
    status.textContent = words()[submitState] || ''; status.hidden = !submitState;
  }
  async function load() {
    abort(); comments = []; submitState = ''; loadState = 'idle'; renderComments(); update();
    if (!isActive || !available()) return;
    const current = generation; loadController = new AbortController(); loadState = 'loading'; update();
    try {
      const result = await client.getComments({ targetType: type, targetId: id, signal: loadController.signal });
      if (destroyed || current !== generation) return;
      comments = normalizeComments(result); loadState = 'loaded'; renderComments();
    } catch (error) {
      if (destroyed || current !== generation || error?.name === 'AbortError') return;
      loadState = error?.code === 'comments_unavailable' ? 'unavailable' : 'error';
    } finally { if (!destroyed && current === generation) { loadController = null; update(); } }
  }
  async function send(event) {
    event.preventDefault();
    if (destroyed || submitting || !isActive || !available()) return;
    const parent = comments.find(comment => comment.id === replyId && !comment.parentId);
    if ((replyId && !parent) || (ownerMode() && !parent)) { update(); return; }
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
      if (publishedReply) { comments = normalizeComments([...comments, result.comment]); renderComments(); }
      body.value = ''; website.value = ''; replyId = null; submitState = publishedReply ? 'ownerSent' : 'pending'; saveDraft();
    } catch (error) {
      if (destroyed || current !== generation || error?.name === 'AbortError') return;
      submitState = error?.status === 429 ? 'rateLimited' : error?.code === 'comments_unavailable' ? 'unavailable' : 'submitError';
    } finally { if (!destroyed && current === generation) { submitting = false; submitController = null; update(); } }
  }
  function setService(next) {
    unsubscribe(); client = next;
    unsubscribe = typeof client?.subscribe === 'function' ? client.subscribe(() => { void load(); }) : () => {};
    void load();
  }
  bind(form, 'submit', send);
  bind(body, 'input', () => { saveDraft(); update(); }); bind(nickname, 'input', saveDraft);
  bind(cancelReply, 'click', () => { replyId = null; saveDraft(); update(); });
  bind(retry, 'click', () => { void load(); });
  setService(service);
  return {
    get draft() { return { body: body.value || '', nickname: nickname.value || '', website: website.value || '', replyId }; },
    setDraft(next) { if (destroyed || !next) return; body.value = typeof next.body === 'string' ? next.body : ''; nickname.value = typeof next.nickname === 'string' ? next.nickname : ''; website.value = typeof next.website === 'string' ? next.website : ''; replyId = typeof next.replyId === 'string' ? next.replyId : null; saveDraft(); update(); },
    setTarget(nextType, nextId) {
      if (destroyed) return;
      if (nextType && typeof nextType === 'object') { nextId = nextType.targetId; nextType = nextType.targetType; }
      const next = nextId === null || nextId === undefined ? null : String(nextId);
      if (nextType === type && next === id) return;
      saveDraft(); type = nextType; id = next; restoreDraft(); void load();
    },
    setLanguage(next) { if (destroyed) return; locale = next === 'ja' ? 'ja' : 'zh'; renderComments(); update(); },
    setCopy(next) { if (destroyed) return; dictionary = normalizeCommentsCopy(next); renderComments(); update(); },
    setService(next) { if (!destroyed) setService(next); },
    setActive(next) { if (destroyed || Boolean(next) === isActive) return; saveDraft(); isActive = Boolean(next); if (isActive) void load(); else { abort(); loadState = 'idle'; update(); } },
    destroy() { if (destroyed) return; destroyed = true; abort(); unsubscribe(); bindings.splice(0).forEach(remove => remove()); drafts.clear(); container.replaceChildren(); },
  };
}
