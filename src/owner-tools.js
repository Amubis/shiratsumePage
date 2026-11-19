const localized = (value, locale = 'zh') => typeof value === 'string' ? value : value?.[locale] || value?.zh || value?.ja || '';

/** Sessions are intentionally usable only by the site that owns their cookie. */
export function sameOriginOwnerApi(runtime, pageURL) {
  try {
    const page = new URL(pageURL), api = new URL(runtime?.apiBaseUrl || '/', page);
    if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.origin !== page.origin || page.searchParams.has('editor-preview')) return null;
    return api.origin;
  } catch { return null; }
}

export function createOwnerApi({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = 'GET', body, csrfToken, signal } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrfToken ? { 'X-Garden-CSRF': csrfToken } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data; try { data = await response.json(); } catch { throw Object.assign(new Error('服务暂时无法读取，请稍后重试。'), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error.slice(0, 250) : '操作未完成，请稍后重试。'), { status: response.status });
    return data;
  }
  return {
    session: options => request('/api/admin/session', options),
    login: (username, password) => request('/api/admin/login', { method: 'POST', body: { username, password } }),
    logout: csrfToken => request('/api/admin/logout', { method: 'POST', csrfToken }),
    save: (change, csrfToken) => request('/api/admin/live-content', { method: 'PATCH', body: change, csrfToken }),
  };
}

