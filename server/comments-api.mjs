const encoder = new TextEncoder();
const STATUSES = new Set(['pending', 'approved', 'rejected', 'spam', 'deleted']);
const MODERATION_STATUSES = new Set(['approved', 'rejected', 'spam', 'deleted']);
const REVIEW_MESSAGE = 'Your comment is awaiting review.';
const MAX_BODY_BYTES = 16 * 1024;

class CommentError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new CommentError(status, message, extra); };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const cleanText = value => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const length = value => Array.from(value).length;
const publicComment = ({ id, targetType, targetId, parentId, nickname, body, status, verified, createdAt, updatedAt }) => ({ id, targetType, targetId, parentId, nickname, body, status, verified: verified === true, createdAt, updatedAt });

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') fail(415, 'Use application/json.');
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > MAX_BODY_BYTES)) fail(413, 'Comment request is too large.');
  const chunks = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Invalid JSON request.');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); fail(413, 'Comment request is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, 'Invalid JSON request.'); }
}
function requiredText(value, label, max) {
  if (typeof value !== 'string') fail(422, `${label} is required.`);
  const result = cleanText(value);
  if (!result || length(result) > max) fail(422, `${label} must contain 1 to ${max} characters.`);
  return result;
}
function targetFrom(value) {
  if (!['photo', 'note'].includes(value.targetType)) fail(422, 'Choose a photo or note comment target.');
  return { targetType: value.targetType, targetId: requiredText(value.targetId, 'Target ID', 120) };
}
function publishedTarget(content, { targetType, targetId }) {
  return (targetType === 'photo' ? content.media : content.journal)?.some(item => item.id === targetId);
}
function originOf(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null; }
  catch { return null; }
}
const encodeHash = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');

export function isCommentsPath(path) {
  return path === '/api/comments' || path === '/api/admin/comments' || path.startsWith('/api/admin/comments/') || path === '/api/admin/notifications' || path === '/api/admin/notifications/read';
}

