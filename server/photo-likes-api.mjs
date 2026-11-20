const COOKIE_NAME = '__Host-photo_visitor';
const LOCAL_COOKIE_NAME = 'photo_visitor';
const COOKIE_AGE = 365 * 24 * 60 * 60;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
class LikesError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new LikesError(status, message, extra); };

function sameOrigin(request, requireOrigin = false) {
  const origin = request.headers.get('origin');
  return (!requireOrigin || Boolean(origin)) && (!origin || origin === new URL(request.url).origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
}
async function readBody(request) {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') fail(415, 'Use application/json.');
  const announced = request.headers.get('content-length');
  if (announced && (!/^\d+$/.test(announced) || Number(announced) > 1024)) fail(413, 'Like request is too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Invalid JSON request.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); fail(413, 'Like request is too large.'); }
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

/** Cookie identity is independent of owner login; only its salted hash reaches storage. */
export function createPhotoLikesApi({ store, getPublishedContent, mode = 'cloud', identitySecret = '', now = () => Date.now(), onError = () => {} }) {
  const salt = identitySecret || (mode === 'local' ? 'local-photo-likes-v1' : crypto.randomUUID());
  const cookieName = mode === 'local' ? LOCAL_COOKIE_NAME : COOKIE_NAME;
  const publishedIds = async () => [...new Set((await getPublishedContent()).media?.map(item => item.id).filter(id => typeof id === 'string' && id) || [])];
  return async request => {
    if (new URL(request.url).pathname !== '/api/photo-likes') return null;
    const headers = { 'Access-Control-Allow-Origin': '*' };
    try {
      if (request.method === 'OPTIONS') {
        const method = request.headers.get('access-control-request-method') || 'GET';
        if (!['GET', 'HEAD', 'POST'].includes(method)) fail(405, 'Method not allowed.');
        if (method === 'POST' && !sameOrigin(request, true)) fail(403, 'Like photos on the main website.');
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) fail(405, 'Method not allowed.');
      if (request.method === 'POST' && !sameOrigin(request, true)) fail(403, 'Like photos on the main website.');
      if (!store) fail(503, 'Photo likes are temporarily unavailable.', { code: 'likes_unavailable', available: false });
      const ids = await publishedIds();
      let visitorHash = '';
      // Foreign-site mirrors may read totals but never establish a second
      // identity through third-party cookies or read a browser's liked state.
      if (sameOrigin(request)) {
        let token = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
        if (!/^[a-f0-9]{64}$/.test(token)) {
          token = hex(crypto.getRandomValues(new Uint8Array(32)));
          headers['Set-Cookie'] = `${cookieName}=${token}; Path=/; HttpOnly;${mode === 'local' ? '' : ' Secure;'} SameSite=Strict; Max-Age=${COOKIE_AGE}`;
        }
        visitorHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:photo-likes:${token}`)));
      }
      if (['GET', 'HEAD'].includes(request.method)) {
        const response = json({ available: true, likes: await store.list(ids, visitorHash) }, 200, headers);
        return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      const body = await readBody(request);
      if (typeof body.photoId !== 'string' || !body.photoId || body.photoId.length > 120 || typeof body.liked !== 'boolean') fail(422, 'Provide a photo ID and liked: true or false.');
      if (!ids.includes(body.photoId)) fail(404, 'This published photo could not be found.');
      const rate = await store.consumeRateLimit(visitorHash, now(), { windowMs: 10 * 60 * 1000, max: 120 });
      if (!rate.allowed) {
        headers['Retry-After'] = String(rate.retryAfter);
        fail(429, 'Too many likes. Please try again later.', { retryAfter: rate.retryAfter });
      }
      return json(await store.set(body.photoId, visitorHash, body.liked, new Date(now()).toISOString()), 200, headers);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      if (status >= 500 && status !== 503) onError(error);
      return json({ error: status === 500 ? 'Photo likes could not be saved. Please retry.' : error.message, ...(error.extra || {}) }, status, headers);
    }
  };
}
