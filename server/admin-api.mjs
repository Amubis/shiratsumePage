import { normalizeGardenContent, publicGardenContent, validateGardenContent } from '../src/garden-content.js';
import { inspectImage } from './image-format.mjs';
import { createCommentsApi, isCommentsPath } from './comments-api.mjs';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const COOKIE_NAME = '__Host-garden_session';
const SESSION_SECONDS = 12 * 60 * 60;
const IMAGE_KEY = /^media\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const ORIGINAL_KEY = /^private\/originals\/([a-f0-9]{64})\.(png|jpg|webp)$/;
const ROLES = new Set(['original', 'display', 'thumbnail', 'outfit', 'avatar', 'journal']);
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

async function readBytes(request, limit) {
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > limit)) throw new HttpError(413, 'Request body is too large.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, 'Request body is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readJson(request) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Use application/json.');
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, MAX_JSON_BYTES)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

function equalStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return mismatch === 0;
}

function matchesEtag(request, etag) {
  return (request.headers.get('if-none-match') || '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*');
}

function publicHeaders(headers = {}) {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag, Content-Length', 'X-Content-Type-Options': 'nosniff', ...headers };
}

function cookieValue(request) {
  return (request.headers.get('cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || '';
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function assertSameOrigin(request, { required = false } = {}) {
  const origin = request.headers.get('origin');
  if ((required && !origin) || (origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'This action requires a same-origin request.');
}

function revisionFrom(request, body) {
  const header = request.headers.get('if-match')?.replace(/^W\//, '').replace(/^"|"$/g, '');
  if (body.revision && header && body.revision !== header) throw new HttpError(400, 'Revision and If-Match do not agree.');
  const revision = body.revision || header;
  if (typeof revision !== 'string' || !revision) throw new HttpError(428, 'A saved draft revision is required.');
  return revision;
}

function assertRevision(actual, expected) {
  if (actual !== expected) throw new HttpError(409, 'The draft changed in another session. Reload before saving.', { revision: actual });
}

function liveContentPatch(body) {
  const allowed = body.targetType === 'photo' ? { caption: 5000 } : body.targetType === 'journal' ? { title: 500, body: 50000 } : null;
  if (!allowed || typeof body.targetId !== 'string' || !body.targetId.trim() || body.targetId.length > 120 || !['zh', 'ja'].includes(body.locale)) throw new HttpError(422, 'Choose a published photo or journal entry and its language.');
  const patch = body.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !Object.hasOwn(allowed, key))) throw new HttpError(422, 'Only the displayed text fields can be changed here.');
  const fields = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string' || value.length > allowed[key]) throw new HttpError(422, `${key} must be text of no more than ${allowed[key]} characters.`);
    fields[key] = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  }
  return { targetType: body.targetType, targetId: body.targetId.trim(), locale: body.locale, fields };
}

function applyLiveText(record, locale, fields) {
  for (const [key, value] of Object.entries(fields)) {
    const previous = record[key];
    record[key] = { ...(typeof previous === 'string' ? { zh: previous, ja: previous } : previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : { zh: '', ja: '' }), [locale]: value };
  }
}

/** Portable Fetch API handler. Storage adapters implement conditional state writes and immutable objects. */
export function createAdminApi({ storage, commentsStore = null, seed, mode = 'cloud', adminUsername = 'Amubis', adminPassword = '', sessionSecret = '', mediaBaseUrl = '', publicSiteOrigins = '', now = () => Date.now(), clientAddress = request => request.headers.get('cf-connecting-ip') || 'unknown', onError = () => {} }) {
  if (!storage || !seed) throw new Error('Storage and seed content are required.');
  const local = mode === 'local';
  const loginName = typeof adminUsername === 'string' ? adminUsername.trim().toLowerCase() : '';
  const validName = Boolean(loginName && loginName.length <= 120 && !/[\u0000-\u001f\u007f]/.test(loginName));
  const configured = local || (validName && typeof adminPassword === 'string' && adminPassword.length > 0 && typeof sessionSecret === 'string' && sessionSecret.length >= 32);
  const localCsrf = randomToken();
  const attempts = new Map();
  let keyPromise;
  let seedPromise;
  let passwordHashPromise;
  let usernameHashPromise;
  let credentialBindingPromise;

  const hmac = async value => {
    keyPromise ||= crypto.subtle.importKey('raw', encoder.encode(sessionSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    credentialBindingPromise ||= sha256(encoder.encode(JSON.stringify([loginName,adminPassword])));
    const signature = await crypto.subtle.sign('HMAC', await keyPromise, encoder.encode(`garden-auth-v2:${await credentialBindingPromise}:${value}`));
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const initialState = () => seedPromise ||= (async () => {
    const content = normalizeGardenContent(seed);
    const revision = `seed-${await sha256(encoder.encode(JSON.stringify(content)))}`;
    return { schemaVersion: 1, draft: { content, revision }, published: { content, revision }, previousPublished: null };
  })();
  const readState = async () => {
    const stored = await storage.readState();
    return { state: stored?.state || await initialState(), version: stored?.version ?? null };
  };
  const baseUrl = (request, content) => {
    const candidate = mediaBaseUrl || content?.settings?.mediaBaseUrl || new URL(request.url).origin;
    return candidate.replace(/\/$/, '');
  };
  const authenticate = async request => {
    if (local) return { csrfToken: localCsrf };
    if (!configured) return null;
    const token = cookieValue(request);
    if (token.length > 300) return null;
    const match = /^(v1\.([0-9]{10,13})\.[a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return null;
    const expiry = Number(match[2]);
    if (expiry <= now() || expiry > now() + (SESSION_SECONDS + 60) * 1000 || !equalStrings(match[3], await hmac(match[1]))) return null;
    return { csrfToken: await hmac(`csrf:${match[1]}`) };
  };
  const requireAuth = async request => {
    const session = await authenticate(request);
    if (!session) throw new HttpError(configured ? 401 : 503, configured ? 'Sign in to manage this garden.' : 'Set ADMIN_PASSWORD and a SESSION_SECRET of at least 32 characters on the server.');
    return session;
  };
  const requireWrite = async request => {
    assertSameOrigin(request, { required: true });
    const session = await requireAuth(request);
    if (!equalStrings(request.headers.get('x-garden-csrf'), session.csrfToken)) throw new HttpError(403, 'Invalid CSRF token. Reload the management page.');
    return session;
  };
  const sessionBody = async (request, session) => ({ authenticated: Boolean(session), configured, ...(session ? { csrfToken: session.csrfToken } : {}), mode, mediaBaseUrl: baseUrl(request) });
  const writeState = async (state, version) => {
    if (!await storage.writeState(state, version)) throw new HttpError(409, 'The draft changed in another session. Reload before saving.');
  };
  const nextRevision = async content => `r-${await sha256(encoder.encode(`${JSON.stringify(content)}:${randomToken()}`))}`;
  const handleComments = createCommentsApi({
    store: commentsStore,
    getPublishedContent: async () => publicGardenContent((await readState()).state.published.content),
    requireAuth: async request => { assertSameOrigin(request); return requireAuth(request); },
    requireWrite, publicSiteOrigins, now, clientAddress, rateLimitSecret: sessionSecret, onError,
  });

  return async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (isCommentsPath(path)) return handleComments(request);
    const publicRoute = path === '/api/content' || path.startsWith('/media/');
    if (!publicRoute && !path.startsWith('/api/admin/')) return null;
    try {
      if (publicRoute && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: publicHeaders({ 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'If-None-Match', 'Access-Control-Max-Age': '86400' }) });
      if (path === '/api/content' && ['GET', 'HEAD'].includes(request.method)) {
        const { state } = await readState();
        const publication = state.published;
        const content = publicGardenContent(publication.content, { mediaBaseUrl: baseUrl(request, publication.content) });
        const etag = `"${await sha256(encoder.encode(JSON.stringify(content)))}"`;
        const headers = publicHeaders({ ETag: etag, 'Cache-Control': 'public, max-age=0, must-revalidate' });
        if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers });
        const response = json(content, 200, headers);
        return request.method === 'HEAD' ? new Response(null, { status: 200, headers: response.headers }) : response;
      }
      if (path.startsWith('/media/') && ['GET', 'HEAD'].includes(request.method)) {
        const key = path.slice(1);
        const match = IMAGE_KEY.exec(key);
        if (!match) throw new HttpError(404, 'Image not found.');
        const object = request.method === 'HEAD' && storage.headObject ? await storage.headObject(key) : await storage.getObject(key);
        if (!object) throw new HttpError(404, 'Image not found.');
        const etag = `"${match[1]}"`;
        const headers = publicHeaders({ 'Content-Type': object.mime, 'Content-Length': String(object.size), 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag });
        if (matchesEtag(request, etag)) { await object.body?.cancel?.(); return new Response(null, { status: 304, headers }); }
        if (request.method === 'HEAD') await object.body?.cancel?.();
        return new Response(request.method === 'HEAD' ? null : object.body, { headers });
      }
      if (publicRoute) throw new HttpError(405, 'Method not allowed.');
      assertSameOrigin(request);
      if (path === '/api/admin/session' && request.method === 'GET') return json(await sessionBody(request, await authenticate(request)));
      if (path === '/api/admin/login' && request.method === 'POST') {
        assertSameOrigin(request, { required: true });
        if (!configured) throw new HttpError(503, 'Cloud authentication has not been configured.');
        if (local) return json(await sessionBody(request, { csrfToken: localCsrf }));
        const address = clientAddress(request).slice(0, 200);
        const current = now();
        for (const [key, entry] of attempts) if (entry.resetAt <= current) attempts.delete(key);
        if (attempts.size > 10000) throw new HttpError(429, 'Too many sign-in attempts. Try again later.');
        const entry = attempts.get(address) || { count: 0, resetAt: current + 15 * 60 * 1000 };
        if (entry.count >= 5) throw new HttpError(429, 'Too many sign-in attempts. Try again later.', { retryAfter: Math.ceil((entry.resetAt - current) / 1000) });
        const { username, password } = await readJson(request);
        passwordHashPromise ||= sha256(encoder.encode(adminPassword));
        usernameHashPromise ||= sha256(encoder.encode(loginName));
        const supplied = typeof password === 'string' && password.length <= 1024 ? password : '';
        const suppliedName = typeof username === 'string' && username.length <= 120 ? username.trim().toLowerCase() : '';
        const [passwordHash, usernameHash, expectedPassword, expectedUsername] = await Promise.all([sha256(encoder.encode(supplied)),sha256(encoder.encode(suppliedName)),passwordHashPromise,usernameHashPromise]);
        const passwordMatches=equalStrings(passwordHash,expectedPassword), usernameMatches=equalStrings(usernameHash,expectedUsername);
        if (!usernameMatches || !passwordMatches) {
          entry.count++;
          attempts.set(address, entry);
          throw new HttpError(401, 'Incorrect username or password.');
        }
        attempts.delete(address);
        const payload = `v1.${current + SESSION_SECONDS * 1000}.${randomToken()}`;
        const token = `${payload}.${await hmac(payload)}`;
        return json(await sessionBody(request, { csrfToken: await hmac(`csrf:${payload}`) }), 200, { 'Set-Cookie': sessionCookie(token) });
      }
      if (path === '/api/admin/logout' && request.method === 'POST') {
        await requireWrite(request);
        return json({ authenticated: local }, 200, { 'Set-Cookie': sessionCookie('', 0) });
      }
      if (path === '/api/admin/content' && request.method === 'GET') {
        await requireAuth(request);
        const { state } = await readState();
        return json({ ...state.draft, mediaBaseUrl: baseUrl(request, state.draft.content) }, 200, { ETag: `"${state.draft.revision}"` });
      }
      if (path === '/api/admin/content' && request.method === 'PUT') {
        await requireWrite(request);
        const body = await readJson(request);
        const expectedRevision = revisionFrom(request, body);
        const errors = validateGardenContent(body.content);
        if (errors.length) throw new HttpError(422, 'Content validation failed.', { errors });
        const content = normalizeGardenContent(body.content);
        const { state, version } = await readState();
        assertRevision(state.draft.revision, expectedRevision);
        const draft = { content, revision: await nextRevision(content) };
        await writeState({ ...state, draft }, version);
        return json(draft, 200, { ETag: `"${draft.revision}"` });
      }
      if (path === '/api/admin/live-content' && request.method === 'PATCH') {
        await requireWrite(request);
        const { targetType, targetId, locale, fields } = liveContentPatch(await readJson(request));
        const { state, version } = await readState();
        const collection = targetType === 'photo' ? 'media' : 'journal';
        if (!publicGardenContent(state.published.content)[collection].some(item => item.id === targetId)) throw new HttpError(404, 'This published photo or journal entry could not be found.');
        const content = structuredClone(state.published.content);
        const target = content[collection].find(item => item.id === targetId);
        applyLiveText(target, locale, fields);
        if (targetType === 'journal' && !publicGardenContent(content).journal.some(item => item.id === targetId)) throw new HttpError(422, 'A published journal entry needs text or an image.');
        const revision = await nextRevision(content);
        const publication = { content, revision, publishedAt: new Date(now()).toISOString() };
        // A live text edit is deliberately narrower than publishing the draft.
        // In-progress uploads, exclusions and unrelated edits stay private.
        const draftContent = structuredClone(state.draft.content);
        const draftTarget = draftContent[collection].find(item => item.id === targetId);
        let draft = state.draft;
        if (draftTarget) {
          applyLiveText(draftTarget, locale, fields);
          draft = { ...state.draft, content: draftContent, revision: JSON.stringify(draftContent) === JSON.stringify(content) ? revision : await nextRevision(draftContent) };
        }
        await writeState({ ...state, draft, published: publication, previousPublished: state.published }, version);
        return json({ published: true, revision, content: publicGardenContent(content, { mediaBaseUrl: baseUrl(request, content) }) });
      }
      if (path === '/api/admin/publish' && request.method === 'POST') {
        await requireWrite(request);
        const body = await readJson(request);
        const { state, version } = await readState();
        assertRevision(state.draft.revision, revisionFrom(request, body));
        const errors = validateGardenContent(state.draft.content);
        if (errors.length) throw new HttpError(422, 'Content validation failed.', { errors });
        const publication = { ...state.draft, publishedAt: new Date(now()).toISOString() };
        await writeState({ ...state, published: publication, previousPublished: state.published }, version);
        return json({ published: true, revision: publication.revision, content: publicGardenContent(publication.content, { mediaBaseUrl: baseUrl(request, publication.content) }) });
      }
      if (path === '/api/admin/upload' && request.method === 'POST') {
        await requireWrite(request);
        const role = url.searchParams.get('role');
        if (!ROLES.has(role)) throw new HttpError(400, 'Choose a supported image role.');
        const bytes = await readBytes(request, MAX_UPLOAD_BYTES);
        let information;
        try { information = inspectImage(bytes, request.headers.get('content-type') || ''); }
        catch (error) { throw new HttpError(415, error.message || 'Use a valid PNG, JPEG, or WebP image.'); }
        const digest = await sha256(bytes);
        const key = `${role === 'original' ? 'private/originals/' : 'media/'}${digest}.${information.extension}`;
        const deduplicated = !await storage.putObject(key, bytes, { mime: information.mime });
        return json({ key, url: role === 'original' ? `/api/admin/original?key=${encodeURIComponent(key)}` : `${baseUrl(request)}/${key}`, bytes: bytes.byteLength, sha256: digest, width: information.width, height: information.height, deduplicated }, 201);
      }
      if (path === '/api/admin/original' && ['GET', 'HEAD'].includes(request.method)) {
        await requireAuth(request);
        const key = url.searchParams.get('key') || '';
        if (!ORIGINAL_KEY.test(key)) throw new HttpError(400, 'Invalid original image key.');
        const object = request.method === 'HEAD' && storage.headObject ? await storage.headObject(key) : await storage.getObject(key);
        if (!object) throw new HttpError(404, 'Original image not found.');
        if (request.method === 'HEAD') await object.body?.cancel?.();
        return new Response(request.method === 'HEAD' ? null : object.body, { headers: { 'Content-Type': object.mime, 'Content-Length': String(object.size), 'Content-Disposition': `attachment; filename="${key.split('/').at(-1)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (path === '/api/admin/export' && request.method === 'GET') {
        await requireAuth(request);
        const { state } = await readState();
        return json(state.draft.content, 200, { 'Content-Disposition': 'attachment; filename="garden-draft.json"' });
      }
      throw new HttpError(404, 'API endpoint not found.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) onError(error);
      const headers = publicRoute ? publicHeaders() : {};
      if (error.extra?.retryAfter) headers['Retry-After'] = String(error.extra.retryAfter);
      return json({ error: status === 500 ? 'Storage operation failed. Please retry.' : error.message, ...(error instanceof HttpError ? error.extra : {}) }, status, headers);
    }
  };
}