/** Anonymous text is stored as text, never HTML; moderation and author identity are server controlled. */
export function createCommentsApi({ store, getPublishedContent, requireAuth, requireWrite, publicSiteOrigins = '', now = () => Date.now(), clientAddress = request => request.headers.get('cf-connecting-ip') || 'unknown', rateLimitSecret = '', onError = () => {} }) {
  const salt = rateLimitSecret || crypto.randomUUID();
  const configuredOrigins = (Array.isArray(publicSiteOrigins) ? publicSiteOrigins : String(publicSiteOrigins || '').split(',')).map(value => originOf(value.trim())).filter(Boolean);
  const allowedOrigin = async request => {
    const origin = request.headers.get('origin');
    if (!origin || originOf(origin) !== origin) return false;
    const ownOrigin = new URL(request.url).origin;
    if (origin === ownOrigin || configuredOrigins.includes(origin)) return true;
    const content = await getPublishedContent();
    return origin === originOf(content.settings?.publicSiteUrl);
  };
  const requireStore = () => {
    if (!store) fail(503, 'Comments are unavailable. Configure the comments database first.', { code: 'comments_unavailable', available: false });
  };
  const pageLimit = url => {
    const raw = url.searchParams.get('limit');
    if (raw === null) return 200;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < 1 || value > 500) fail(400, 'Limit must be between 1 and 500.');
    return value;
  };
  const assertPublished = async target => {
    const content = await getPublishedContent();
    if (!publishedTarget(content, target)) fail(404, 'This published photo or note could not be found.');
    return content;
  };
  const bodyText = body => requiredText(body, 'Comment', 2000);
  return async request => {
    const url = new URL(request.url), path = url.pathname;
    if (!isCommentsPath(path)) return null;
    const publicRoute = path === '/api/comments';
    let corsHeaders = publicRoute && ['GET', 'HEAD'].includes(request.method) ? { 'Access-Control-Allow-Origin': '*' } : {};
    try {
      if (publicRoute && request.method === 'OPTIONS') {
        const method = request.headers.get('access-control-request-method') || 'GET';
        if (!['GET', 'HEAD', 'POST'].includes(method)) fail(405, 'Method not allowed.');
        if (method === 'POST') {
          if (!await allowedOrigin(request)) fail(403, 'This website is not allowed to send comments.');
          const requestedHeaders = (request.headers.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
          if (requestedHeaders.some(value => value !== 'content-type')) fail(403, 'Unsupported comment request headers.');
          corsHeaders = { 'Access-Control-Allow-Origin': request.headers.get('origin'), Vary: 'Origin' };
        } else corsHeaders = { 'Access-Control-Allow-Origin': '*' };
        return new Response(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      if (publicRoute && request.method === 'POST') {
        if (!await allowedOrigin(request)) fail(403, 'This website is not allowed to send comments.');
        corsHeaders = { 'Access-Control-Allow-Origin': request.headers.get('origin'), Vary: 'Origin' };
      }
      if (!publicRoute) {
        if (request.method === 'GET') await requireAuth(request);
        else await requireWrite(request);
      }
      requireStore();
      if (publicRoute && ['GET', 'HEAD'].includes(request.method)) {
        const target = targetFrom(Object.fromEntries(url.searchParams));
        await assertPublished(target);
        const comments = await store.list({ ...target, publicOnly: true, limit: pageLimit(url) });
        const response = json({ available: true, comments: comments.map(publicComment) }, 200, corsHeaders);
        return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
      }
      if (publicRoute && request.method === 'POST') {
        const address = String(clientAddress(request) || 'unknown').slice(0, 200);
        const key = encodeHash(await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:comments:${address}`)));
        const rate = await store.consumeRateLimit(key, now(), { windowMs: 10 * 60 * 1000, max: 5 });
        if (!rate.allowed) fail(429, 'Too many comments. Please try again later.', { retryAfter: rate.retryAfter });
        const body = await readJson(request);
        if (typeof body.website === 'string' && body.website.trim()) return json({ accepted: true, status: 'pending', message: REVIEW_MESSAGE }, 202, corsHeaders);
        const target = targetFrom(body);
        await assertPublished(target);
        let parentId = null;
        if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
          parentId = requiredText(body.parentId, 'Parent comment ID', 120);
          const parent = await store.get(parentId);
          if (!parent || parent.status !== 'approved' || parent.parentId || parent.targetType !== target.targetType || parent.targetId !== target.targetId) fail(422, 'Replies require an approved top-level comment on this target.');
        }
        let nickname = '';
        if (body.nickname !== undefined && body.nickname !== null && body.nickname !== '') nickname = requiredText(body.nickname, 'Nickname', 40);
        const createdAt = new Date(now()).toISOString();
        const comment = await store.insert({ id: crypto.randomUUID(), ...target, parentId, nickname, body: bodyText(body.body), status: 'pending', verified: false, createdAt, updatedAt: createdAt, readAt: null });
        return json({ comment: { id: comment.id, status: 'pending', createdAt: comment.createdAt }, message: REVIEW_MESSAGE }, 201, corsHeaders);
      }
      if (path === '/api/admin/comments' && request.method === 'GET') {
        const status = url.searchParams.get('status');
        if (status && status !== 'all' && !STATUSES.has(status)) fail(400, 'Unknown comment status.');
        const unread = url.searchParams.get('unread');
        if (unread !== null && !['true', 'false'].includes(unread)) fail(400, 'Unread must be true or false.');
        const target = url.searchParams.has('targetType') || url.searchParams.has('targetId') ? targetFrom(Object.fromEntries(url.searchParams)) : {};
        const comments = await store.list({ ...target, ...(status && status !== 'all' ? { status } : {}), ...(unread === null ? {} : { unread: unread === 'true' }), limit: pageLimit(url) });
        return json({ comments, unreadCount: await store.unreadCount(), pendingCount: await store.pendingCount() });
      }
      if (path === '/api/admin/notifications' && request.method === 'GET') {
        return json({ notifications: await store.list({ unread: true, limit: pageLimit(url) }), unreadCount: await store.unreadCount(), pendingCount: await store.pendingCount() });
      }
      if (path === '/api/admin/notifications/read' && request.method === 'POST') {
        const body = await readJson(request);
        if (body.all !== true && (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 500 || body.ids.some(value => typeof value !== 'string' || !value || value.length > 120))) fail(422, 'Provide comment IDs or all: true.');
        const updated = await store.markRead(body.all === true ? { all: true } : { ids: [...new Set(body.ids)] });
        return json({ updated, unreadCount: await store.unreadCount(), pendingCount: await store.pendingCount() });
      }
      const match = /^\/api\/admin\/comments\/([^/]+)(\/reply)?$/.exec(path);
      if (match && request.method === 'PATCH' && !match[2]) {
        const body = await readJson(request);
        if (body.status !== undefined && !MODERATION_STATUSES.has(body.status)) fail(422, 'Choose approved, rejected, spam, or deleted.');
        if (body.read !== undefined && body.read !== true) fail(422, 'Use read: true to mark a comment as read.');
        if (body.status === undefined && body.read !== true) fail(422, 'Provide a moderation status or read: true.');
        const comment = await store.moderate(match[1], { ...(body.status ? { status: body.status } : {}), ...(body.read ? { read: true } : {}) }, new Date(now()).toISOString());
        if (!comment) fail(404, 'Comment not found.');
        return json({ comment, unreadCount: await store.unreadCount(), pendingCount: await store.pendingCount() });
      }
      if (match && request.method === 'POST' && match[2]) {
        const body = await readJson(request);
        const comment = await store.get(match[1]);
        if (!comment) fail(404, 'Comment not found.');
        const parent = comment.parentId ? await store.get(comment.parentId) : comment;
        if (!parent || parent.status !== 'approved' || parent.parentId) fail(409, 'Approve the original comment before replying.');
        const target = { targetType: parent.targetType, targetId: parent.targetId };
        const content = await assertPublished(target);
        const name = content.owner?.name;
        const nickname = cleanText(typeof name === 'string' ? name : name?.zh || name?.ja || '') || '作者';
        const createdAt = new Date(now()).toISOString();
        const reply = await store.insert({ id: crypto.randomUUID(), ...target, parentId: parent.id, nickname: Array.from(nickname).slice(0, 40).join(''), body: bodyText(body.body), status: 'approved', verified: true, createdAt, updatedAt: createdAt, readAt: createdAt });
        return json({ comment: reply, unreadCount: await store.unreadCount(), pendingCount: await store.pendingCount() }, 201);
      }
      fail(405, 'Method not allowed.');
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      if (status >= 500 && status !== 503) onError(error);
      if (error.extra?.retryAfter) corsHeaders['Retry-After'] = String(error.extra.retryAfter);
      return json({ error: status === 500 ? 'Comments storage operation failed. Please retry.' : error.message, ...(error.extra || {}) }, status, corsHeaders);
    }
  };
}
