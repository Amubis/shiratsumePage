import { extractPhotoMetadata } from '../src/photo-metadata.js';
import { normalizeGardenContent, validateGardenContent, publicGardenContent } from '../src/garden-content.js';

const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'garden-admin-json-draft-v1';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const sections = [
  ['overview', '⌂', '花园概览'], ['texts', '文', '中日文案'], ['owner', '◉', '作者资料'],
  ['outfits', '♧', '服装展示'], ['photos', '▧', '照片相册'], ['journal', '✎', '碎碎念'], ['messages', '◌', '消息中心'], ['settings', '⚙', '连接与备份'],
];
const groupNames = { site: '首页与导航', album: '相册', outfits: '服装交互', owner: '作者浮层', personal: '作者个人页', fixed: '固定界面文案', comments: '留言与审核提示' };
const state = {
  content: null, revision: null, authenticated: false, connected: false, session: null,
  csrf: '', mediaBaseUrl: '', cloudAdminUrl: '', dirty: false, conflict: false, busy: false, section: 'overview',
  selectedOutfit: null, selectedPhoto: null, selectedPost: null, selectedPhotos: new Set(),
  photoFilter: 'all', photoSearch: '', textGroup: 'site', textSearch: '',
  jobs: [], running: 0, preview: false, localBackup: null,
  comments: [], notifications: [], unreadCount: 0, pendingCount: 0, messageView: 'comments', messageStatus: 'pending', messageUnread: false, messagesBusy: false, messagesLoaded: false, messagesError: '', replyDrafts: {},
};
let uid = 0, localTimer, previewTimer, toastTimer;
const previewToken = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const identifier = (prefix) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${++uid}`}`;

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
    const amount = key === 'photos' ? state.content?.media?.length : key === 'outfits' ? state.content?.outfits?.length : key === 'journal' ? state.content?.journal?.length : key === 'messages' ? `${state.unreadCount}未读\n${state.pendingCount}待审` : undefined;
    return node('button', { type: 'button', class: `nav-button${state.section === key ? ' active' : ''}`, 'aria-current': state.section === key ? 'page' : undefined, onclick: () => selectSection(key) }, node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), label, amount !== undefined ? node('span', { class: 'nav-count' }, amount) : null);
  }));
}
function selectSection(key) {
  state.section = key; state.selectedPhoto = null; navigation(); render();
  if (key === 'messages') refreshMessages();
  $('#page-title').textContent = sections.find(([name]) => name === key)?.[2] || '花园概览';
  if (state.preview) setPreviewTarget({ texts: 'home', owner: 'collection', outfits: 'hello', photos: 'moments', journal: 'collection' }[key] || 'home');
  if (window.innerWidth < 850) $('#editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function changed() {
  state.dirty = true; updateChrome();
  clearTimeout(localTimer); localTimer = setTimeout(persistLocal, 500);
  clearTimeout(previewTimer); previewTimer = setTimeout(postPreview, 250);
}
function persistLocal() {
  if (!state.content) return;
  try {
    // Content JSON only. Passwords, cookies, CSRF tokens, blobs and File objects never enter storage.
    const backup = { content: clone(state.content), revision: state.revision, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(backup)); state.localBackup = backup;
  } catch { toast('浏览器草稿备份空间不足，请导出 JSON 保存当前编辑。', true); }
}
function updateChrome() {
  const uploadsActive = state.jobs.some(job => ['queued', 'running'].includes(job.status));
  $('#connection-label').textContent = state.connected ? state.authenticated ? (state.session?.mode === 'cloud' ? '云端已连接' : '本地服务已连接') : '等待登录' : '未连接 API · 仅本地编辑';
  $('#connection-dot').classList.toggle('online', state.connected && state.authenticated);
  $('#logout').hidden = !state.authenticated || state.session?.mode === 'local';
  const label = !state.content ? '尚未载入' : state.conflict ? '版本冲突 · 请重新载入' : state.busy ? '正在处理…' : state.dirty ? '有未保存的编辑' : state.connected && state.authenticated ? '草稿已同步' : '仅浏览器草稿';
  $('#save-state').textContent = label; $('#save-state').classList.toggle('dirty', state.dirty || state.conflict);
  $('#save-draft').disabled = !state.content || !state.authenticated || !state.connected || state.busy || state.conflict || uploadsActive;
  $('#publish').disabled = !state.content || !state.authenticated || !state.connected || state.busy || state.conflict || state.dirty || uploadsActive;
  $('#preview-toggle').disabled = !state.content;
  navigation();
}
async function api(path, { method = 'GET', body, csrf = method !== 'GET' } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf) headers['X-Garden-CSRF'] = state.csrf;
  let response;
  try { response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' }); }
  catch { const error = new Error('无法连接同源管理 API。请确认管理服务正在运行。'); error.offline = true; throw error; }
  const type = response.headers.get('Content-Type') || '';
  let data;
  try { if (!type.includes('json')) throw new Error('not-json'); data = await response.json(); }
  catch { const error = new Error('此地址尚未连接管理 API，当前只能在浏览器编辑与导出 JSON。'); error.offline = true; throw error; }
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : typeof data.message === 'string' ? data.message : `请求失败（${response.status}）`);
    error.status = response.status; error.details = data; throw error;
  }
  return data;
}
function reportError(error, context = '') {
  if (error.status === 409) {
    state.conflict = true;
    banner('草稿已被另一个窗口修改。当前编辑已保留在浏览器；请先导出备份，再重新载入服务端草稿。为避免覆盖他人编辑，保存和发布已暂停。', true, { label: '导出当前 JSON', run: exportJSON });
  } else if (error.status === 401 || error.status === 403) {
    state.authenticated = false; state.csrf = ''; showAuth();
    banner(`登录或会话验证已失效。当前编辑仍保留，请重新登录后重新载入草稿。${error.message ? ` ${error.message}` : ''}`, true);
  } else {
    toast(`${context}${error.message}`, true);
    if (error.offline) { state.connected = false; banner('管理 API 未连接。当前编辑仅保存在此浏览器；可以导出 JSON 备份，线上网站尚未更改。', true); }
  }
  updateChrome();
}
function installContent(input, revision = null) {
  clearTimeout(localTimer);
  state.content = normalizeGardenContent(input); state.revision = revision; state.dirty = false; state.conflict = false;
  state.selectedPhotos.clear(); state.selectedPhoto = null; state.selectedOutfit = null; state.selectedPost = null;
  updateChrome(); render(); postPreview();
}
async function loadContent({ discard = false } = {}) {
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
  const backup = state.localBackup;
  if (!backup?.content || JSON.stringify(backup.content) === JSON.stringify(state.content)) return;
  banner(`发现此浏览器保存的编辑备份（${formatDate(backup.savedAt)}）。恢复后需再次保存到服务端。`, false, { label: '查看恢复选项', run: restoreBackup });
}
async function restoreBackup() {
  if (!state.localBackup?.content) return;
  if (!await confirmAction('恢复浏览器草稿？', '恢复会替换当前编辑。服务端草稿仍保持原样；恢复后请检查内容，再点击「保存草稿」。', '恢复编辑')) return;
  const revision = state.revision;
  installContent(state.localBackup.content, revision); changed(); $('#banner').hidden = true; toast('已恢复浏览器编辑，请检查后保存。');
}
async function connect() {
  try {
    const session = await api('/api/admin/session');
    state.connected = true; state.session = session; state.authenticated = !!session.authenticated; state.csrf = session.csrfToken || ''; state.mediaBaseUrl = session.mediaBaseUrl || '';
    showAuth(); updateChrome();
    if (state.authenticated) {
      if (state.content && state.dirty) { state.conflict = true; banner('连接已恢复。浏览器编辑仍在，请先导出备份，再载入服务端草稿以检查版本。', false, { label: '重新载入', run: () => loadContent() }); }
      else await loadContent({ discard: true });
      refreshMessages({ quiet: true });
    }
    else {
      if (!session.configured) banner('云端管理尚未配置登录密钥与存储绑定。请完成服务端配置后重新连接；当前仅支持本地编辑与 JSON 导出。', true);
      await loadSeed();
    }
  } catch (error) {
    state.connected = false; state.authenticated = false; state.csrf = ''; showAuth();
    banner('这个站点尚未连接管理 API。可以编辑打包内容并导出 JSON；上传、保存服务端草稿和发布需要同源的本地或云端管理服务。', false, { label: '重新连接', run: connect });
    await loadSeed();
  }
  updateChrome();
}
async function loadSeed() {
  if (state.content) return;
  try {
    const response = await fetch('../data/garden.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('没有打包内容');
    installContent(await response.json()); offerBackup();
  } catch {
    if (state.localBackup?.content) { installContent(state.localBackup.content); state.dirty = true; updateChrome(); toast('已打开浏览器里的 JSON 草稿。'); }
    else {
      $('#editor').replaceChildren(empty('还没有可编辑的内容', '连接管理 API，或导入先前导出的花园 JSON 备份。', button('导入 JSON', () => $('#json-import').click())));
    }
  }
}
function showAuth() {
  const target = $('#auth-panel');
  target.hidden = !state.connected || state.authenticated;
  if (target.hidden) return;
  const password = node('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': '管理员密码' });
  const submit = node('button', { type: 'submit', class: 'button primary', disabled: state.session?.configured === false }, '登录管理');
  const form = node('form', { class: 'auth-form' }, node('label', { class: 'field' }, node('span', {}, '管理员密码'), password), submit);
  form.addEventListener('submit', async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      const session = await api('/api/admin/login', { method: 'POST', body: { password: password.value }, csrf: false });
      password.value = ''; state.session = session; state.authenticated = !!session.authenticated; state.csrf = session.csrfToken || ''; state.mediaBaseUrl = session.mediaBaseUrl || ''; showAuth();
      if (state.dirty) {
        banner('已登录。当前浏览器编辑尚未关联最新服务端版本，请导出备份，再重新载入服务端草稿以继续。', false, { label: '重新载入', run: () => loadContent() });
        state.conflict = true; updateChrome();
      } else await loadContent({ discard: true });
      refreshMessages({ quiet: true });
    } catch (error) { reportError(error, '登录失败：'); }
    finally { submit.disabled = state.session?.configured === false; }
  });
  target.replaceChildren(node('h2', {}, '登录花园管理'), node('p', { class: 'muted' }, '登录状态通过同源 HttpOnly Cookie 保存。密码只用于本次登录，不会写入草稿或浏览器存储。'), form);
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
  const photoCount = state.content.media.filter(item => item.enabled).length, postCount = state.content.journal.filter(item => item.published).length;
  if (!await confirmAction('将草稿发布到网站？', `即将发布已保存的全部文案、作者资料和服装，以及 ${photoCount} 张已勾选照片、${postCount} 条已勾选碎碎念。未勾选项目继续保留在草稿中。`, '确认发布')) return;
  state.busy = true; updateChrome();
  try {
    const result = await api('/api/admin/publish', { method: 'POST', body: { revision: state.revision } });
    if (result.published !== true) throw new Error('服务端未确认发布成功，请检查后重试。');
    if (result.revision !== undefined) state.revision = result.revision;
    persistLocal(); toast('发布成功，网站内容已更新。');
  } catch (error) { reportError(error, '发布失败：'); }
  finally { state.busy = false; updateChrome(); }
}
function showValidation(errors) {
  banner(`内容尚有 ${errors.length} 项需要检查：${errors.slice(0, 4).join('；')}${errors.length > 4 ? '…' : ''}`, true);
  $('#banner').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function exportJSON() {
  if (!state.content) return;
  const blob = new Blob([JSON.stringify(state.content, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = node('a', { href: url, download: `garden-draft-${new Date().toISOString().slice(0, 10)}.json` });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast('已导出当前 JSON 草稿。原始图片文件不包含在 JSON 内。');
}
async function importJSON(file) {
  if (!file) return;
  if (state.jobs.some(job => ['queued', 'running'].includes(job.status))) { toast('请等待当前导入任务完成，再导入 JSON。', true); return; }
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('JSON 备份超过 5MB，请检查文件。');
    const input = JSON.parse(await file.text());
    const errors = validateGardenContent(input);
    if (errors.length) throw new Error(errors.slice(0, 5).join('；'));
    if (!await confirmAction('导入 JSON 草稿？', '这会替换当前编辑，但不会自动保存到服务端或发布。图片引用仍需要对应的存储服务。', '导入草稿')) return;
    const revision = state.revision; installContent(input, revision); changed(); toast('JSON 已导入，请检查后保存草稿。');
  } catch (error) { toast(`无法导入：${error.message}`, true); }
}
function formatDate(value) {
  if (!value) return '未填写时间';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function render() {
  if (!state.content) return;
  const renderers = { overview: renderOverview, texts: renderTexts, owner: renderOwner, outfits: renderOutfits, photos: renderPhotos, journal: renderJournal, settings: renderSettings, messages: renderMessages };
  try { $('#editor').replaceChildren(...renderers[state.section]()); }
  catch (error) {
    $('#editor').replaceChildren(node('div', { class: 'error-page' }, node('h2', {}, '这部分内容暂时无法显示'), node('p', { class: 'muted' }, '当前编辑仍然保留，可以导出备份或重新载入草稿。'), node('pre', {}, error.message), button('导出 JSON', exportJSON)));
    console.error(error);
  }
}
function renderOverview() {
  const { media, outfits, journal } = state.content;
  return [
    node('section', { class: 'welcome' }, node('h2', {}, '照顾好每一片，', node('br'), '属于你的四叶草。'), node('p', {}, '从一句欢迎语，到一张旅途中的照片。这里的每次整理，都可以先存为草稿，慢慢检查，再让大家看见。'), node('span', { class: 'big-clover', 'aria-hidden': 'true' }, '✤')),
    node('div', { class: 'stats' }, ...[
      ['照片相册', media.length, `${media.filter(item => item.enabled).length} 张已勾选发布`, 'photos'], ['服装展示', outfits.length, '正面 · 背面 · 校准', 'outfits'],
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
  const content = state.content;
  const groupSelect = node('select', { 'aria-label': '文案分组' }, ...Object.keys(groupNames).map(key => node('option', { value: key }, groupNames[key])));
  groupSelect.value = state.textGroup;
  groupSelect.addEventListener('change', () => { state.textGroup = groupSelect.value; render(); });
  const search = node('input', { type: 'search', placeholder: '搜索文案名称或内容…', value: state.textSearch, 'aria-label': '搜索文案' });
  let debounce; search.addEventListener('input', () => { state.textSearch = search.value; clearTimeout(debounce); debounce = setTimeout(() => renderTextCards(cards), 120); });
  const cards = node('div'); renderTextCards(cards);
  const profile = content.modelProfile;
  return [intro('一句一句，写出花园的语气', '所有公开页面文案集中在这里。支持直接换行；旧文案中的 <br> 和 <small> 仅作为兼容格式保留，不会执行脚本。'),
    node('div', { class: 'toolbar' }, groupSelect, search), cards,
    panel(node('h2', {}, '模型简介'), node('p', { class: 'muted' }, '主模型的名称和介绍。第二模型仍保留原来的占位内容。'), localizedFields('模型名称', profile, 'name'),
      ...['eyebrow', 'heading', 'lead', 'description'].map(key => node('div', { class: 'field-grid' }, ...['zh', 'ja'].map(locale => field(`${{ eyebrow: '小标题', heading: '大标题', lead: '引导语', description: '模型介绍' }[key]} · ${locale === 'zh' ? '中文' : '日本語'}`, profile[locale]?.[key], value => { profile[locale] ||= {}; profile[locale][key] = value; }, { multiline: ['lead', 'description'].includes(key) }))))),
  ];
}
function renderTextCards(target) {
  const group = state.content.texts[state.textGroup] || { zh: {}, ja: {} };
  const keys = [...new Set([...Object.keys(group.zh || {}), ...Object.keys(group.ja || {})])];
  const query = state.textSearch.trim().toLowerCase();
  const filtered = keys.filter(key => !query || `${key} ${group.zh?.[key] || ''} ${group.ja?.[key] || ''}`.toLowerCase().includes(query));
  target.replaceChildren(...filtered.map(key => node('section', { class: 'panel translation-card' }, node('h3', { class: 'text-key' }, key), node('div', { class: 'field-grid' }, ...['zh', 'ja'].map(locale => field(locale === 'zh' ? '中文' : '日本語', group[locale]?.[key] || '', value => {
    state.content.texts[state.textGroup] ||= { zh: {}, ja: {} }; state.content.texts[state.textGroup][locale] ||= {}; state.content.texts[state.textGroup][locale][key] = value;
  }, { multiline: true }))))));
  if (!filtered.length) target.append(empty('没有匹配的文案', query ? '换一个关键词试试。' : '这一组暂无可编辑字段，连接管理 API 后会载入完整文案。'));
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
  return [intro('让大家认识花园的主人', '头像、简介和平台主页会同步到左上作者资料与个人名片。'),
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
  return state.content.media.filter(item => (state.photoFilter === 'all' || (state.photoFilter === 'published' ? item.enabled : !item.enabled)) && (!query || `${photoName(item)} ${localizedValue(item.alt)} ${item.worldId} ${item.modelIds.join(' ')}`.toLowerCase().includes(query)));
}
function renderPhotos() {
  if (state.selectedPhoto) {
    const current = state.content.media.find(item => item.id === state.selectedPhoto);
    if (current) return renderPhotoDetail(current);
    state.selectedPhoto = null;
  }
  const picker = uploadPicker('选择照片', 'image/png,image/jpeg,image/webp', files => queueFiles(files, { kind: 'photo' }), true);
  const drop = node('div', { class: 'dropzone' }, node('div', {}, node('h3', {}, '把旅途带进花园'), node('p', {}, '拖入多张 PNG、JPEG 或 WebP。先读取元数据，再保留私有原图，生成公开展示图与缩略图。', node('br'), '最多同时导入 2 张；新照片默认不发布。')), picker);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragover'); queueFiles([...event.dataTransfer.files], { kind: 'photo' }); });
  const search = node('input', { type: 'search', value: state.photoSearch, placeholder: '搜索世界、说明或模型…', 'aria-label': '搜索照片' });
  let debounce; search.addEventListener('input', () => { state.photoSearch = search.value; clearTimeout(debounce); debounce = setTimeout(() => renderPhotoGrid(grid), 150); });
  const filter = node('select', { 'aria-label': '照片发布筛选' }, ...[['all', '全部照片'], ['draft', '草稿照片'], ['published', '已勾选发布']].map(([value, label]) => node('option', { value }, label)));
  filter.value = state.photoFilter; filter.addEventListener('change', () => { state.photoFilter = filter.value; render(); });
  const all = node('input', { type: 'checkbox', checked: filteredPhotos().length > 0 && filteredPhotos().every(item => state.selectedPhotos.has(item.id)), 'aria-label': '选择当前筛选的全部照片' });
  all.addEventListener('change', () => { for (const item of filteredPhotos()) all.checked ? state.selectedPhotos.add(item.id) : state.selectedPhotos.delete(item.id); render(); });
  const grid = node('div', { class: 'photo-grid' }); renderPhotoGrid(grid);
  return [intro('让照片留下旅途的温度', '拍摄日期与世界信息可逐张调整，也可选中后批量编辑。原图仅管理员可下载。'), drop, node('div', { class: 'toolbar' }, search, filter), node('div', { class: 'photo-toolbar' }, node('label', { class: 'selection-label' }, all, '选择当前筛选全部'), node('span', { class: 'small-note' }, `共 ${state.content.media.length} 张 · 已选择 ${state.selectedPhotos.size} 张`)), ...(state.selectedPhotos.size ? [photoBatchEditor()] : []), grid];
}
function renderPhotoGrid(grid) {
  const photos = filteredPhotos();
  grid.replaceChildren(...photos.map(item => {
    const select = node('input', { type: 'checkbox', class: 'photo-select', checked: state.selectedPhotos.has(item.id), 'aria-label': `选择照片：${photoName(item)}` });
    select.addEventListener('change', () => { select.checked ? state.selectedPhotos.add(item.id) : state.selectedPhotos.delete(item.id); render(); });
    return node('article', { class: `photo-card${state.selectedPhotos.has(item.id) ? ' selected' : ''}` }, select, node('span', { class: `pill photo-status ${item.enabled ? 'published' : 'draft'}` }, item.enabled ? '发布' : '草稿'), node('button', { type: 'button', 'aria-label': `编辑照片：${photoName(item)}`, onclick: () => { state.selectedPhoto = item.id; render(); } }, image(item.thumbnail || item.url, localizedValue(item.alt), 'photo-image'), node('div', { class: 'photo-info' }, node('strong', {}, photoName(item)), node('small', {}, item.takenAt || '待补拍摄时间'))));
  }));
  if (!photos.length) grid.append(empty('这里还没有照片', state.photoSearch ? '换一个搜索条件，或查看其他发布状态。' : '导入照片后，可以先作为草稿慢慢整理。'));
}
function photoBatchEditor() {
  const values = {}, selected = () => state.content.media.filter(item => state.selectedPhotos.has(item.id));
  const batchField = (key, label, help = '') => {
    const input = node('input', { type: 'text', placeholder: '留空不修改', 'aria-label': label });
    input.addEventListener('input', () => { values[key] = input.value; });
    return node('label', { class: 'field' }, node('span', {}, label), input, help ? node('span', { class: 'help' }, help) : null);
  };
  const apply = () => {
    for (const item of selected()) {
      for (const key of ['takenAt', 'worldName', 'worldId']) if (values[key]?.trim()) item[key] = values[key].trim();
      if (values.modelIds?.trim()) item.modelIds = values.modelIds.split(/[,，\s]+/).filter(Boolean);
      for (const locale of ['zh', 'ja']) if (values[`alt_${locale}`]?.trim()) { if (typeof item.alt === 'string') item.alt = { zh: item.alt, ja: item.alt }; item.alt ||= {}; item.alt[locale] = values[`alt_${locale}`]; }
    }
    changed(); render(); toast('已应用批量编辑，尚未保存草稿。');
  };
  return node('section', { class: 'batch-bar' }, node('h3', {}, `批量编辑 ${state.selectedPhotos.size} 张照片`), node('div', { class: 'batch-fields' }, batchField('takenAt', '拍摄时间', 'YYYY-MM-DD 或 YYYY-MM-DDTHH:mm:ss；无时区时保留原值'), batchField('worldName', '世界名称'), batchField('worldId', '世界 ID'), batchField('modelIds', '模型标签', '多个标签用空格或逗号分开'), batchField('alt_zh', '图片描述 · 中文'), batchField('alt_ja', '图片描述 · 日本語')),
    node('div', { class: 'row-actions' }, button('取消选择', () => { state.selectedPhotos.clear(); render(); }), button('勾选发布', () => { selected().forEach(item => { item.enabled = true; }); changed(); render(); }), button('移回草稿', () => { selected().forEach(item => { item.enabled = false; }); changed(); render(); }), button('清空拍摄时间', () => { selected().forEach(item => { item.takenAt = null; item.timeZone = ''; }); changed(); render(); }), button('应用填写内容', apply, 'primary'), button('删除所选', async () => { if (!await confirmAction('删除所选照片？', `将移除 ${state.selectedPhotos.size} 张照片的内容引用，图片文件保留。`, '删除所选')) return; state.content.media = state.content.media.filter(item => !state.selectedPhotos.has(item.id)); state.selectedPhotos.clear(); changed(); render(); }, 'danger')));
}
function renderPhotoDetail(item) {
  const index = state.content.media.indexOf(item);
  return [intro('整理这一片回忆', '拍摄时间按填写值保存；没有时区的相机时间不会被自动换算。', button('← 返回照片', () => { state.selectedPhoto = null; render(); })),
    panel(node('div', { class: 'detail-top' }, node('div', {}, node('h2', {}, photoName(item)), node('p', { class: 'small-note' }, `照片 ${index + 1} / ${state.content.media.length} · ${item.width || '?'} × ${item.height || '?'}`)), check('勾选发布这张照片', item.enabled, value => { item.enabled = value; })), image(item.url, localizedValue(item.alt), 'detail-image')),
    panel(node('div', { class: 'field-grid' }, field('拍摄时间', item.takenAt, value => { item.takenAt = value || null; item.timeZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? 'offset' : value.includes('T') ? 'unspecified' : ''; }, { placeholder: '2026-11-15T18:30:00', help: '支持日期、无时区本地时间或带 Z / +09:00 的时间' }), field('模型标签', item.modelIds.join(', '), value => { item.modelIds = value.split(/[,，\s]+/).filter(Boolean); }, { help: '多个模型 ID 用空格或逗号分开' }), field('世界名称', item.worldName, value => { item.worldName = value; }), field('世界 ID', item.worldId, value => { item.worldId = value; }, { placeholder: 'wrld_…' })), localizedFields('照片说明', item, 'caption', { multiline: true }), localizedFields('图片描述（辅助阅读）', item, 'alt', { multiline: true }),
      node('details', {}, node('summary', {}, '图片地址与导入信息'), field('展示图', item.url, value => { item.url = value; }), field('缩略图', item.thumbnail, value => { item.thumbnail = value; }), node('p', { class: 'metadata-note' }, `原文件：${item.originalName || '无'}\n时间来源：${item.metadataSource?.takenAt || '手动或未知'}\n世界来源：${item.metadataSource?.world || '手动或未知'}\n时区：${item.timeZone || '未提供'}`), item.warnings?.length ? node('p', { class: 'metadata-note metadata-warning' }, item.warnings.join('\n')) : null),
      node('div', { class: 'row-actions' }, item.originalKey && state.authenticated ? node('a', { class: 'button secondary', href: `/api/admin/original?key=${encodeURIComponent(item.originalKey)}`, download: item.originalName || '' }, '下载私有原图') : null, reorderButtons(state.content.media, index, '照片'), button('删除这张照片', async () => { if (!await confirmAction('删除这张照片？', '从草稿移除内容引用，原图与展示图文件保留。', '删除照片')) return; state.content.media.splice(index, 1); state.selectedPhotos.delete(item.id); state.selectedPhoto = null; changed(); render(); }, 'danger')))];
}
function renderJournal() {
  const journal = state.content.journal;
  const add = () => { const item = { id: identifier('note'), title: '', body: '', images: [], createdAt: new Date().toISOString(), published: false }; journal.unshift(item); state.selectedPost = item.id; changed(); render(); };
  const current = journal.find(item => item.id === state.selectedPost) || journal[0]; if (current) state.selectedPost = current.id;
  const list = node('div', { class: 'item-list' }, ...journal.map((item, index) => node('div', {}, node('button', { type: 'button', class: `item-button journal-item${item === current ? ' active' : ''}`, onclick: () => { state.selectedPost = item.id; render(); } }, item.images[0] ? image(item.images[0].url, '', '') : node('span', { class: 'nav-icon', 'aria-hidden': 'true' }, '✎'), node('span', { class: 'item-label' }, node('strong', {}, localizedValue(item.title) || localizedValue(item.body).slice(0, 24) || '图片碎碎念'), node('small', {}, item.published ? '已勾选发布' : '草稿'))), reorderButtons(journal, index, '碎碎念'))));
  const result = [intro('把小小的心情放在这里', '可以不写标题：纯文字、纯图片，或一起留下。图片与正文至少保留一项。', button('＋ 写一条碎碎念', add, 'primary'))];
  if (!current) return [...result, empty('还没有碎碎念', '不必准备长篇，留下一句话或一张图就好。', button('写第一条', add))];
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
      job.status = 'done'; job.progress = 100; job.note = result || '已加入草稿，请检查后勾选发布。';
      // Completed jobs no longer retain the full-resolution file or browser derivative blobs.
      job.file = { name: job.file.name }; job.cache = {};
    }).catch(error => { job.status = 'error'; job.note = error.message; if ([401, 403].includes(error.status)) reportError(error); }).finally(() => { state.running--; renderUploads(); pumpUploads(); });
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
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
    xhr.onerror = () => reject(new Error('上传连接中断。已完成的步骤会保留，可独立重试这一项。'));
    xhr.ontimeout = () => reject(new Error('上传超时，可独立重试这一项。'));
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
    const item = { id: job.photoId, url: cache.display.key, thumbnail: cache.thumbnail.key, alt: { zh: '', ja: '' }, caption: { zh: '', ja: '' }, modelIds: [state.content.settings.defaultModelId || 'shiratsume'], takenAt: metadata.takenAt, timeZone: metadata.timeZone || '', worldName: metadata.worldName || '', worldId: metadata.worldId || '', sourceKind: 'photo', enabled: false, width: cache.width, height: cache.height, originalKey: cache.original.key, originalName: file.name, metadataSource: { ...metadata.source, fileModifiedAt: metadata.fileModifiedAt }, warnings: metadata.warnings || [] };
    const following = state.jobs.slice(state.jobs.indexOf(job) + 1).find(other => other.photoId && state.content.media.some(photo => photo.id === other.photoId));
    const insertAt = following ? state.content.media.findIndex(photo => photo.id === following.photoId) : state.content.media.length;
    state.content.media.splice(insertAt, 0, item); changed(); if (state.section === 'photos' && !state.selectedPhoto) render();
    return `已导入草稿${metadata.takenAt ? ` · 拍摄时间 ${metadata.takenAt}` : ' · 请补充拍摄时间'}${metadata.fileModifiedAt && !metadata.takenAt ? `；文件修改时间仅供参考：${formatDate(metadata.fileModifiedAt)}` : ''}`;
  }
  if (!cache.width) { const decoded = await decodeImage(file); cache.width = decoded.width; cache.height = decoded.height; decoded.close?.(); }
  if (!cache.uploaded) { setJobProgress(job, '上传图片…', 10); cache.uploaded = await uploadBlob(job, file, options.kind, file.name, 10, 99, cache.mime); }
  options.onComplete?.({ reference: cache.uploaded.key, width: cache.width, height: cache.height });
  return '图片已加入草稿，保存后可发布。';
}

function setPreviewTarget(target) {
  $('#preview-target').value = target;
  const frame = $('#site-preview');
  const url = new URL('../', location.href); url.searchParams.set('editor-preview', previewToken); url.hash = target;
  if (!frame.src || new URL(frame.src).hash !== url.hash || new URL(frame.src).searchParams.get('editor-preview') !== previewToken) frame.src = url.href;
  postPreview();
}
function togglePreview(open = !state.preview) {
  state.preview = open; $('#preview-pane').hidden = !open; $('.content-layout').classList.toggle('with-preview', open); $('#preview-toggle').textContent = open ? '关闭预览' : '打开预览';
  if (open) setPreviewTarget({ owner: 'collection', outfits: 'hello', photos: 'moments', journal: 'collection' }[state.section] || 'home');
}
function postPreview() {
  if (!state.preview || !state.content || !$('#site-preview').contentWindow) return;
  const content = publicGardenContent(state.content, { mediaBaseUrl: state.content.settings.mediaBaseUrl || state.mediaBaseUrl || location.origin });
  $('#site-preview').contentWindow.postMessage({ type: 'garden-preview', token: previewToken, content }, location.origin);
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
    if ([401, 403].includes(error.status)) reportError(error);
    else if (!quiet) toast(`读取消息失败：${error.message}`, true);
    if (state.section === 'messages') renderMessagesBody();
  } finally { state.messagesBusy = false; if (state.messagesRefreshQueued) { state.messagesRefreshQueued = false; refreshMessages({ quiet: true }); } }
}
function renderMessages() {
  if (!state.authenticated) return [intro('花园消息中心', '登录后可查看留言、处理审核和回复。通知只会出现在管理端，不会发送邮件。'), empty('登录后查看消息', '先连接管理服务并登录管理员账号。', button('连接与登录', () => selectSection('settings')))];
  const container = node('div', { id: 'message-content' });
  queueMicrotask(() => renderMessagesBody());
  return [intro('听见花园里的回声', '审核相册与碎碎念下的留言。管理员回复会在公开页面标记；消息与已读状态即时保存。', button('刷新消息', () => refreshMessages())), container];
}
function renderMessagesBody() {
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
      await patch({ status });
    }, `${kind} small`, { disabled: busy })), !comment.readAt ? button('标为已读', () => patch({ read: true }), 'secondary small', { disabled: busy }) : null),
    comment.status === 'approved' ? replyForm : comment.status === 'pending' ? node('p', { class: 'small-note' }, '批准后可以发送管理员回复。') : null);
}
async function mutateMessages(id, action) {
  if (messageActions.has(id)) return false;
  messageActions.add(id);
  // Keep unsent reply text in place until the server confirms success.
  try {
    const result = await action();
    if (result.unreadCount !== undefined) state.unreadCount = Number(result.unreadCount) || 0;
    if (result.pendingCount !== undefined) state.pendingCount = Number(result.pendingCount) || 0;
    messageActions.delete(id); toast('消息处理已保存。'); await refreshMessages(); return true;
  } catch (error) {
    if ([401, 403].includes(error.status)) reportError(error); else toast(`消息处理失败：${error.message}`, true);
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
  try { await api('/api/admin/logout', { method: 'POST' }); state.authenticated = false; state.csrf = ''; state.comments = []; state.notifications = []; state.replyDrafts = {}; state.unreadCount = 0; state.pendingCount = 0; showAuth(); updateChrome(); if (state.section === 'messages') render(); toast('已退出管理登录。'); }
  catch (error) { reportError(error); }
});
window.addEventListener('beforeunload', event => {
  if (Object.values(state.replyDrafts).some(value => value.trim()) || state.dirty || state.jobs.some(job => ['queued', 'running', 'error'].includes(job.status))) { persistLocal(); event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('focus', () => refreshMessages({ quiet: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMessages({ quiet: true }); });
setInterval(() => refreshMessages({ quiet: true }), 30000);
try { state.localBackup = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* Invalid old backup never replaces the server draft. */ }
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