/** Small owner controls enhance the same-origin public site after normal login. */
export function createOwnerTools({ root, getContent = () => ({}), getLanguage = () => 'zh', onPublished = () => {}, onSession = () => {}, fetchImpl = globalThis.fetch, pageURL } = {}) {
  if (!root?.ownerDocument) throw new TypeError('An owner tools root is required.');
  const doc = root.ownerDocument, win = doc.defaultView;
  const url = pageURL || win.location?.href || globalThis.location?.href;
  const bindings = [], buttons = new Set(), entryVisibility = new Map();
  let api = null, base = null, session = { authenticated: false }, destroyed = false, authBusy = false, dialogBusy = false;
  let observer = null, scheduled = false, refreshSequence = 0, lastFocusRefresh = 0, opener = null;
  const zh = () => getLanguage() !== 'ja';
  const text = (chinese, japanese) => zh() ? chinese : japanese;
  const create = (tag, className, value) => { const node = doc.createElement(tag); node.className = className; if (value !== undefined) node.textContent = value; return node; };
  const write = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const bind = (node, type, handler, options) => { if (!node?.addEventListener) return; node.addEventListener(type, handler, options); bindings.push(() => node.removeEventListener(type, handler, options)); };
  const button = (className, value) => { const node = create('button', className, value); node.type = 'button'; return node; };
  const name = () => localized(getContent()?.owner?.name, getLanguage()).trim().slice(0, 40) || 'Amubis';
  const actions = create('div', 'owner-profile-actions owner-tools-ui'); actions.hidden = true;
  const manage = create('a', 'owner-tools-manage'); manage.href = './admin/'; manage.target = '_blank'; manage.rel = 'noopener';
  const logout = button('owner-tools-logout');
  const notice = create('span', 'owner-tools-notice owner-tools-ui'); notice.setAttribute('role', 'status');
  actions.append(manage, logout); root.append(notice);
  const dialog = create('dialog', 'owner-tools-dialog owner-tools-ui');
  const close = button('owner-tools-close', '×');
  const heading = create('h2', 'owner-tools-heading');
  const form = create('form', 'owner-tools-form');
  const fields = create('div', 'owner-tools-fields');
  const message = create('p', 'owner-tools-status'); message.setAttribute('role', 'status');
  const save = create('button', 'owner-tools-save'); save.type = 'submit';
  form.append(fields, message, save); dialog.append(close, heading, form); root.append(dialog);
  let submitForm = null, dialogKind = 'login';

  function setSession(value) {
    session = value?.authenticated === true && value.csrfToken ? { ...value, authenticated: true, username: name() } : { authenticated: false };
    onSession({ ...session }); update();
  }
  function update() {
    if (destroyed) return;
    for (const entry of buttons) if (entry.isConnected === false) buttons.delete(entry);
    const card = root.querySelector('.owner-card'), entry = card?.querySelector('.owner-admin-link');
    if (card && actions.parentElement !== card) card.append(actions);
    const authenticated = Boolean(api && session.authenticated);
    if (card && card.classList.contains('has-owner-session') !== authenticated) card.classList.toggle('has-owner-session', authenticated);
    actions.hidden = !authenticated;
    write(manage, text('管理页', '管理ページ')); write(logout, text('退出登录', 'ログアウト'));
    manage.href = entry?.href || new URL('./admin/', url).href;
    if (entry) {
      if (api) {
        if (!entryVisibility.has(entry)) entryVisibility.set(entry, Boolean(entry.hidden));
        entry.hidden = authenticated;
        entry.setAttribute('role', 'button');
        const label = text('站长登录', '管理者ログイン'); entry.setAttribute('aria-label', label); entry.title = label;
      } else {
        if (entryVisibility.has(entry)) { entry.hidden = entryVisibility.get(entry); entryVisibility.delete(entry); }
        entry.removeAttribute('role');
      }
    }
    close.setAttribute('aria-label', text('关闭', '閉じる'));
    for (const node of doc.querySelectorAll('.album-player[data-photo-id], .personal-journal-post[data-journal-id]')) {
      const photo = node.classList.contains('album-player'), id = node.getAttribute(photo ? 'data-photo-id' : 'data-journal-id');
      const target = photo ? node.querySelector('.album-player-stage') : node;
      if (!target) continue;
      let edit = target.querySelector(photo ? '.owner-photo-edit' : '.owner-note-edit');
      if (!edit) {
        edit = button(`owner-inline-edit owner-tools-ui ${photo ? 'owner-photo-edit' : 'owner-note-edit'}`);
        edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15.6 3.8 4.6 4.6-1.4 1.4-4.6-4.6Zm-2.8 2.8 4.6 4.6-9 9H3.8v-4.6Z"/></svg>';
        edit.addEventListener('click', () => openEditor(edit.dataset.ownerType, edit.dataset.ownerId, edit));
        target.append(edit); buttons.add(edit);
      }
      edit.hidden = !session.authenticated || !id;
      const type = photo ? 'photo' : 'journal';
      if (edit.dataset.ownerType !== type) edit.dataset.ownerType = type;
      if (edit.dataset.ownerId !== id) edit.dataset.ownerId = id;
      const label = photo ? text('编辑照片说明', '写真の説明を編集') : text('编辑碎碎念', 'ひとりごとを編集');
      edit.setAttribute('aria-label', label); edit.title = label;
      if (!photo && node.classList.contains('owner-editable-note') !== !edit.hidden) node.classList.toggle('owner-editable-note', !edit.hidden);
    }
  }
  function scheduleUpdate() {
    if (scheduled || destroyed) return;
    scheduled = true;
    Promise.resolve().then(() => { scheduled = false; update(); });
  }
  async function refresh() {
    if (destroyed || !api || authBusy) return;
    const sequence = ++refreshSequence;
    try { const value = await api.session(); if (!destroyed && sequence === refreshSequence) setSession(value); }
    catch { if (!destroyed && sequence === refreshSequence) setSession(null); }
  }
  function closeDialog(immediate = false) {
    if (dialogBusy && !immediate) return;
    if (!dialog.open) return;
    const finish = () => {
      if (dialog.open) dialog.close(); doc.body.classList.remove('owner-dialog-open');
      const target = opener && opener.isConnected !== false && !opener.hidden ? opener : session.authenticated && !actions.hidden ? manage : root.querySelector('.owner-admin-link') || root.querySelector('.owner-avatar');
      target?.focus?.({ preventScroll: true }); opener = null;
    };
    if (immediate || !dialog.animate || win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) finish();
    else dialog.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.97' }], { duration: 160, easing: 'cubic-bezier(.4,0,.6,1)' }).finished.then(finish, finish);
  }
  function openDialog(title, submitLabel, origin) {
    opener = origin || doc.activeElement; heading.textContent = title; save.textContent = submitLabel; message.textContent = ''; fields.replaceChildren();
    if (!dialog.open) dialog.showModal(); doc.body.classList.add('owner-dialog-open');
  }
  function field(label, input) { const row = create('label', 'owner-tools-field'); row.append(create('span', '', label), input); fields.append(row); return input; }
  function openLogin(origin) {
    if (!api || destroyed) return;
    dialogKind = 'login';
    openDialog(text('站长登录', '管理者ログイン'), text('登录', 'ログイン'), origin);
    const username = field(text('账号', 'アカウント'), create('input', 'owner-tools-username')); username.autocomplete = 'username'; username.value = 'Amubis'; username.required = true;
    const password = field(text('密码', 'パスワード'), create('input', 'owner-tools-password')); password.type = 'password'; password.autocomplete = 'current-password'; password.required = true;
    submitForm = async () => {
      authBusy = true; ++refreshSequence;
      try { const value = await api.login(username.value, password.value); if (destroyed) return; if (!value?.authenticated || !value.csrfToken) throw new Error(text('登录未完成。', 'ログインできませんでした。')); setSession(value); notice.textContent = text('已登录，可直接编辑和回复。', 'ログインしました。編集と返信ができます。'); closeDialog(true); }
      finally { password.value = ''; authBusy = false; }
    };
    password.focus();
  }
  function openEditor(type, id, origin) {
    if (!session.authenticated || !api) return;
    const content = getContent(), record = (type === 'photo' ? content.media : content.journal)?.find(item => item.id === id);
    if (!record) return;
    dialogKind = 'edit';
    const locale = zh() ? 'zh' : 'ja';
    openDialog(type === 'photo' ? text('编辑照片说明', '写真の説明を編集') : text('编辑碎碎念', 'ひとりごとを編集'), text('保存并更新网站', '保存してサイトを更新'), origin);
    let title = null, body = null, captions = null;
    if (type === 'photo') {
      captions = {};
      for (const [captionLocale, label] of [['zh', text('照片说明 · 中文', '写真の説明 · 中文')], ['ja', text('照片说明 · 日本語', '写真の説明 · 日本語')]]) {
        const input = field(label, create('textarea', `owner-tools-body owner-tools-caption-${captionLocale}`));
        input.rows = 4; input.maxLength = 5000; input.name = `caption_${captionLocale}`;
        input.setAttribute('lang', captionLocale === 'zh' ? 'zh-CN' : 'ja');
        // A missing translation stays blank instead of borrowing the other
        // language and accidentally saving it as an existing translation.
        input.value = typeof record.caption === 'string' ? captionLocale === 'zh' ? record.caption : '' : typeof record.caption?.[captionLocale] === 'string' ? record.caption[captionLocale] : '';
        captions[captionLocale] = input;
      }
    } else {
      title = field(text('标题（选填）', 'タイトル（任意）'), create('input', 'owner-tools-title')); title.value = localized(record.title, locale); title.maxLength = 500;
      body = field(text('正文', '本文'), create('textarea', 'owner-tools-body')); body.rows = 9; body.value = localized(record.body, locale); body.maxLength = 50000;
    }
    submitForm = async () => {
      const change = type === 'photo'
        ? { targetType: type, targetId: id, patch: { caption: { zh: captions.zh.value, ja: captions.ja.value } } }
        : { targetType: type, targetId: id, locale, patch: { title: title.value, body: body.value } };
      const result = await api.save(change, session.csrfToken);
      if (destroyed) return;
      if (!result?.content) throw new Error(text('保存结果暂时无法读取，请刷新确认。', '保存結果を確認できません。再読み込みしてください。'));
      onPublished(result.content); update();
      if (opener?.isConnected === false) opener = Array.from(doc.querySelectorAll('.owner-inline-edit')).find(entry => entry.dataset.ownerType === type && entry.dataset.ownerId === id) || null;
      notice.textContent = text('已更新网站。', 'サイトを更新しました。'); closeDialog(true); scheduleUpdate();
    };
    (captions?.[locale] || body).focus();
  }
  bind(form, 'submit', async event => {
    event.preventDefault(); if (dialogBusy || !submitForm) return;
    dialogBusy = true; save.disabled = true; message.textContent = '';
    try { await submitForm(); }
    catch (error) { message.textContent = error?.status === 401 ? dialogKind === 'login' ? text('账号或密码不正确。', 'アカウント名またはパスワードが違います。') : text('登录已失效，请重新登录。', 'ログインの有効期限が切れました。') : error.message || text('操作未完成，请重试。', '操作を完了できませんでした。'); if (error?.status === 401) setSession(null); }
    finally { dialogBusy = false; save.disabled = false; }
  });
  bind(close, 'click', () => closeDialog()); bind(dialog, 'cancel', event => { event.preventDefault(); closeDialog(); }); bind(dialog, 'click', event => { if (event.target === dialog) closeDialog(); });
  bind(root, 'click', event => {
    const entry = event.target.closest?.('.owner-admin-link');
    if (entry && api && !session.authenticated) { event.preventDefault(); openLogin(entry); }
  });
  bind(root, 'keydown', event => {
    const entry = event.target.closest?.('.owner-admin-link');
    if (event.key === ' ' && entry && api && !session.authenticated) { event.preventDefault(); openLogin(entry); }
  });
  bind(logout, 'click', async () => {
    if (!api || authBusy) return; authBusy = true; ++refreshSequence;
    try { await api.logout(session.csrfToken); setSession(null); notice.textContent = ''; closeDialog(true); }
    catch { notice.textContent = text('暂时无法退出，请重试。', 'ログアウトできませんでした。再度お試しください。'); }
    finally { authBusy = false; }
  });
  const onFocus = () => { if (Date.now() - lastFocusRefresh < 1500 || doc.hidden) return; lastFocusRefresh = Date.now(); void refresh(); };
  bind(win, 'focus', onFocus); bind(doc, 'visibilitychange', () => { if (!doc.hidden) onFocus(); });
  if (typeof win.MutationObserver === 'function') {
    observer = new win.MutationObserver(records => { if (!records.every(record => record.target.closest?.('.owner-tools-ui'))) scheduleUpdate(); });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-photo-id', 'data-journal-id', 'class'] });
  }
  return {
    setRuntime(runtime) { const next = sameOriginOwnerApi(runtime, url); if (next === base) return; base = next; api = base ? createOwnerApi({ baseUrl: base, fetchImpl }) : null; ++refreshSequence; setSession(null); if (api) void refresh(); },
    refresh, setLanguage() { update(); },
    get session() { return { ...session }; },
    destroy() { if (destroyed) return; destroyed = true; ++refreshSequence; observer?.disconnect(); bindings.splice(0).forEach(remove => remove()); closeDialog(true); buttons.forEach(node => node.remove()); for (const [entry, hidden] of entryVisibility) { entry.hidden = hidden; entry.removeAttribute('role'); } entryVisibility.clear(); root.querySelectorAll('.owner-card').forEach(card => card.classList.remove('has-owner-session')); actions.remove(); notice.remove(); dialog.remove(); doc.body.classList.remove('owner-dialog-open'); onSession({ authenticated: false }); },
  };
}
