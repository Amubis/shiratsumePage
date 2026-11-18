import { extractPhotoMetadata } from '../src/photo-metadata.js';
import { normalizeGardenContent, validateGardenContent, publicGardenContent } from '../src/garden-content.js';
import { EDITOR_COPY_SECTIONS, editorCopySection, readEditorCopy, writeEditorCopy } from '../src/editor-copy-fields.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'garden-admin-json-draft-v1';
const MODE_KEY = 'garden-admin-service-mode-v1';
const COHORT_KEY = 'shiratsume-admin-session-additions-v1';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const sections = [
  ['overview', '⌂', '管理概览'], ['texts', '文', '页面文案'], ['owner', '◉', '作者资料'],
  ['outfits', '♧', '服装展示'], ['photos', '▧', '照片相册'], ['journal', '✎', '碎碎念'], ['messages', '◌', '消息中心'], ['settings', '⚙', '连接与备份'],
];
const state = {
  content: null, revision: null, authenticated: false, connected: false, session: null,
  csrf: '', mediaBaseUrl: '', cloudAdminUrl: '', dirty: false, conflict: false, busy: false, section: 'overview',
  selectedOutfit: null, selectedPhoto: null, selectedPost: null, selectedPhotos: new Set(), photoEditSequence: [],
  photoFilter: 'published', photoSearch: '', textGroup: 'navigation', textLanguage: 'zh', textSearch: '',
  photoCohort: 'all', journalCohort: 'all', additions: { media: new Set(), journal: new Set() },
  jobs: [], running: 0, preview: false, localBackup: null, cloudMode: false,
  comments: [], notifications: [], unreadCount: 0, pendingCount: 0, messageView: 'comments', messageStatus: 'pending', messageUnread: false, messagesBusy: false, messagesLoaded: false, messagesError: '', replyDrafts: {},
};
let uid = 0, localTimer, previewTimer, toastTimer, contentEpoch = 0, viewLocked = false;
let photoEditorDialog = null, photoEditorOpener = null, photoEditorClosing = false, photoEditorMotion = null;
const activeUploads = new Set();
const previewToken = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const identifier = (prefix) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${++uid}`}`;
const cloudLocked = () => (state.cloudMode || state.session?.mode === 'cloud') && (!state.connected || !state.authenticated);
const staleRequest = () => Object.assign(new Error('请重新登录后继续。'), { stale: true });
function cohortIds(kind) {
  state.additions ||= {};
  return state.additions[kind] ||= new Set();
}
function cohortSnapshot() {
  return { media: [...cohortIds('media')], journal: [...cohortIds('journal')] };
}
function persistCohort() {
  try { sessionStorage.setItem(COHORT_KEY, JSON.stringify(cohortSnapshot())); } catch { /* Labels still work in this editor window. */ }
}
function restoreCohort(value) {
  for (const kind of ['media', 'journal']) {
    for (const id of Array.isArray(value?.[kind]) ? value[kind] : []) if (typeof id === 'string') cohortIds(kind).add(id);
  }
}
function markCreated(kind, id) {
  cohortIds(kind).add(id); persistCohort();
}
function matchesCohort(kind, item, filter = 'all') {
  return filter === 'all' || cohortIds(kind).has(item.id) === (filter === 'new');
}
function cohortBadge(kind, item) {
  const added = cohortIds(kind).has(item.id);
  return node('span', { class: `content-cohort-badge${added ? ' is-new' : ''}` }, added ? '本次新增' : kind === 'media' ? '已有照片' : '已有记录');
}
function cohortTabs(kind, items) {
  const key = kind === 'media' ? 'photoCohort' : 'journalCohort', added = items.filter(item => cohortIds(kind).has(item.id)).length;
  return node('div', { class: 'content-cohort-tabs', role: 'group', 'aria-label': kind === 'media' ? '照片新增分类' : '碎碎念新增分类' },
    ...[['all', '全部', items.length], ['existing', kind === 'media' ? '已有照片' : '已有记录', items.length - added], ['new', '本次新增', added]].map(([value, label, count]) =>
      button([label, node('span', { class: 'content-cohort-count' }, count)], () => { state[key] = value; render(); }, `content-cohort-tab${(state[key] || 'all') === value ? ' active' : ''}`, { 'aria-pressed': String((state[key] || 'all') === value) })));
}
function recordSession(session) {
  state.session = session;
  if (session.mode === 'cloud') state.cloudMode = true;
  else if (session.mode === 'local') state.cloudMode = false;
  try { if (state.cloudMode) localStorage.setItem(MODE_KEY, 'cloud'); else localStorage.removeItem(MODE_KEY); } catch { /* Mode is only a local display safeguard. */ }
}
function lockPrivateView() {
  if (!viewLocked) { viewLocked = true; contentEpoch++; }
  clearTimeout(localTimer); clearTimeout(previewTimer);
  if ($('#confirm-dialog').open) $('#confirm-dialog').close('cancel');
  closePhotoEditor({ immediate: true, refreshGrid: false });
  $('#dialog-title').textContent = ''; $('#dialog-body').textContent = '';
  clearTimeout(toastTimer); $('#toast').hidden = true; $('#toast').textContent = '';
  state.preview = false; $('#preview-pane').hidden = true; $('.content-layout').classList.remove('with-preview');
  $('#site-preview').removeAttribute('src'); $('#preview-toggle').textContent = '打开预览';
  $('#upload-panel').hidden = true; $('#upload-list').replaceChildren();
  for (const xhr of activeUploads) xhr.abort();
  $('#editor').replaceChildren(empty('请登录后管理内容', state.connected ? '使用管理员账号和密码登录后，才能查看草稿与管理消息。' : '云端管理连接已中断，重新连接并登录后可继续。', ...(!state.connected ? [button('重新连接', connect)] : [])));
}
function clearPrivateContent() {
  contentEpoch++; clearTimeout(localTimer); clearTimeout(previewTimer);
  for (const xhr of activeUploads) xhr.abort(); activeUploads.clear();
  state.content = null; state.revision = null; state.localBackup = null; state.dirty = false; state.conflict = false; state.busy = false;
  state.selectedOutfit = state.selectedPhoto = state.selectedPost = null; state.selectedPhotos.clear(); state.photoEditSequence = [];
  state.additions = { media: new Set(), journal: new Set() }; state.photoCohort = state.journalCohort = 'all';
  state.photoSearch = state.textSearch = ''; state.jobs = []; state.running = 0;
  state.comments = []; state.notifications = []; state.replyDrafts = {}; state.unreadCount = state.pendingCount = 0;
  state.messagesLoaded = false; state.messagesError = ''; messagesRequest++;
  $('#json-import').value = '';
  try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(COHORT_KEY); } catch { /* The page still drops all in-memory references. */ }
  lockPrivateView();
}

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'multiple') element[key] = value;
    else if (key === 'value') element.value = value;
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
function button(text, action, kind = 'secondary', attributes = {}) {
  return node('button', { type: 'button', class: `button ${kind}`, onclick: action, ...attributes }, text);
}
function field(label, value, change, options = {}) {
  const tag = options.multiline ? 'textarea' : options.options ? 'select' : 'input';
  const input = node(tag, {
    type: options.type || 'text', value: value ?? '', placeholder: options.placeholder,
    min: options.min, max: options.max, step: options.step,
    autocomplete: options.autocomplete || 'off', spellcheck: options.spellcheck === true ? 'true' : 'false',
    rows: options.rows, 'aria-label': label,
  });
  if (options.options) for (const [optionValue, title] of options.options) input.append(node('option', { value: optionValue }, title));
  input.value = value ?? '';
  input.addEventListener(options.options ? 'change' : 'input', () => {
    const next = options.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    change(next, input);
    changed();
  });
  return node('label', { class: `field ${options.class || ''}` }, node('span', {}, label), input, options.help ? node('span', { class: 'help' }, options.help) : null);
}
function check(label, value, change, help = '') {
  const input = node('input', { type: 'checkbox', checked: !!value });
  input.addEventListener('change', () => { change(input.checked); changed(); });
  return node('label', { class: 'field' }, input, node('span', {}, label), help ? node('span', { class: 'help' }, help) : null);
}
function photoModelPicker(value, change, { dirty = true, disabled = false } = {}) {
  const options = [['shiratsume', 'Shiratsume'], ['milfy', 'Milfy']];
  const existing = [...new Set(Array.isArray(value) ? value : [])];
  let otherTags = existing.filter(tag => !options.some(([id]) => id === tag));
  const inputs = [];
  const update = () => {
    change([...inputs.filter(input => input.checked).map(input => input.value), ...otherTags]);
    if (dirty) changed();
  };
  const root = node('fieldset', { class: 'photo-model-field', disabled }, node('legend', {}, '模型标签'));
  const choices = node('div', { class: 'photo-model-options' });
  for (const [id, label] of options) {
    const input = node('input', { type: 'checkbox', value: id, checked: existing.includes(id) });
    input.addEventListener('change', update); inputs.push(input);
    choices.append(node('label', { class: 'photo-model-option' }, input, label));
  }
  root.append(choices, node('span', { class: 'help' }, '可多选；不选择模型的照片仍会显示在「全部照片」。'));
  if (otherTags.length) {
    const legacy = node('div', { class: 'photo-model-legacy' }, node('span', {}, `其他已有标签：${otherTags.join('、')}`));
    legacy.append(button('移除其他标签', () => { otherTags = []; legacy.hidden = true; update(); }, 'secondary small'));
    root.append(legacy);
  }
  return root;
}
function intro(title, description, ...actions) {
  return node('div', { class: 'section-intro' }, node('div', {}, node('h2', {}, title), node('p', {}, description)), actions.length ? node('div', { class: 'section-actions' }, actions) : null);
}
function panel(...children) { return node('section', { class: 'panel' }, children); }
function empty(title, description, ...actions) {
  return node('div', { class: 'empty' }, node('span', { class: 'clover', 'aria-hidden': 'true' }, '✤'), node('h3', {}, title), node('p', {}, description), actions);
}
function toast(message, error = false) {
  const target = $('#toast'); target.textContent = message; target.classList.toggle('error', error); target.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { target.hidden = true; }, error ? 8000 : 4500);
}
function banner(message, error = false, action) {
  $('#banner').replaceChildren(node('span', {}, message), ...(action ? [button(action.label, action.run, 'secondary small')] : []));
  $('#banner').classList.toggle('error', error); $('#banner').hidden = false; appendCloudAdminEntry();
}
async function confirmAction(title, message, label = '确认') {
  $('#dialog-title').textContent = title; $('#dialog-body').textContent = message; $('#dialog-confirm').textContent = label;
  const dialog = $('#confirm-dialog');
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}
function safeImageUrl(reference) {
  if (typeof reference !== 'string' || !reference.trim() || /[\u0000-\u001f\u007f\\]/.test(reference)) return '';
  const value = reference.trim();
  if (/^media\//.test(value)) return `${(state.content?.settings?.mediaBaseUrl || state.mediaBaseUrl || location.origin).replace(/\/$/, '')}/${value}`;
  if (/^(?:\.\/)?assets\//.test(value)) return new URL(value.replace(/^\.\//, ''), new URL('../', location.href)).href;
  try {
    const url = new URL(value, location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function image(reference, alt, className) {
  const source = safeImageUrl(reference);
  const img = node('img', { alt: alt || '', class: className, loading: 'lazy', decoding: 'async' });
  if (source) img.src = source;
  img.addEventListener('error', () => { img.classList.add('image-unavailable'); img.alt = alt ? `${alt}（图片暂不可用）` : '图片暂不可用'; }, { once: true });
  return img;
}
function navigation() {
  $('#navigation').replaceChildren(...sections.map(([key, icon, label]) => {
    const amount = cloudLocked() ? undefined : key === 'photos' ? state.content?.media?.length : key === 'outfits' ? state.content?.outfits?.length : key === 'journal' ? state.content?.journal?.length : key === 'messages' ? `${state.unreadCount}未读\n${state.pendingCount}待审` : undefined;
    return node('button', { type: 'button', class: `nav-button${state.section === key ? ' active' : ''}`, 'aria-current': state.section === key ? 'page' : undefined, onclick: () => selectSection(key) }, node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), label, amount !== undefined ? node('span', { class: 'nav-count' }, amount) : null);
  }));
}
function selectSection(key) {
  state.section = key; state.selectedPhoto = null; state.photoEditSequence = []; navigation(); render();
  if (key === 'messages') refreshMessages();
  $('#page-title').textContent = sections.find(([name]) => name === key)?.[2] || '管理概览';
  if (state.preview) setPreviewTarget(previewSection());
  if (window.innerWidth < 850) $('#editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function changed() {
  if (cloudLocked()) return;
  state.dirty = true; updateChrome();
  clearTimeout(localTimer); localTimer = setTimeout(persistLocal, 500);
  clearTimeout(previewTimer); previewTimer = setTimeout(postPreview, 250);
}
function persistLocal() {
  if (!state.content || cloudLocked()) return;
  try {
    // Draft JSON and local organizing labels only; no passwords, cookies, CSRF tokens, blobs or File objects.
    const backup = { content: clone(state.content), revision: state.revision, savedAt: new Date().toISOString(), mode: state.session?.mode || (state.cloudMode ? 'cloud' : 'static'), cohort: cohortSnapshot() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backup)); state.localBackup = backup;
  } catch { toast('浏览器草稿备份空间不足，请导出 JSON 保存当前编辑。', true); }
}
function updateChrome() {
  const locked = cloudLocked();
  if (locked) lockPrivateView(); else viewLocked = false;
  const uploadsActive = state.jobs.some(job => ['queued', 'running'].includes(job.status));
  $('#connection-label').textContent = state.connected ? state.authenticated ? (state.session?.mode === 'cloud' ? '云端已连接' : '本地服务已连接') : '等待登录' : locked ? '云端未连接 · 已锁定' : '未连接 API · 仅本地编辑';
  $('#connection-dot').classList.toggle('online', state.connected && state.authenticated);
  $('#logout').hidden = locked || !state.authenticated || state.session?.mode === 'local';
  const label = locked ? '登录后管理' : !state.content ? '尚未载入' : state.conflict ? '版本冲突 · 请重新载入' : state.busy ? '正在处理…' : state.dirty ? '有未保存的编辑' : state.connected && state.authenticated ? '草稿已同步' : '仅浏览器草稿';
  $('#save-state').textContent = label; $('#save-state').classList.toggle('dirty', state.dirty || state.conflict);
  $('#save-draft').disabled = !state.content || !state.authenticated || !state.connected || state.busy || state.conflict || uploadsActive;
  $('#publish').disabled = !state.content || !state.authenticated || !state.connected || state.busy || state.conflict || state.dirty || uploadsActive;
  const photoSave = $('#photo-editor-save');
  if (photoSave) { photoSave.disabled = $('#save-draft').disabled; photoSave.textContent = state.busy ? '正在保存…' : '保存草稿'; }
  const photoSaveState = $('#photo-editor-save-state');
  if (photoSaveState) photoSaveState.textContent = label;
  $('#preview-toggle').disabled = locked || !state.content;
  $('#json-import').disabled = locked;
  let ownerHome = $('#owner-home-entry');
  if (!ownerHome && $('.topbar-actions')) {
    ownerHome = node('a', { id: 'owner-home-entry', class: 'button secondary', href: '../?owner=1', target: '_blank', rel: 'noopener' }, '打开站长主页');
    $('.topbar-actions').append(ownerHome);
  }
  if (ownerHome) ownerHome.hidden = locked || !state.connected || !state.authenticated;
  navigation();
}
async function api(path, { method = 'GET', body, csrf = method !== 'GET' } = {}) {
  const epoch = contentEpoch;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-Garden-CSRF'] = state.csrf;
  let response;
  try { response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' }); }
  catch { if (epoch !== contentEpoch) throw staleRequest(); const error = new Error('无法连接同源管理 API。请确认管理服务正在运行。'); error.offline = true; throw error; }
  const type = response.headers.get('Content-Type') || '';
  let data;
  try { if (!type.includes('json')) throw new Error('not-json'); data = await response.json(); }
  catch { if (epoch !== contentEpoch) throw staleRequest(); const error = new Error('此地址尚未连接管理 API，当前只能在浏览器编辑与导出 JSON。'); error.offline = true; throw error; }
  if (epoch !== contentEpoch) throw staleRequest();
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `请求失败（${response.status}）`);
    error.status = response.status; error.details = data; throw error;
  }
  return data;
}
function reportError(error, context = '') {
  if (error.stale) return;
  if (error.status === 409) {
    state.conflict = true;
    banner('草稿已被另一个窗口修改。当前编辑已保留在浏览器；请先导出备份，再重新载入服务端草稿。为避免覆盖他人编辑，保存和发布已暂停。', true, { label: '导出当前 JSON', run: exportJSON });
  } else if (error.status === 401 || error.status === 403) {
    state.authenticated = false; state.csrf = ''; showAuth();
    banner(`登录或会话验证已失效。当前编辑仍保留，请重新登录后重新载入草稿。${error.message ? ` ${error.message}` : ''}`, true);
  } else {
    toast(`${context}${error.message}`, true);
    if (error.offline) { state.connected = false; if (state.cloudMode) state.authenticated = false; banner(state.cloudMode ? '云端管理连接已中断。当前页面已锁定，请重新连接并登录后继续。' : '管理 API 未连接。当前编辑仅保存在此浏览器；可以导出 JSON 备份，线上网站尚未更改。', true); }
  }
  updateChrome();
}
function installContent(input, revision = null) {
  if (cloudLocked()) return;
  clearTimeout(localTimer);
  state.content = normalizeGardenContent(input); state.revision = revision; state.dirty = false; state.conflict = false;
  state.selectedPhotos.clear(); state.selectedPhoto = null; state.photoEditSequence = []; state.selectedOutfit = null; state.selectedPost = null;
  updateChrome(); render(); postPreview();
}
async function loadContent({ discard = false } = {}) {
  if (cloudLocked()) return;
  if (state.jobs.some(job => ['queued', 'running'].includes(job.status))) { toast('请等待当前导入任务完成，再重新载入内容。', true); return; }
  if (!discard && state.dirty && !await confirmAction('重新载入草稿？', '此操作会用服务端草稿替换当前编辑。你可以先导出 JSON 备份。', '重新载入')) return;
  try {
    const result = await api('/api/admin/content');
    state.mediaBaseUrl = result.mediaBaseUrl || state.session?.mediaBaseUrl || '';
    if (state.dirty) persistLocal();
    installContent(result.content, result.revision); $('#banner').hidden = true;
    offerBackup(); toast('已载入最新草稿。');
  } catch (error) { reportError(error); }
}
function offerBackup() {
  if (cloudLocked()) return;
  const backup = state.localBackup;
  if (!backup?.content || JSON.stringify(backup.content) === JSON.stringify(state.content)) return;
  banner(`发现此浏览器保存的编辑备份（${formatDate(backup.savedAt)}）。恢复后需再次保存到服务端。`, false, { label: '查看恢复选项', run: restoreBackup });
}
async function restoreBackup() {
  if (cloudLocked() || !state.localBackup?.content) return;
  if (!await confirmAction('恢复浏览器草稿？', '恢复会替换当前编辑。服务端草稿仍保持原样；恢复后请检查内容，再点击「保存草稿」。', '恢复编辑')) return;
  if (cloudLocked()) return;
  const revision = state.revision;
  restoreCohort(state.localBackup.cohort);
  for (const kind of ['media', 'journal']) {
    const existing = new Set((state.content?.[kind] || []).map(item => item.id));
    for (const item of state.localBackup.content[kind] || []) if (!existing.has(item.id)) cohortIds(kind).add(item.id);
  }
  persistCohort();
  installContent(state.localBackup.content, revision); changed(); $('#banner').hidden = true; toast('已恢复浏览器编辑，请检查后保存。');
}
async function connect() {
  try {
    const session = await api('/api/admin/session');
    state.connected = true; recordSession(session); state.authenticated = !!session.authenticated; state.csrf = session.csrfToken || ''; state.mediaBaseUrl = session.mediaBaseUrl || '';
    showAuth(); updateChrome();
    if (state.authenticated) {
      if (state.content && state.dirty) { state.conflict = true; render(); banner('连接已恢复。浏览器编辑仍在，请先导出备份，再载入服务端草稿以检查版本。', false, { label: '重新载入', run: () => loadContent() }); }
      else await loadContent({ discard: true });
      refreshMessages({ quiet: true });
    }
    else {
      if (!session.configured) banner('云端管理尚未配置登录密钥与存储绑定。请完成服务端配置后重新连接并登录。', true);
      await loadSeed();
    }
  } catch (error) {
    if (error.stale) return;
    state.connected = false; state.authenticated = false; state.csrf = ''; showAuth();
    banner(state.cloudMode ? '云端管理暂时无法连接。请重新连接并登录后继续。' : '这个站点尚未连接管理 API。可以编辑打包内容并导出 JSON；上传、保存服务端草稿和发布需要同源的本地或云端管理服务。', false, { label: '重新连接', run: connect });
    await loadSeed();
  }
  updateChrome();
}
async function loadSeed() {
  if (cloudLocked()) { lockPrivateView(); return; }
  if (state.content) return;
  try {
    const response = await fetch('../data/garden.json', { cache: 'no-store' });
    if (cloudLocked()) return;
    if (!response.ok) throw new Error('没有打包内容');
    installContent(await response.json()); offerBackup();
  } catch {
    if (cloudLocked()) { lockPrivateView(); return; }
    if (state.localBackup?.content) { restoreCohort(state.localBackup.cohort); installContent(state.localBackup.content); state.dirty = true; updateChrome(); toast('已打开浏览器里的 JSON 草稿。'); }
    else {
      $('#editor').replaceChildren(empty('还没有可编辑的内容', '连接管理 API，或导入先前导出的内容 JSON 备份。', button('导入 JSON', () => $('#json-import').click())));
    }
  }
}
function showAuth() {
  const target = $('#auth-panel');
  target.hidden = !state.connected || state.authenticated;
  if (target.hidden) return;
  const username = node('input', { type: 'text', name: 'username', autocomplete: 'username', maxlength: 120, required: true, 'aria-label': '管理员账号' });
  const password = node('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, 'aria-label': '管理员密码' });
  const submit = node('button', { type: 'submit', class: 'button primary', disabled: state.session?.configured === false }, '登录管理');
  const form = node('form', { class: 'auth-form' }, node('label', { class: 'field' }, node('span', {}, '管理员账号'), username), node('label', { class: 'field' }, node('span', {}, '管理员密码'), password), submit);
  form.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      const session = await api('/api/admin/login', { method: 'POST', body: { username: username.value, password: password.value }, csrf: false });
      password.value = ''; recordSession(session); state.authenticated = !!session.authenticated; state.csrf = session.csrfToken || ''; state.mediaBaseUrl = session.mediaBaseUrl || ''; showAuth();
      if (state.dirty) {
        banner('已登录。当前浏览器编辑尚未关联最新服务端版本，请导出备份，再重新载入服务端草稿以继续。', false, { label: '重新载入', run: () => loadContent() });
        state.conflict = true; updateChrome(); render();
      } else await loadContent({ discard: true });
      refreshMessages({ quiet: true });
    } catch (error) {
      password.value = '';
      if (error.status === 401) toast('账号或密码不正确，请重新输入。', true);
      else reportError(error, '登录失败：');
    }
    finally { submit.disabled = state.session?.configured === false; }
  });
  target.replaceChildren(node('h2', {}, '登录内容管理'), node('p', { class: 'muted' }, '使用管理员账号和密码登录，管理草稿、上传图片与发布内容。'), form);
}
async function saveDraft() {
  if ($('#save-draft').disabled) return;
  const errors = validateGardenContent(state.content);
  if (errors.length) { showValidation(errors); return; }
  state.busy = true; updateChrome();
  const snapshot = clone(state.content), previousJSON = JSON.stringify(state.content);
  try {
    const result = await api('/api/admin/content', { method: 'PUT', body: { content: snapshot, revision: state.revision } });
    state.revision = result.revision;
    // Editing remains possible while saving. Do not overwrite keystrokes typed after the request began.
    if (JSON.stringify(state.content) === previousJSON) {
      state.content = normalizeGardenContent(result.content || snapshot); state.dirty = false;
    }
    persistLocal(); toast('草稿已保存。检查预览后，可单独发布到网站。');
  } catch (error) { reportError(error, '保存失败：'); }
  finally { state.busy = false; updateChrome(); }
}
async function publish() {
  if ($('#publish').disabled) return;
  const errors = validateGardenContent(state.content);
  if (errors.length) { showValidation(errors); return; }
  const totalPhotoCount = state.content.media.length;
  const photoCount = state.content.media.filter(item => item.enabled).length, omittedPhotoCount = totalPhotoCount - photoCount;
  const postCount = state.content.journal.filter(item => item.published).length;
  const omittedNote = omittedPhotoCount ? `另有 ${omittedPhotoCount} 张照片未纳入相册，本次不会显示。若要显示，请先在照片相册中选择它们并点击「纳入相册」，再保存草稿。` : '所有照片均已纳入相册。';
  if (!await confirmAction('将草稿发布到网站？', `相册将显示 ${photoCount} 张照片。${omittedNote}\n\n同时发布已保存的全部文案、作者资料、服装及 ${postCount} 条已勾选碎碎念。`, '确认发布')) return;
  if (cloudLocked()) return;
  state.busy = true; updateChrome();
  try {
    const result = await api('/api/admin/publish', { method: 'POST', body: { revision: state.revision } });
    if (result.published !== true) throw new Error('服务端未确认发布成功，请检查后重试。');
    if (result.revision !== undefined) state.revision = result.revision;
    const publishedPhotoCount = Array.isArray(result.content?.media) ? result.content.media.length : photoCount;
    const excludedPhotoCount = Math.max(0, totalPhotoCount - publishedPhotoCount);
    persistLocal(); toast(`发布成功：相册 ${publishedPhotoCount} 张照片，${excludedPhotoCount} 张未纳入相册。刷新已打开的网站查看。`);
  } catch (error) { reportError(error, '发布失败：'); }
  finally { state.busy = false; updateChrome(); }
}
function showValidation(errors) {
  banner(`内容尚有 ${errors.length} 项需要检查：${errors.slice(0, 4).join('；')}${errors.length > 4 ? '…' : ''}`, true);
  $('#banner').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function exportJSON() {
  if (!state.content || cloudLocked()) return;
  const blob = new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = node('a', { href: url, download: `shiratsume-content-${new Date().toISOString().slice(0, 10)}.json` });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast('已导出当前 JSON 草稿。原始图片文件不包含在 JSON 内。');
}
async function importJSON(file) {
  if (!file || cloudLocked()) return;
  if (state.jobs.some(job => ['queued', 'running'].includes(job.status))) { toast('请等待当前导入任务完成，再导入 JSON。', true); return; }
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('JSON 备份超过 5MB，请检查文件。');
    const input = JSON.parse(await file.text());
    if (cloudLocked()) return;
    const errors = validateGardenContent(input);
    if (errors.length) throw new Error(errors.slice(0, 5).join('；'));
    if (!await confirmAction('导入 JSON 草稿？', '这会替换当前编辑，但不会自动保存到服务端或发布。图片引用仍需要对应的存储服务。', '导入草稿')) return;
    if (cloudLocked()) return;
    const revision = state.revision; installContent(input, revision); changed(); toast('JSON 已导入，请检查后保存草稿。');
  } catch (error) { toast(`无法导入：${error.message}`, true); }
}
function formatDate(value) {
  if (!value) return '未填写时间';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function render() {
  if (cloudLocked()) { lockPrivateView(); return; }
  if (!state.content) return;
  const renderers = { overview: renderOverview, texts: renderTexts, owner: renderOwner, outfits: renderOutfits, photos: renderPhotos, journal: renderJournal, settings: renderSettings, messages: renderMessages };
  try { $('#editor').replaceChildren(...renderers[state.section]()); syncPhotoEditorModal(); }
  catch (error) {
    $('#editor').replaceChildren(node('div', { class: 'error-page' }, node('h2', {}, '这部分内容暂时无法显示'), node('p', { class: 'muted' }, '当前编辑仍然保留，可以导出备份或重新载入草稿。'), node('pre', {}, error.message), button('导出 JSON', exportJSON)));
    console.error(error);
  }
}
function renderOverview() {
  const { media, outfits, journal } = state.content;
  return [
    node('section', { class: 'welcome' }, node('h2', {}, '管理你的展示内容'), node('p', {}, '修改页面文案、整理照片与服装、记录碎碎念。先保存草稿并检查预览，再发布到网站。'), node('span', { class: 'big-clover', 'aria-hidden': 'true' }, '✤')),
    node('div', { class: 'stats' }, ...[
      ['照片相册', media.length, `${media.filter(item => item.enabled).length} 张纳入相册`, 'photos'], ['服装展示', outfits.length, '正面 · 背面 · 校准', 'outfits'],
      ['碎碎念', journal.length, `${journal.filter(item => item.published).length} 条已勾选发布`, 'journal'], ['语言版本', 2, '中文 · 日本語', 'texts'],
    ].map(([label, amount, detail, section]) => node('section', { class: 'stat' }, node('span', { class: 'stat-label' }, label), node('span', { class: 'stat-number' }, amount), node('div', { class: 'stat-detail' }, detail), node('button', { type: 'button', class: 'text-button', style: 'margin-top:14px', onclick: () => selectSection(section) }, '开始整理 →')))),
    panel(node('h2', {}, '一次轻松的更新'), node('div', { class: 'steps' }, ...[
      ['01 / 整理', '把喜欢的日常放进来', '批量导入照片，自动读取世界与拍摄时间；新照片会先进入草稿。'],
      ['02 / 检查', '让文字和画面刚刚好', '编辑中日文案、调整服装，再打开旁边的网站预览。'],
      ['03 / 发布', '准备好了，再分享', '先保存草稿，确认发布勾选，最后发布到网站。'],
    ].map(([number, heading, description]) => node('div', {}, node('span', { class: 'step-number' }, number), node('h3', {}, heading), node('p', {}, description))))),
    panel(node('h3', {}, '当前连接'), node('p', { class: 'muted' }, state.connected && state.authenticated ? `${state.session?.mode === 'cloud' ? '云端' : '本地'}管理服务已连接。当前草稿版本：${state.revision ?? '未保存'}。` : '管理 API 尚未连接或尚未登录。编辑可以备份为 JSON；线上内容不会改变。'), node('div', { class: 'row-actions' }, button('连接与备份', () => selectSection('settings')), button('导出当前 JSON', exportJSON))),
  ];
}
function renderTexts() {
  const section = editorCopySection(state.textGroup);
  const groupSelect = node('select', { 'aria-label': '页面位置' }, ...EDITOR_COPY_SECTIONS.map(group => node('option', { value: group.id }, group.label)));
  groupSelect.value = state.textGroup;
  groupSelect.addEventListener('change', () => { state.textGroup = groupSelect.value; render(); if (state.preview) setPreviewTarget(previewSection()); });
  const languageTabs = node('div', { class: 'copy-language-tabs', role: 'group', 'aria-label': '文案语言' }, ...[['zh', '中文'], ['ja', '日本語']].map(([language, title]) =>
    button(title, () => { state.textLanguage = language; render(); postPreview(); }, 'secondary small', { 'aria-pressed': String(state.textLanguage === language), class: `copy-language-tab${state.textLanguage === language ? ' active' : ''}` }),
  ));
  const cards = node('div', { class: 'page-copy-fields' }); renderTextCards(cards);
  return [intro('页面文案', '按显示位置修改常用文字。照片说明、服装名和个人资料，请在各自栏目中编辑。'),
    node('div', { class: 'toolbar copy-toolbar' }, groupSelect, languageTabs, button('预览这一页', () => { if (!state.preview) togglePreview(true); else setPreviewTarget(previewSection()); }, 'secondary small')),
    node('p', { class: 'copy-section-note' }, section.description), cards,
  ];
}
function renderTextCards(target) {
  const locale = state.textLanguage, localeName = locale === 'ja' ? '日本語' : '中文';
  target.replaceChildren(...editorCopySection(state.textGroup).fields.map(item => node('section', { class: 'panel translation-card page-copy-card' },
    node('h3', {}, item.label), node('p', { class: 'copy-location' }, item.location),
    field(`${item.label} · ${localeName}`, readEditorCopy(state.content, item.id, locale), value => writeEditorCopy(state.content, item.id, locale, value), { multiline: item.multiline, rows: item.multiline ? 3 : undefined }),
  )));
}
function renderOwner() {
  const owner = state.content.owner;
  const upload = uploadPicker('更换头像', 'image/png,image/jpeg,image/webp', files => {
    queueFiles(files, { kind: 'avatar', onComplete: result => { owner.avatar = result.reference; changed(); if (state.section === 'owner') render(); } });
  });
  const contactList = node('div');
  function renderContacts() {
    contactList.replaceChildren(...owner.contacts.map((contact, index) => node('div', { class: 'contact-row' }, localizedFields('显示名称', contact, 'label'), field('链接地址', contact.url, value => { contact.url = value; }, { placeholder: 'https://… 或 mailto:…' }), node('button', { type: 'button', class: 'icon-button', 'aria-label': `删除联系方式 ${index + 1}`, onclick: () => { owner.contacts.splice(index, 1); changed(); renderContacts(); } }, '×'))));
  }
  renderContacts();
  const journalOptions = [['placeholder', '保留占位提示'], ['feed', '展示已发布碎碎念'], ['link', '链接到外部页面'], ['hidden', '隐藏碎碎念入口']];
  return [intro('作者资料', '头像、简介和平台主页会同步到顶部作者资料与个人名片。'),
    panel(node('div', { class: 'avatar-editor' }, image(owner.avatar, '作者头像', 'avatar-image'), node('div', {}, upload, node('p', { class: 'small-note' }, '建议使用正方形图片。上传后保存草稿，再发布。'))),
      field('头像图片地址', owner.avatar, value => { owner.avatar = value; }, { placeholder: 'media/… 或 https://…' }),
      node('div', { class: 'field-grid' }, localizedFields('作者名字', owner, 'name'), localizedFields('个人简介', owner, 'bio', { multiline: true }))),
    panel(node('h2', {}, '平台主页'), node('p', { class: 'muted' }, '填写你的个人主页地址；留空的平台不会显示。'), node('div', { class: 'field-grid' }, ...[['xiaohongshu', '小红书'], ['x', 'X / Twitter'], ['vrchat', 'VRChat'], ['pixiv', 'Pixiv']].map(([key, title]) => field(title, owner.socials?.[key], value => { owner.socials ||= {}; owner.socials[key] = value; }, { placeholder: 'https://…' })))),
    panel(node('h2', {}, '其他联系方式'), contactList, button('＋ 添加联系方式', () => { owner.contacts.push({ label: '', url: '' }); changed(); renderContacts(); })),
    panel(node('h2', {}, '碎碎念入口'), field('展示方式', owner.journal?.mode || 'placeholder', value => { owner.journal ||= {}; owner.journal.mode = value; }, { options: journalOptions }), field('外部碎碎念链接', owner.journal?.url, value => { owner.journal ||= {}; owner.journal.url = value || null; }, { placeholder: '选择「链接到外部页面」时使用' }), button('去编辑碎碎念 →', () => selectSection('journal'))),
  ];
}

function localizedValue(value, locale = 'zh') {
  return typeof value === 'string' ? value : value?.[locale] || value?.zh || value?.ja || '';
}
function localizedFields(label, target, key, options = {}) {
  return node('div', { class: 'localized-fields' }, ...['zh', 'ja'].map(locale => field(`${label} · ${locale === 'zh' ? '中文' : '日本語'}`, typeof target[key] === 'string' ? target[key] : target[key]?.[locale] || '', value => {
    if (typeof target[key] === 'string') target[key] = { zh: target[key], ja: target[key] };
    target[key] ||= { zh: '', ja: '' }; target[key][locale] = value;
  }, options)));
}
function moveItem(list, index, offset) {
  const next = index + offset;
  if (next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]]; changed(); render();
}
function reorderButtons(list, index, label) {
  return node('div', { class: 'item-reorder' }, button('↑', () => moveItem(list, index, -1), 'secondary small', { disabled: !index, 'aria-label': `上移${label}` }), button('↓', () => moveItem(list, index, 1), 'secondary small', { disabled: index === list.length - 1, 'aria-label': `下移${label}` }));
}
function renderOutfits() {
  const outfits = state.content.outfits;
  const add = () => { const item = { id: identifier('outfit'), label: { zh: '新服装', ja: '新しい衣装' }, front: '', back: null, imageWidth: 1440, imageHeight: 2560 }; outfits.push(item); state.selectedOutfit = item.id; changed(); render(); };
  const current = outfits.find(item => item.id === state.selectedOutfit) || outfits[0];
  if (current) state.selectedOutfit = current.id;
  const list = node('div', { class: 'item-list' }, ...outfits.map((item, index) => node('div', {}, node('button', { type: 'button', class: `item-button${item === current ? ' active' : ''}`, onclick: () => { state.selectedOutfit = item.id; render(); } }, image(item.front, '', ''), node('span', { class: 'item-label' }, node('strong', {}, localizedValue(item.label) || '未命名服装'), node('small', {}, `${index + 1} / ${outfits.length}`))), reorderButtons(outfits, index, '服装'))));
  const result = [intro('每一套，都有不同的心情', '服装可以增删、重排和修改中日名称。上传透明 PNG / WebP 可保留透明背景。', button('＋ 添加服装', add, 'primary'))];
  if (!current) return [...result, empty('还没有服装', '添加服装后上传正面与背面图片。', button('添加第一套服装', add))];
  const sideEditor = side => {
    const label = side === 'front' ? '正面' : '背面';
    return node('div', { class: 'outfit-side' }, node('h3', {}, label), image(current[side], `${localizedValue(current.label)}${label}`, 'outfit-image'), uploadPicker(`上传${label}图片`, 'image/png,image/jpeg,image/webp', files => queueFiles(files.slice(0, 1), { kind: 'outfit', onComplete: result => {
      if (!outfits.includes(current)) return;
      current[side] = result.reference; current[`${side}Size`] = [result.width, result.height];
      if (side === 'front') { current.imageWidth = result.width; current.imageHeight = result.height; }
      changed(); if (state.section === 'outfits') render();
    } })), field(`${label}图片地址`, current[side], value => { current[side] = value || null; }, { placeholder: 'media/… 或 ./assets/…' }),
    side === 'back' ? button('移除背面', () => { current.back = null; delete current.backBounds; delete current.backCalibration; changed(); render(); }, 'danger small', { disabled: !current.back }) : null);
  };
  const boundsEditor = side => {
    const key = `${side}Bounds`, labels = ['左 x', '上 y', '右 x', '下 y'];
    return node('div', {}, node('h3', {}, `${side === 'front' ? '正面' : '背面'}可见范围`), node('p', { class: 'small-note' }, '按原图像素填写；留空则使用整张图。'), node('div', { class: 'field-grid four' }, ...labels.map((label, index) => field(label, current[key]?.[index] ?? '', value => {
      current[key] ||= [0, 0, current.imageWidth, current.imageHeight]; current[key][index] = value ?? 0;
    }, { type: 'number', min: 0, step: 1 }))), button('重置范围', () => { delete current[key]; changed(); render(); }, 'secondary small'));
  };
  const calibration = current.backCalibration || { scale: 1, offsetX: 0, offsetY: 0 };
  const backPreview = image(current.back, '背面校准预览', '');
  const updateCalibrationPreview = () => { backPreview.style.transform = `translate(${(calibration.offsetX / current.imageWidth) * 100}%, ${(calibration.offsetY / current.imageHeight) * 100}%) scale(${calibration.scale})`; };
  updateCalibrationPreview();
  const details = panel(localizedFields('服装名称', current, 'label'), node('div', { class: 'outfit-images' }, sideEditor('front'), sideEditor('back')),
    node('div', { class: 'field-grid' }, field('原图宽度（像素）', current.imageWidth, value => { current.imageWidth = value || 1; updateCalibrationPreview(); }, { type: 'number', min: 1, max: 32768 }), field('原图高度（像素）', current.imageHeight, value => { current.imageHeight = value || 1; updateCalibrationPreview(); }, { type: 'number', min: 1, max: 32768 })),
    node('details', { class: 'calibration-panel' }, node('summary', {}, '裁切范围与背面校准'), node('div', { class: 'field-grid' }, boundsEditor('front'), boundsEditor('back')), node('div', { class: 'calibration-preview' }, image(current.front, '正面校准参考', ''), backPreview), node('div', { class: 'field-grid three' }, ...[['scale', '背面缩放', .1, 5, .01], ['offsetX', '横向偏移（像素）', -32768, 32768, 1], ['offsetY', '纵向偏移（像素）', -32768, 32768, 1]].map(([key, label, min, max, step]) => field(label, calibration[key], value => { calibration[key] = value ?? (key === 'scale' ? 1 : 0); current.backCalibration = calibration; updateCalibrationPreview(); }, { type: 'number', min, max, step }))), button('重置背面校准', () => { delete current.backCalibration; changed(); render(); }, 'secondary small')),
    node('div', { class: 'row-actions' }, button('删除这套服装', async () => { if (!await confirmAction('删除这套服装？', `「${localizedValue(current.label)}」会从草稿移除，图片文件保留。`, '删除服装')) return; outfits.splice(outfits.indexOf(current), 1); state.selectedOutfit = null; changed(); render(); }, 'danger')));
  return [...result, node('div', { class: 'collection-layout' }, list, details)];
}
function photoName(item) { return localizedValue(item.caption) || item.worldName || item.originalName || localizedValue(item.alt) || '未命名照片'; }
function filteredPhotos() {
  const query = state.photoSearch.trim().toLowerCase();
  return state.content.media.filter(item => (state.photoFilter === 'all' || (state.photoFilter === 'published' ? item.enabled : !item.enabled)) && matchesCohort('media', item, state.photoCohort) && (!query || `${photoName(item)} ${localizedValue(item.alt)} ${item.worldId} ${item.modelIds.join(' ')}`.toLowerCase().includes(query)));
}
function photoCategoryTabs() {
  const included = state.content.media.filter(item => item.enabled).length;
  return node('div', { class: 'photo-category-tabs', role: 'group', 'aria-label': '相册收录分类' },
    ...[['published', '已纳入相册', included], ['draft', '未纳入相册', state.content.media.length - included]].map(([value, label, count]) => button([
      node('span', {}, label), node('span', { class: 'photo-category-count' }, count),
    ], () => { if (state.photoFilter !== value) { state.photoFilter = value; render(); } }, `photo-category-tab${state.photoFilter === value ? ' active' : ''}`, { 'aria-pressed': String(state.photoFilter === value) })));
}
function openPhotoEditor(id, sequence = filteredPhotos()) {
  if (!state.content.media.some(item => item.id === id)) return false;
  state.photoEditSequence = sequence.map(item => item.id);
  photoEditorOpener = document.activeElement;
  state.selectedPhoto = id; syncPhotoEditorModal(); return true;
}
function photoEditItems(item) {
  const ids = new Set(state.photoEditSequence || []);
  let items = state.content.media.filter(photo => ids.has(photo.id));
  if (!items.some(photo => photo.id === item.id)) {
    const filtered = filteredPhotos();
    items = filtered.some(photo => photo.id === item.id) ? filtered : state.content.media;
    state.photoEditSequence = items.map(photo => photo.id);
  }
  return items;
}
function movePhotoEditor(step) {
  const item = state.content.media.find(photo => photo.id === state.selectedPhoto);
  if (!item || ![-1, 1].includes(step)) return false;
  const sequence = photoEditItems(item), index = sequence.findIndex(photo => photo.id === item.id);
  const next = sequence[index + step];
  if (!next) return false;
  state.selectedPhoto = next.id; syncPhotoEditorModal({ direction: step });
  const nextButton = $(`.photo-detail-navigation [data-photo-step="${step}"]`);
  (nextButton && !nextButton.disabled ? nextButton : $('.photo-detail-position'))?.focus?.({ preventScroll: true });
  return true;
}
function photoDetailNavigation(item) {
  const sequence = photoEditItems(item), index = sequence.findIndex(photo => photo.id === item.id);
  return node('nav', { class: 'photo-detail-navigation', 'aria-label': '逐张编辑照片' },
    button('上一项', () => movePhotoEditor(-1), 'secondary small photo-detail-previous', { 'data-photo-step': '-1', disabled: index <= 0 }),
    node('span', { class: 'photo-detail-position', tabindex: '-1' }, `${index + 1} / ${sequence.length}`),
    button('下一项', () => movePhotoEditor(1), 'secondary small photo-detail-next', { 'data-photo-step': '1', disabled: index < 0 || index >= sequence.length - 1 }));
}
function renderPhotos() {
  if (!['published', 'draft'].includes(state.photoFilter)) state.photoFilter = 'published';
  const picker = uploadPicker('选择照片', 'image/png,image/jpeg,image/webp', files => queueFiles(files, { kind: 'photo' }), true);
  const drop = node('div', { class: 'dropzone' }, node('div', {}, node('h3', {}, '批量导入照片'), node('p', {}, '拖入多张 PNG、JPEG 或 WebP。先读取元数据，再保留私有原图，生成公开展示图与缩略图。', node('br'), '最多同时导入 2 张。新照片默认纳入相册草稿，保存草稿并发布到网站后才会公开。')), picker);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragover'); queueFiles([...event.dataTransfer.files], { kind: 'photo' }); });
  const search = node('input', { type: 'search', value: state.photoSearch, placeholder: '搜索世界、说明或模型…', 'aria-label': '搜索照片' });
  let debounce; search.addEventListener('input', () => { state.photoSearch = search.value; clearTimeout(debounce); debounce = setTimeout(() => { renderPhotoGrid(grid); refreshSelection(); }, 150); });
  const all = node('input', { type: 'checkbox', checked: filteredPhotos().length > 0 && filteredPhotos().every(item => state.selectedPhotos.has(item.id)), 'aria-label': '选择当前筛选的全部照片' });
  all.addEventListener('change', () => { for (const item of filteredPhotos()) all.checked ? state.selectedPhotos.add(item.id) : state.selectedPhotos.delete(item.id); render(); });
  const grid = node('div', { class: 'photo-grid' }); renderPhotoGrid(grid);
  const summary = node('span', { class: 'small-note photo-selection-summary' });
  const refreshSelection = () => {
    const visible = filteredPhotos(), visibleIds = new Set(visible.map(item => item.id));
    const hiddenSelected = [...state.selectedPhotos].filter(id => !visibleIds.has(id)).length;
    all.checked = visible.length > 0 && visible.every(item => state.selectedPhotos.has(item.id));
    summary.textContent = `当前分类显示 ${visible.length} 张 · 已选择 ${state.selectedPhotos.size} 张${hiddenSelected ? `（含当前筛选外 ${hiddenSelected} 张）` : ''}`;
  };
  refreshSelection();
  return [intro('让照片留下旅途的温度', '拍摄日期与世界信息可逐张调整，也可选中后批量编辑。原图仅管理员可下载。'), drop, photoCategoryTabs(), cohortTabs('media', state.content.media.filter(item => state.photoFilter === 'draft' ? !item.enabled : item.enabled)), node('div', { class: 'toolbar' }, search), node('div', { class: 'photo-toolbar' }, node('label', { class: 'selection-label' }, all, '选择当前筛选全部'), summary), ...(state.selectedPhotos.size ? [photoBatchEditor()] : []), grid];
}
function renderPhotoGrid(grid) {
  const photos = filteredPhotos();
  grid.replaceChildren(...photos.map(item => {
    const select = node('input', { type: 'checkbox', class: 'photo-select', checked: state.selectedPhotos.has(item.id), 'aria-label': `选择照片：${photoName(item)}` });
    select.addEventListener('change', () => { select.checked ? state.selectedPhotos.add(item.id) : state.selectedPhotos.delete(item.id); render(); });
    return node('article', { class: `photo-card${state.selectedPhotos.has(item.id) ? ' selected' : ''}` }, select, node('span', { class: `pill photo-status ${item.enabled ? 'published' : 'draft'}` }, item.enabled ? '已纳入相册' : '未纳入相册'), node('button', { type: 'button', 'data-photo-editor-id': item.id, 'aria-label': `编辑照片：${photoName(item)}`, onclick: () => openPhotoEditor(item.id) }, image(item.thumbnail || item.url, localizedValue(item.alt), 'photo-image'), node('div', { class: 'photo-info' }, node('strong', {}, photoName(item)), node('small', { class: 'photo-info-meta' }, item.takenAt || '待补拍摄时间', cohortBadge('media', item)))));
  }));
  if (!photos.length) grid.append(empty(state.photoSearch ? '这个分类没有匹配照片' : state.photoCohort && state.photoCohort !== 'all' ? '这个新增分类暂无照片' : state.photoFilter === 'draft' ? '暂无未纳入相册的照片' : '暂无已纳入相册的照片', state.photoSearch ? '换一个关键词，或切换到另一个收录分类。' : state.photoFilter === 'draft' ? '从相册移出的照片会集中显示在这里，仍可继续编辑。' : '导入新照片，或在「未纳入相册」中选择照片并纳入相册。'));
}
function photoBatchEditor() {
  const values = {}, selected = () => state.content.media.filter(item => state.selectedPhotos.has(item.id));
  const batchField = (key, label, help = '') => {
    const input = node('input', { type: 'text', placeholder: '留空不修改', 'aria-label': label });
    input.addEventListener('input', () => { values[key] = input.value; });
    return node('label', { class: 'field' }, node('span', {}, label), input, help ? node('span', { class: 'help' }, help) : null);
  };
  let pickedModelTags = [];
  const editModels = node('input', { type: 'checkbox' });
  const models = photoModelPicker([], tags => { pickedModelTags = tags; if (editModels.checked) values.modelIds = [...tags]; }, { dirty: false, disabled: true });
  editModels.addEventListener('change', () => {
    models.disabled = !editModels.checked;
    if (editModels.checked) values.modelIds = [...pickedModelTags]; else delete values.modelIds;
  });
  const modelField = node('div', { class: 'photo-model-batch' }, node('label', { class: 'photo-model-mode' }, editModels, '修改模型标签（覆盖原有选择）'), models);
  const apply = () => {
    for (const item of selected()) {
      for (const key of ['takenAt', 'worldName', 'worldId']) if (values[key]?.trim()) item[key] = values[key].trim();
      if (Array.isArray(values.modelIds)) item.modelIds = [...values.modelIds];
      for (const locale of ['zh', 'ja']) if (values[`alt_${locale}`]?.trim()) { if (typeof item.alt === 'string') item.alt = { zh: item.alt, ja: item.alt }; item.alt ||= {}; item.alt[locale] = values[`alt_${locale}`]; }
    }
    changed(); render(); toast('已应用批量编辑，尚未保存草稿。');
  };
  return node('section', { class: 'batch-bar' }, node('h3', {}, `批量编辑 ${state.selectedPhotos.size} 张照片`), node('div', { class: 'batch-fields' }, batchField('takenAt', '拍摄时间', 'YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss；无时区时保留原值'), batchField('worldName', '世界名称'), batchField('worldId', '世界 ID'), batchField('alt_zh', '图片描述 · 中文'), batchField('alt_ja', '图片描述 · 日本語'), modelField),
    node('div', { class: 'row-actions' }, button('取消选择', () => { state.selectedPhotos.clear(); render(); }), button('纳入相册', () => { selected().forEach(item => { item.enabled = true; }); changed(); render(); }), button('移出相册', () => { selected().forEach(item => { item.enabled = false; }); changed(); render(); }), button('清空拍摄时间', () => { selected().forEach(item => { item.takenAt = null; item.timeZone = ''; }); changed(); render(); }), button('应用填写内容', apply, 'primary'), button('删除所选', async () => { if (!await confirmAction('删除所选照片？', `将移除 ${state.selectedPhotos.size} 张照片的内容引用，图片文件保留。`, '删除所选')) return; state.content.media = state.content.media.filter(item => !state.selectedPhotos.has(item.id)); state.selectedPhotos.clear(); changed(); render(); }, 'danger')));
}
function ensurePhotoEditorDialog() {
  if (photoEditorDialog) return photoEditorDialog;
  const dialog = node('dialog', { id: 'photo-editor-dialog', class: 'photo-editor-dialog', 'aria-labelledby': 'photo-editor-title' });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePhotoEditor(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closePhotoEditor(); });
  dialog.addEventListener('keydown', event => {
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); movePhotoEditor(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  document.body.append(dialog); photoEditorDialog = dialog;
  return dialog;
}
function closePhotoEditor({ immediate = false, refreshGrid = true } = {}) {
  const dialog = photoEditorDialog;
  if (!dialog?.open || photoEditorClosing && !immediate) return;
  const selected = state.selectedPhoto, opener = photoEditorOpener, top = window.scrollY;
  photoEditorClosing = true; photoEditorMotion?.cancel();
  const finish = () => {
    photoEditorMotion?.cancel(); photoEditorMotion = null; photoEditorClosing = false;
    state.selectedPhoto = null; state.photoEditSequence = []; photoEditorOpener = null;
    if (dialog.open) dialog.close();
    dialog.replaceChildren(); document.body.classList.remove('photo-editor-open');
    if (refreshGrid && state.section === 'photos' && !cloudLocked()) {
      render();
      const target = opener?.isConnected ? opener : [...document.querySelectorAll('[data-photo-editor-id]')].find(item => item.dataset.photoEditorId === selected);
      target?.focus?.({ preventScroll: true }); window.scrollTo({ top, behavior: 'instant' });
    }
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (immediate || reduced || !dialog.animate) { finish(); return; }
  photoEditorMotion = dialog.animate([{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(7px) scale(.98)' }], { duration: 160, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' });
  const motion = photoEditorMotion;
  motion.finished.then(() => { if (photoEditorMotion === motion) finish(); }, () => {});
}
function syncPhotoEditorModal({ direction = 0 } = {}) {
  const item = state.section === 'photos' && state.content?.media.find(photo => photo.id === state.selectedPhoto);
  if (!item || cloudLocked()) { closePhotoEditor({ immediate: true, refreshGrid: false }); return; }
  const dialog = ensurePhotoEditorDialog(), wasOpen = dialog.open;
  const previousId = dialog.dataset.photoId, previousScroll = previousId === item.id ? dialog.querySelector('.photo-editor-fields')?.scrollTop || 0 : 0;
  photoEditorMotion?.cancel(); photoEditorMotion = null; photoEditorClosing = false;
  dialog.dataset.photoId = item.id;
  const close = button('×', () => closePhotoEditor(), 'secondary photo-editor-close', { 'aria-label': '关闭照片编辑' });
  const header = node('header', { class: 'photo-editor-header' }, node('div', {}, node('h2', { id: 'photo-editor-title' }, '整理照片'), node('p', { class: 'small-note' }, '逐张整理，修改保留在草稿中。')), close);
  const preview = node('section', { class: 'photo-editor-preview', 'aria-label': '照片与逐张切换' }, image(item.url, localizedValue(item.alt), 'detail-image'), photoDetailNavigation(item));
  const fields = renderPhotoDetail(item); fields.scrollTop = previousScroll;
  const save = button('保存草稿', async () => { await saveDraft(); if (!cloudLocked()) syncPhotoEditorModal(); }, 'primary', { id: 'photo-editor-save', disabled: $('#save-draft').disabled });
  const actions = node('div', { class: 'photo-editor-actions' }, node('span', { class: 'small-note', id: 'photo-editor-save-state' }, state.dirty ? '有未保存的编辑' : '草稿已同步'), save, button('完成', () => closePhotoEditor()));
  const details = node('section', { class: 'photo-editor-details', 'aria-label': '照片信息' }, fields, actions);
  const layout = node('div', { class: 'photo-editor-layout' }, preview, details);
  dialog.replaceChildren(header, layout);
  if (!wasOpen) { dialog.showModal(); document.body.classList.add('photo-editor-open'); }
  fields.scrollTop = previousScroll;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduced && dialog.animate) {
    if (!wasOpen) photoEditorMotion = dialog.animate([{ opacity: 0, transform: 'translateY(15px) scale(.97)' }, { opacity: 1, transform: 'translateY(-2px) scale(1.003)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 340, easing: 'cubic-bezier(.2,.76,.28,1)' });
    else if (direction && layout.animate) photoEditorMotion = layout.animate([{ opacity: .55, transform: `translateX(${direction * 7}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 190, easing: 'cubic-bezier(.2,.76,.28,1)' });
  }
  if (!wasOpen) close.focus({ preventScroll: true });
}
function renderPhotoDetail(item) {
  const index = state.content.media.indexOf(item);
  return node('div', { class: 'photo-editor-fields' },
    node('div', { class: 'detail-top' }, node('div', {}, node('h3', {}, photoName(item)), node('p', { class: 'small-note' }, `${item.width || '?'} × ${item.height || '?'}`, cohortBadge('media', item))), check('纳入相册', item.enabled, value => { item.enabled = value; })),
    node('div', { class: 'field-grid' }, field('拍摄时间', item.takenAt, value => { item.takenAt = value || null; item.timeZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? 'offset' : value.includes('T') ? 'unspecified' : ''; }, { placeholder: '2026-11-15T18:30:00', help: '支持日期、无时区本地时间或带 Z / +09:00 的时间' }), photoModelPicker(item.modelIds, tags => { item.modelIds = tags; }), field('世界名称', item.worldName, value => { item.worldName = value; }), field('世界 ID', item.worldId, value => { item.worldId = value; }, { placeholder: 'wrld_…' })), localizedFields('照片说明', item, 'caption', { multiline: true }), localizedFields('图片描述（辅助阅读）', item, 'alt', { multiline: true }),
    node('details', {}, node('summary', {}, '图片地址与导入信息'), field('展示图', item.url, value => { item.url = value; }), field('缩略图', item.thumbnail, value => { item.thumbnail = value; }), node('p', { class: 'metadata-note' }, `原文件：${item.originalName || '无'}\n时间来源：${item.metadataSource?.takenAt || '手动或未知'}\n世界来源：${item.metadataSource?.world || '手动或未知'}\n时区：${item.timeZone || '未提供'}`), item.warnings?.length ? node('p', { class: 'metadata-note metadata-warning' }, item.warnings.join('\n')) : null),
    node('div', { class: 'photo-detail-footer' }, node('div', { class: 'row-actions' }, item.originalKey && state.authenticated ? node('a', { class: 'button secondary', href: `/api/admin/original?key=${encodeURIComponent(item.originalKey)}`, download: item.originalName || '' }, '下载私有原图') : null, reorderButtons(state.content.media, index, '照片'), button('删除这张照片', async () => { if (!await confirmAction('删除这张照片？', '从草稿移除内容引用，原图与展示图文件保留。', '删除照片')) return; state.content.media.splice(state.content.media.indexOf(item), 1); state.selectedPhotos.delete(item.id); closePhotoEditor({ immediate: true }); changed(); render(); }, 'danger'))));
}
function renderJournal() {
  const journal = state.content.journal;
  const add = () => { const item = { id: identifier('note'), title: '', body: '', images: [], createdAt: new Date().toISOString(), published: false }; journal.unshift(item); markCreated('journal', item.id); state.journalCohort = 'new'; state.selectedPost = item.id; changed(); render(); };
  const visible = journal.filter(item => matchesCohort('journal', item, state.journalCohort));
  const current = visible.find(item => item.id === state.selectedPost) || visible[0]; if (current) state.selectedPost = current.id;
  const list = node('div', { class: 'item-list' }, ...visible.map((item) => node('div', {}, node('button', { type: 'button', class: `item-button journal-item${item === current ? ' active' : ''}`, onclick: () => { state.selectedPost = item.id; render(); } }, item.images[0] ? image(item.images[0].url, '', '') : node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, '✎'), node('span', { class: 'item-label' }, node('strong', {}, localizedValue(item.title) || localizedValue(item.body).slice(0, 24) || '图片碎碎念'), node('small', {}, item.published ? '已勾选发布' : '草稿', cohortBadge('journal', item)))), reorderButtons(journal, journal.indexOf(item), '碎碎念'))));
  const result = [intro('把小小的心情放在这里', '可以不写标题：纯文字、纯图片，或一起留下。图片与正文至少保留一项。', button('＋ 写一条碎碎念', add, 'primary')), cohortTabs('journal', journal)];
  if (!current) return [...result, empty(journal.length ? '这个分类暂无碎碎念' : '还没有碎碎念', journal.length ? '切换「已有记录」或「本次新增」，也可以继续新建。' : '不必准备长篇，留下一句话或一张图就好。', button('写一条', add))];
  const images = node('div', { class: 'journal-images' }, ...current.images.map((entry, index) => node('div', { class: 'journal-image' }, image(entry.url, localizedValue(entry.alt), ''), localizedFields('图片描述', entry, 'alt'), reorderButtons(current.images, index, '图片'), button('移除图片', () => { current.images.splice(index, 1); changed(); render(); }, 'danger small'))));
  const details = panel(check('勾选发布这条碎碎念', current.published, value => { current.published = value; }), localizedFields('标题（可留空）', current, 'title'), localizedFields('正文', current, 'body', { multiline: true, rows: 7 }), field('记录时间', current.createdAt, value => { current.createdAt = value || null; }, { help: '支持 YYYY-MM-DD 或完整时间，保留原始时区' }), node('h3', {}, '图片'), images,
    uploadPicker('＋ 添加图片', 'image/png,image/jpeg,image/webp', files => queueFiles(files, { kind: 'journal', onComplete: result => { if (!journal.includes(current)) return; current.images.push({ url: result.reference, alt: '' }); changed(); if (state.section === 'journal') render(); } }), true),
    !localizedValue(current.body).trim() && !current.images.length ? node('p', { class: 'metadata-warning small-note' }, '这条还没有正文或图片，公开页面会暂时略过。') : null,
    node('div', { class: 'row-actions' }, button('删除这条碎碎念', async () => { if (!await confirmAction('删除这条碎碎念？', '从草稿移除这条内容，已上传图片仍保留。', '删除碎碎念')) return; journal.splice(journal.indexOf(current), 1); state.selectedPost = null; changed(); render(); }, 'danger')));
  return [...result, node('div', { class: 'collection-layout' }, list, details)];
}
function renderSettings() {
  const settings = state.content.settings;
  return [intro('让内容安心地住下来', '管理 API 必须与管理页面同源。草稿与发布分开；没有后端时只能编辑和导出。'),
    panel(node('h2', {}, '连接状态'), node('p', { class: 'settings-status' }, node('span', { class: `connection-dot${state.connected && state.authenticated ? ' online' : ''}` }), state.connected ? state.authenticated ? '管理服务已连接并通过认证' : '管理服务已连接，等待登录' : '未连接管理 API · 浏览器编辑模式'), node('p', { class: 'muted' }, `页面来源：${location.origin}\n草稿版本：${state.revision ?? '尚未关联'}`), node('div', { class: 'row-actions' }, button('重新连接', connect), button('载入服务端草稿', () => loadContent(), 'secondary', { disabled: !state.connected || !state.authenticated }), state.localBackup?.content ? button('恢复浏览器备份', restoreBackup) : null, !state.connected && state.cloudAdminUrl ? node('a', { class: 'button primary', href: state.cloudAdminUrl, target: '_blank', rel: 'noopener' }, '打开云端管理页') : null, state.authenticated && state.session?.mode === 'cloud' ? button('退出登录', () => $('#logout').click()) : null)),
    panel(node('h2', {}, '网站与图片域名'), field('公开网站地址', settings.publicSiteUrl, value => { settings.publicSiteUrl = value; }, { placeholder: 'https://…', help: '用于记录网站入口，预览始终使用同源页面' }), field('图片基础地址', settings.mediaBaseUrl, value => { settings.mediaBaseUrl = value; }, { placeholder: 'https://media.example.com', help: '留空使用后端当前域名。图片保存为 media/… 键，换域名无需逐张改写。' }), field('新照片默认模型 ID', settings.defaultModelId, value => { settings.defaultModelId = value; }, { help: '只用于新导入照片的模型标签；不会切换公开网站主题。' })),
    panel(node('h2', {}, 'JSON 备份'), node('p', { class: 'muted' }, '导出包含当前草稿文案与图片引用，不包含图片文件、登录信息或 Cookie。导入后需要另行保存草稿，再发布。'), node('div', { class: 'row-actions' }, button('导出当前 JSON', exportJSON, 'primary'), button('导入 JSON', () => $('#json-import').click()))),
    panel(node('h2', {}, '关于图片删除'), node('p', { class: 'muted' }, '删除照片、服装或碎碎念只会移除内容中的引用。存储中的文件继续保留，私有原图不会出现在公开内容接口中。'))];
}

function uploadPicker(label, accept, acceptFiles, multiple = false) {
  const input = node('input', { type: 'file', accept, multiple, 'aria-label': label });
  input.addEventListener('change', () => { const files = [...input.files]; input.value = ''; if (files.length) acceptFiles(files); });
  return node('label', { class: 'upload-inline button secondary' }, label, input);
}
function queueFiles(files, options) {
  if (!state.connected || !state.authenticated) { toast('上传需要先连接并登录同源管理服务。当前内容仍可编辑与导出。', true); return; }
  for (const file of files) {
    if (!file.size || file.size > MAX_FILE_SIZE) { toast(`${file.name}：图片为空或超过 25MiB，未加入队列。`, true); continue; }
    state.jobs.push({ id: identifier('upload'), file, options, status: 'queued', progress: 0, note: '等待导入', cache: {}, photoId: options.kind === 'photo' ? identifier('photo') : null });
  }
  renderUploads(); pumpUploads();
}
function renderUploads() {
  if (cloudLocked()) { $('#upload-panel').hidden = true; $('#upload-list').replaceChildren(); return; }
  $('#upload-panel').hidden = !state.jobs.length;
  const done = state.jobs.filter(job => job.status === 'done').length, failed = state.jobs.filter(job => job.status === 'error').length;
  $('#upload-summary').textContent = `导入任务 · ${done}/${state.jobs.length} 已完成${failed ? ` · ${failed} 项待重试` : ''}`;
  $('#upload-list').replaceChildren(...state.jobs.map(job => node('div', { class: `upload-job ${job.status}` }, node('div', { class: 'upload-job-name' }, job.file.name, node('span', { class: 'upload-job-note' }, job.note)), node('progress', { max: 100, value: job.progress, 'aria-label': `${job.file.name}导入进度` }), node('div', { class: 'row-actions' }, job.status === 'error' ? button('重试', () => { job.status = 'queued'; job.note = '等待重试'; job.progress = 0; renderUploads(); pumpUploads(); }, 'secondary small', { disabled: !state.authenticated || !state.connected }) : null, job.status === 'queued' || job.status === 'error' ? button('移除', () => { state.jobs = state.jobs.filter(item => item !== job); renderUploads(); updateChrome(); }, 'secondary small') : job.status === 'done' ? node('span', { class: 'pill published' }, '已导入草稿') : node('span', { class: 'small-note' }, '处理中')))));
  updateChrome();
}
async function pumpUploads() {
  if (!state.authenticated || !state.connected) return;
  while (state.running < 2) {
    const job = state.jobs.find(item => item.status === 'queued'); if (!job) break;
    state.running++; job.status = 'running'; renderUploads();
    runUpload(job).then(result => {
      job.status = 'done'; job.progress = 100; job.note = result || '已加入草稿，保存后发布到网站。';
      // Completed jobs no longer retain the full-resolution file or browser derivative blobs.
      job.file = { name: job.file.name }; job.cache = {};
    }).catch(error => { job.status = 'error'; job.note = error.message; if ([401, 403].includes(error.status) || error.offline && state.cloudMode) reportError(error); }).finally(() => { state.running = Math.max(0, state.running - 1); renderUploads(); pumpUploads(); });
  }
}
function setJobProgress(job, note, progress) { job.note = note; job.progress = progress; renderUploads(); }
async function detectedMime(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('仅支持内容有效的 PNG、JPEG 与 WebP 图片。');
}
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Fall back to an HTML image on Safari. */ }
  }
  const url = URL.createObjectURL(file), img = new Image(); img.decoding = 'async';
  try { await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('浏览器无法解码此图片。')); img.src = url; }); }
  finally { URL.revokeObjectURL(url); }
  return { width: img.naturalWidth, height: img.naturalHeight, source: img, close() {} };
}
async function derivative(decoded, max, mime = 'image/jpeg', quality = .9) {
  const ratio = Math.min(1, max / Math.max(decoded.width, decoded.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(decoded.width * ratio)); canvas.height = Math.max(1, Math.round(decoded.height * ratio));
  const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法生成图片，请使用支持 Canvas 的浏览器。');
  if (mime === 'image/jpeg') { context.fillStyle = '#fffef9'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(decoded.source || decoded, 0, 0, canvas.width, canvas.height);
  try { return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('生成图片失败，请重试。')), mime, quality)); }
  finally { canvas.width = 1; canvas.height = 1; }
}
function uploadBlob(job, blob, role, name, start, end, mime = blob.type) {
  if (cloudLocked() || !state.jobs.includes(job)) return Promise.reject(staleRequest());
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeUploads.add(xhr); xhr.addEventListener('loadend', () => activeUploads.delete(xhr), { once: true });
    xhr.open('POST', `/api/admin/upload?role=${encodeURIComponent(role)}&name=${encodeURIComponent(name)}`);
    xhr.withCredentials = true; xhr.timeout = 180000; xhr.setRequestHeader('Content-Type', mime); xhr.setRequestHeader('X-Garden-CSRF', state.csrf); xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = event => { if (event.lengthComputable) { job.progress = Math.round(start + (end - start) * event.loaded / event.total); const row = [...$('#upload-list').children][state.jobs.indexOf(job)]; if (row) row.querySelector('progress').value = job.progress; } };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('上传端点未返回 JSON，请确认同源管理服务。')); return; }
      if (xhr.status < 200 || xhr.status >= 300) { const error = new Error(result.error || `上传失败（${xhr.status}）`); error.status = xhr.status; reject(error); return; }
      const expected = role === 'original' ? /^private\/originals\/[a-f\d]{64}\.(?:png|jpe?g|webp)$/ : /^media\/[a-f\d]{64}\.(?:png|jpe?g|webp)$/;
      if (!expected.test(result.key || '')) { reject(new Error('上传结果缺少有效图片存储键，未修改草稿。')); return; }
      resolve(result);
    };
    xhr.onerror = () => reject(Object.assign(new Error('上传连接中断。已完成的步骤会保留，可独立重试这一项。'), { offline: true }));
    xhr.ontimeout = () => reject(new Error('上传超时，可独立重试这一项。'));
    xhr.onabort = () => reject(staleRequest());
    xhr.send(blob);
  });
}
async function runUpload(job) {
  const cache = job.cache, { file, options } = job;
  cache.mime ||= await detectedMime(file);
  if (options.kind === 'photo') {
    if (!cache.metadata) { setJobProgress(job, '读取原图元数据…', 2); cache.metadata = await extractPhotoMetadata(file); }
    const metadata = cache.metadata;
    if (!cache.displayBlob || !cache.thumbnailBlob) {
      setJobProgress(job, '元数据已读取，生成展示图与缩略图…', 8);
      const decoded = await decodeImage(file);
      try { cache.width = decoded.width; cache.height = decoded.height; cache.displayBlob = await derivative(decoded, 2048); cache.thumbnailBlob = await derivative(decoded, 480, 'image/jpeg', .82); }
      finally { decoded.close?.(); }
    }
    if (!cache.original) { setJobProgress(job, '上传私有原图…', 15); cache.original = await uploadBlob(job, file, 'original', file.name, 15, 70, cache.mime); }
    if (!cache.display) { setJobProgress(job, '上传公开展示图…', 70); cache.display = await uploadBlob(job, cache.displayBlob, 'display', `${file.name}-display.jpg`, 70, 90); }
    if (!cache.thumbnail) { setJobProgress(job, '上传公开缩略图…', 90); cache.thumbnail = await uploadBlob(job, cache.thumbnailBlob, 'thumbnail', `${file.name}-thumb.jpg`, 90, 99); }
    if (cloudLocked() || !state.content || !state.jobs.includes(job)) throw staleRequest();
    // Include only this new reference in the next explicit publication. Uploading
    // never saves or publishes the draft, or changes existing exclusion choices.
    const item = { id: job.photoId, url: cache.display.key, thumbnail: cache.thumbnail.key, alt: { zh: '', ja: '' }, caption: { zh: '', ja: '' }, modelIds: [], takenAt: metadata.takenAt, timeZone: metadata.timeZone || '', worldName: metadata.worldName || '', worldId: metadata.worldId || '', sourceKind: 'photo', enabled: true, width: cache.width, height: cache.height, originalKey: cache.original.key, originalName: file.name, metadataSource: { ...metadata.source, fileModifiedAt: metadata.fileModifiedAt }, warnings: metadata.warnings || [] };
    const following = state.jobs.slice(state.jobs.indexOf(job) + 1).find(other => other.photoId && state.content.media.some(photo => photo.id === other.photoId));
    const insertAt = following ? state.content.media.findIndex(photo => photo.id === following.photoId) : state.content.media.length;
    state.content.media.splice(insertAt, 0, item); markCreated('media', item.id); changed();
    if (state.section === 'photos' && !state.selectedPhoto) { state.photoFilter = 'published'; state.photoCohort = 'new'; state.photoSearch = ''; render(); }
    return `已加入相册草稿，保存后发布到网站${metadata.takenAt ? ` · 拍摄时间 ${metadata.takenAt}` : ' · 请补充拍摄时间'}${metadata.fileModifiedAt && !metadata.takenAt ? `；文件修改时间仅供参考：${formatDate(metadata.fileModifiedAt)}` : ''}`;
  }
  if (!cache.width) { const decoded = await decodeImage(file); cache.width = decoded.width; cache.height = decoded.height; decoded.close?.(); }
  if (!cache.uploaded) { setJobProgress(job, '上传图片…', 10); cache.uploaded = await uploadBlob(job, file, options.kind, file.name, 10, 99, cache.mime); }
  if (cloudLocked() || !state.content || !state.jobs.includes(job)) throw staleRequest();
  options.onComplete?.({ reference: cache.uploaded.key, width: cache.width, height: cache.height });
  return '图片已加入草稿，保存后可发布。';
}

function previewSection() {
  return state.section === 'texts' ? editorCopySection(state.textGroup).section : { owner: 'collection', outfits: 'hello', photos: 'moments', journal: 'collection' }[state.section] || 'home';
}
function previewLanguage() { return state.section === 'texts' ? state.textLanguage : 'zh'; }
function setPreviewTarget(target) {
  if (cloudLocked()) return;
  $('#preview-target').value = target;
  const frame = $('#site-preview');
  const url = new URL('../', location.href); url.searchParams.set('editor-preview', previewToken); url.searchParams.set('lang', previewLanguage()); url.hash = target;
  if (!frame.src || new URL(frame.src).hash !== url.hash || new URL(frame.src).searchParams.get('editor-preview') !== previewToken) frame.src = url.href;
  postPreview();
}
function togglePreview(open = !state.preview) {
  if (open && cloudLocked()) return;
  state.preview = open; $('#preview-pane').hidden = !open; $('.content-layout').classList.toggle('with-preview', open); $('#preview-toggle').textContent = open ? '关闭预览' : '打开预览';
  if (open) setPreviewTarget(previewSection());
}
function postPreview() {
  if (cloudLocked() || !state.preview || !state.content || !$('#site-preview').contentWindow) return;
  const content = publicGardenContent(state.content, { mediaBaseUrl: state.content.settings.mediaBaseUrl || state.mediaBaseUrl || location.origin });
  $('#site-preview').contentWindow.postMessage({ type: 'garden-preview', token: previewToken, content, ...(state.section === 'texts' ? { language: previewLanguage() } : {}) }, location.origin);
}

const commentStatusNames = { pending: '待审核', approved: '已通过', rejected: '已拒绝', spam: '垃圾', deleted: '已删除' };
let messagesRequest = 0;
const messageActions = new Set();
async function refreshMessages({ quiet = false } = {}) {
  if (!state.authenticated || !state.connected || document.hidden) return;
  if (state.messagesBusy) { state.messagesRefreshQueued = true; return; }
  state.messagesBusy = true; const request = ++messagesRequest;
  try {
    const query = new URLSearchParams({ status: state.messageStatus, limit: '200' }); if (state.messageUnread) query.set('unread', 'true');
    const notificationRequest = api(`/api/admin/notifications?limit=${state.section === 'messages' ? 200 : 1}`);
    const [notifications, comments] = await Promise.all([notificationRequest, state.section === 'messages' ? api(`/api/admin/comments?${query}`) : Promise.resolve(null)]);
    if (request !== messagesRequest) return;
    state.notifications = notifications.notifications || []; state.unreadCount = Number(notifications.unreadCount) || 0;
    state.pendingCount = Number(comments?.pendingCount ?? notifications.pendingCount) || 0;
    if (comments) state.comments = comments.comments || [];
    state.messagesLoaded = true; state.messagesError = ''; navigation();
    const editingReply = document.activeElement?.closest('.message-reply');
    if (state.section === 'messages' && !(quiet && editingReply)) renderMessagesBody();
  } catch (error) {
    state.messagesError = error.message;
    if ([401, 403].includes(error.status) || error.offline && state.cloudMode) reportError(error);
    else if (!quiet) toast(`读取消息失败：${error.message}`, true);
    if (state.section === 'messages') renderMessagesBody();
  } finally { state.messagesBusy = false; if (state.messagesRefreshQueued) { state.messagesRefreshQueued = false; refreshMessages({ quiet: true }); } }
}
function renderMessages() {
  if (!state.authenticated) return [intro('消息中心', '登录后可查看留言、处理审核和回复。通知只会出现在管理端，不会发送邮件。'), empty('登录后查看消息', '先连接管理服务并登录管理员账号。', button('连接与登录', () => selectSection('settings')))];
  const container = node('div', { id: 'message-content' });
  queueMicrotask(() => renderMessagesBody());
  return [intro('留言与通知', '审核相册与碎碎念下的留言。管理员回复会在公开页面标记；消息与已读状态即时保存。', button('刷新消息', () => refreshMessages())), container];
}
function renderMessagesBody() {
  if (cloudLocked()) return;
  const container = $('#message-content'); if (!container) return;
  const view = node('div', { class: 'message-tabs', role: 'tablist', 'aria-label': '消息类别' }, ...[['comments', '留言审核'], ['notifications', '未读通知']].map(([key, label]) => button(label, () => { state.messageView = key; renderMessagesBody(); }, state.messageView === key ? 'primary' : 'secondary', { role: 'tab', 'aria-selected': state.messageView === key })));
  const stats = node('div', { class: 'message-summary' }, node('span', { class: 'pill draft' }, `待审核 ${state.pendingCount}`), node('span', { class: 'pill published' }, `未读 ${state.unreadCount}`), node('span', { class: 'small-note' }, '页面可见时每 30 秒更新；输入回复时保留编辑。'));
  const status = node('select', { 'aria-label': '留言审核状态' }, ...[['all', '全部状态'], ...Object.entries(commentStatusNames)].map(([value, label]) => node('option', { value }, label)));
  status.value = state.messageStatus;
  status.addEventListener('change', async () => { state.messageStatus = status.value; await refreshMessages(); });
  const unread = node('input', { type: 'checkbox', checked: state.messageUnread });
  unread.addEventListener('change', async () => { state.messageUnread = unread.checked; await refreshMessages(); });
  const filters = state.messageView === 'comments' ? node('div', { class: 'toolbar' }, status, node('label', { class: 'selection-label' }, unread, '只看未读')) : node('div', { class: 'toolbar' }, button('将全部通知标为已读', () => mutateMessages('notifications', () => api('/api/admin/notifications/read', { method: 'POST', body: { all: true } })), 'secondary', { disabled: !state.unreadCount || messageActions.has('notifications') }));
  const records = state.messageView === 'comments' ? state.comments : state.notifications.filter(item => !item.readAt);
  container.replaceChildren(...[view, stats, filters,
    state.messagesError ? panel(node('p', { class: 'metadata-warning' }, `消息暂时无法读取：${state.messagesError}`), button('重试', () => refreshMessages())) : null,
    ...records.map(commentCard),
    !records.length ? empty(state.messagesLoaded ? '这里暂时很安静' : '正在读取消息', state.messageView === 'comments' ? '当前筛选下没有留言。' : '所有通知都已读。') : null,
    records.length >= 200 ? node('p', { class: 'small-note' }, '当前最多展示 200 条，请按状态或未读筛选处理。') : null].filter(Boolean));
}
function targetContext(comment) {
  const photo = comment.targetType === 'photo' ? state.content.media.find(item => item.id === comment.targetId) : null;
  const note = comment.targetType === 'note' ? state.content.journal.find(item => item.id === comment.targetId) : null;
  const label = photo ? photoName(photo) : note ? localizedValue(note.title) || localizedValue(note.body).slice(0, 50) || '图片碎碎念' : '内容已从当前草稿移除';
  return node('div', { class: 'comment-context' }, photo ? image(photo.thumbnail || photo.url, '', '') : note?.images?.[0] ? image(note.images[0].url, '', '') : null, node('div', {}, node('span', { class: 'small-note' }, comment.targetType === 'photo' ? '相册照片' : '碎碎念'), node('p', {}, label), photo || note ? button('查看内容', () => {
    selectSection(photo ? 'photos' : 'journal');
    if (photo) state.selectedPhoto = photo.id; else state.selectedPost = note.id;
    render();
  }, 'secondary small') : node('small', {}, comment.targetId)));
}
function commentCard(comment) {
  const busy = messageActions.has(comment.id);
  const patch = body => mutateMessages(comment.id, () => api(`/api/admin/comments/${encodeURIComponent(comment.id)}`, { method: 'PATCH', body }));
  const reply = node('textarea', { value: state.replyDrafts[comment.id] || '', rows: 3, maxlength: 2000, placeholder: '以管理员身份回复这条留言…', 'aria-label': `回复 ${comment.nickname || '访客'}`, disabled: busy });
  reply.addEventListener('input', () => { state.replyDrafts[comment.id] = reply.value; });
  const replySubmit = node('button', { type: 'submit', class: 'button primary small', disabled: busy }, '发送管理员回复');
  const replyForm = node('form', { class: 'message-reply' }, node('label', { class: 'field' }, node('span', {}, '管理员回复'), reply), replySubmit);
  replyForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!reply.value.trim()) { reply.focus(); return; }
    replySubmit.disabled = true; const draft = reply.value;
    const sent = await mutateMessages(comment.id, () => api(`/api/admin/comments/${encodeURIComponent(comment.id)}/reply`, { method: 'POST', body: { body: reply.value.trim() } }));
    if (sent) { if (state.replyDrafts[comment.id] === draft) delete state.replyDrafts[comment.id]; renderMessagesBody(); }
    else replySubmit.disabled = false;
  });
  return panel(node('div', { class: 'comment-heading' }, node('strong', {}, comment.nickname || '访客'), comment.verified ? node('span', { class: 'pill published' }, '管理员') : null, node('span', { class: `pill ${comment.status === 'pending' ? 'draft' : ''}` }, commentStatusNames[comment.status] || comment.status), !comment.readAt ? node('span', { class: 'pill published' }, '未读') : null, node('time', { datetime: comment.createdAt, class: 'small-note' }, formatDate(comment.createdAt))),
    comment.parentId ? node('p', { class: 'small-note' }, `回复于留言 ${comment.parentId}`) : null,
    node('p', { class: 'comment-body' }, comment.body), targetContext(comment),
    node('div', { class: 'row-actions comment-actions' }, ...[
      ['approved', '批准', 'primary'], ['rejected', '拒绝', 'secondary'], ['spam', '标为垃圾', 'secondary'], ['deleted', '删除', 'danger'],
    ].filter(([status]) => comment.status !== status).map(([status, label, kind]) => button(label, async () => {
      if (status === 'deleted' && !await confirmAction('删除这条留言？', '留言将从公开页面与正常审核列表隐藏，后台保留删除状态。', '删除留言')) return;
      await patch(status === 'approved' ? { status, read: true } : { status });
    }, `${kind} small`, { disabled: busy })), !comment.readAt ? button('标为已读', () => patch({ read: true }), 'secondary small', { disabled: busy }) : null),
    comment.status === 'approved' ? replyForm : comment.status === 'pending' ? node('p', { class: 'small-note' }, '批准后可以发送管理员回复。') : null);
}
async function mutateMessages(id, action) {
  if (cloudLocked() || messageActions.has(id)) return false;
  messageActions.add(id);
  // Keep unsent reply text in place until the server confirms success.
  try {
    const result = await action();
    if (result.unreadCount !== undefined) state.unreadCount = Number(result.unreadCount) || 0;
    if (result.pendingCount !== undefined) state.pendingCount = Number(result.pendingCount) || 0;
    messageActions.delete(id); toast('消息处理已保存。'); await refreshMessages(); return true;
  } catch (error) {
    if ([401, 403].includes(error.status) || error.offline && state.cloudMode) reportError(error); else if (!error.stale) toast(`消息处理失败：${error.message}`, true);
    return false;
  } finally { messageActions.delete(id); navigation(); }
}

$('#save-draft').addEventListener('click', saveDraft);
$('#publish').addEventListener('click', publish);
$('#preview-toggle').addEventListener('click', () => togglePreview());
$('#preview-close').addEventListener('click', () => togglePreview(false));
$('#preview-target').addEventListener('change', event => setPreviewTarget(event.target.value));
$('#site-preview').addEventListener('load', postPreview);
window.addEventListener('message', event => { if (event.origin === location.origin && event.source === $('#site-preview').contentWindow && event.data?.token === previewToken && event.data.type === 'garden-preview-ready') postPreview(); });
$('#clear-uploads').addEventListener('click', () => { state.jobs = state.jobs.filter(job => job.status !== 'done'); renderUploads(); });
$('#json-import').addEventListener('change', event => { importJSON(event.target.files[0]); event.target.value = ''; });
$('#logout').addEventListener('click', async () => {
  if (state.busy || state.running || state.jobs.some(job => ['queued', 'running'].includes(job.status))) { toast('请等待保存、发布或图片导入结束后再退出登录。', true); return; }
  if ((state.dirty || Object.values(state.replyDrafts).some(value => value.trim())) && !await confirmAction('退出管理登录？', '当前未保存的编辑和本机草稿备份会清除。需要保留时，请先取消并保存草稿或导出 JSON。', '清除并退出')) return;
  if (state.busy || state.running || state.jobs.some(job => ['queued', 'running'].includes(job.status))) return;
  try { await api('/api/admin/logout', { method: 'POST' }); state.authenticated = false; state.csrf = ''; clearPrivateContent(); showAuth(); updateChrome(); render(); toast('已退出管理登录，本机草稿缓存已清除。'); }
  catch (error) { reportError(error); }
});
window.addEventListener('beforeunload', event => {
  if (Object.values(state.replyDrafts).some(value => value.trim()) || state.dirty || state.jobs.some(job => ['queued', 'running', 'error'].includes(job.status))) { persistLocal(); event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('focus', () => refreshMessages({ quiet: true }));
window.addEventListener('offline', () => { if (state.cloudMode) reportError(Object.assign(new Error('网络连接已中断。'), { offline: true })); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMessages({ quiet: true }); });
setInterval(() => refreshMessages({ quiet: true }), 30000);
try { restoreCohort(JSON.parse(sessionStorage.getItem(COHORT_KEY) || 'null')); } catch { /* Optional session labels never block content loading. */ }
try {
  state.localBackup = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  state.cloudMode = state.localBackup?.mode === 'cloud' || localStorage.getItem(MODE_KEY) === 'cloud';
} catch { /* Invalid old backup never replaces the server draft. */ }
navigation(); loadAdminRuntime(); connect();

async function loadAdminRuntime() {
  try {
    const response = await fetch('../data/runtime.json', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const runtime = await response.json();
    if (runtime?.schemaVersion !== 1 || typeof runtime.adminUrl !== 'string' || /[\u0000-\u0020\u007f]/.test(runtime.adminUrl)) return;
    const url = new URL(runtime.adminUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href === location.href) return;
    state.cloudAdminUrl = url.href; appendCloudAdminEntry();
    if (state.section === 'settings') render();
  } catch { /* Optional public configuration never changes same-origin admin API access. */ }
}
function appendCloudAdminEntry() {
  if (state.connected || !state.cloudAdminUrl || $('#banner').hidden || $('#cloud-admin-entry')) return;
  $('#banner').append(node('a', { id: 'cloud-admin-entry', class: 'button primary', href: state.cloudAdminUrl, target: '_blank', rel: 'noopener' }, '打开云端管理页'));
}
