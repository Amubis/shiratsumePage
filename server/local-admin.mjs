import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, link, unlink, stat, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createAdminApi, sha256 } from './admin-api.mjs';
import { createLocalCommentsStore } from './local-comments-storage.mjs';
import { createLocalPhotoLikesStore } from './local-photo-likes-storage.mjs';
import { embedOwnerProfileData } from '../scripts/owner-profile-data.mjs';
import { embedGardenData } from '../scripts/garden-data.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const objectKey = /^(?:media\/|private\/originals\/)[a-f0-9]{64}\.(?:png|jpg|webp)$/;
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' };

function imageMime(key) { return key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg'; }

/** JSON is replaced atomically; a process mutex makes compare-and-write indivisible for simultaneous requests. */
export function createLocalStorage(dataDir) {
  const directory = resolve(dataDir);
  const statePath = resolve(directory, 'state.json');
  let pending = Promise.resolve();
  const locked = operation => {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  };
  const readState = async () => {
    try {
      const bytes = await readFile(statePath);
      const state = JSON.parse(bytes.toString('utf8'));
      if (state.schemaVersion !== 1 || !state.draft?.revision || !state.published?.revision) throw new Error('Invalid garden state file.');
      return { state, version: await sha256(bytes) };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const objectPath = key => {
    if (!objectKey.test(key)) throw new Error('Invalid storage object key.');
    return resolve(directory, key);
  };
  return {
    readState,
    writeState: (state, expectedVersion) => locked(async () => {
      const current = await readState();
      if ((current?.version ?? null) !== expectedVersion) return false;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = resolve(directory, `.state-${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
        await rename(temporary, statePath);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return true;
    }),
    async putObject(key, bytes) {
      const target = objectPath(key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const temporary = resolve(dirname(target), `.image-${crypto.randomUUID()}.tmp`);
      try {
        await writeFile(temporary, bytes, { mode: 0o600 });
        try { await link(temporary, target); return true; }
        catch (error) { if (error.code === 'EEXIST') return false; throw error; }
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async headObject(key) {
      try {
        const information = await stat(objectPath(key));
        return information.isFile() ? { size: information.size, mime: imageMime(key) } : null;
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async getObject(key) {
      try {
        const path = objectPath(key);
        const information = await stat(path);
        if (!information.isFile()) return null;
        return { body: Readable.toWeb(createReadStream(path)), size: information.size, mime: imageMime(key) };
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
  };
}

function localRequestOrigin(request) {
  const remote = request.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return null;
  const host = request.headers.host;
  if (typeof host !== 'string' || /[\s/@\\?#]/.test(host)) return null;
  try {
    const origin = new URL(`http://${host}`);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return null;
    if (Number(origin.port || 80) !== request.socket.localPort) return null;
    return origin.origin;
  } catch { return null; }
}

async function staticResponse(request, rootDir, garden) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return new Response('Invalid path', { status: 400 }); }
  const segments = pathname.split('/');
  if (segments.some(part => part.startsWith('.') || part.includes('\\') || part.includes('\0'))) return new Response('Not found', { status: 404 });
  const allowed = /^\/(?:admin|assets|src)\//.test(pathname) || /^\/data\/(?:garden|owner|album|outfits|runtime)\.json$/.test(pathname) || ['/', '/index.html', '/favicon.ico', '/robots.txt'].includes(pathname);
  if (!allowed) return new Response('Not found', { status: 404 });
  const target = resolve(rootDir, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
  try {
    const actual = await realpath(target);
    if (!actual.startsWith(rootDir + sep)) return new Response('Not found', { status: 404 });
    const information = await stat(actual);
    if (!information.isFile()) return new Response('Not found', { status: 404 });
    const headers = { 'Content-Type': contentTypes[extname(actual)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
    if (actual === resolve(rootDir, 'index.html')) {
      const html = embedOwnerProfileData(await readFile(actual, 'utf8'), garden.owner);
      const content = Buffer.from(embedGardenData(html, garden));
      return new Response(request.method === 'HEAD' ? null : content, { headers: { ...headers, 'Content-Length': String(content.length) } });
    }
    let start = 0;
    let end = information.size - 1;
    let status = 200;
    headers['Accept-Ranges'] = 'bytes';
    if (request.headers.has('range')) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range'));
      if (!range || (!range[1] && !range[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${information.size}` } });
      start = range[1] ? Number(range[1]) : Math.max(0, information.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= information.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${information.size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${information.size}`;
      status = 206;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    const body = request.method === 'HEAD' || !information.size ? null : Readable.toWeb(createReadStream(actual, { start, end }));
    return new Response(body, { status, headers });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return new Response('Not found', { status: 404 });
    throw error;
  }
}

/** Creates, but does not listen on, a loopback-only HTTP server for the website and its real admin API. */
export async function createLocalAdminServer({ rootDir = projectRoot, dataDir = resolve(rootDir, '.garden-data'), seed, publicSiteOrigins = process.env.PUBLIC_SITE_ORIGINS || '', onError = error => console.error(error) } = {}) {
  const root = await realpath(rootDir);
  const defaultContent = seed || JSON.parse(await readFile(resolve(root, 'data/garden.json'), 'utf8'));
  const storage = createLocalStorage(dataDir);
  const handler = createAdminApi({ storage, commentsStore: createLocalCommentsStore(dataDir), photoLikesStore: createLocalPhotoLikesStore(dataDir), seed: defaultContent, mode: 'local', publicSiteOrigins, clientAddress: () => 'local-loopback', onError });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const origin = localRequestOrigin(incoming);
      if (!origin) { outgoing.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); outgoing.end('The local editor only accepts loopback hosts.'); incoming.resume(); return; }
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(400); outgoing.end(); incoming.resume(); return; }
      const hasBody = !['GET', 'HEAD'].includes(incoming.method);
      const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      const response = await handler(request) || await staticResponse(request, root, defaultContent);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body && incoming.method !== 'HEAD') await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
      incoming.resume();
    } catch (error) {
      // Navigating away from a streamed image is a normal client cancellation.
      if (outgoing.destroyed && ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'ABORT_ERR'].includes(error.code)) { incoming.resume(); return; }
      onError(error);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (!outgoing.destroyed) outgoing.end('{"error":"Local server request failed."}');
      incoming.resume();
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.GARDEN_PORT || process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('GARDEN_PORT must be between 1 and 65535.');
  const server = await createLocalAdminServer();
  server.listen(port, '127.0.0.1', () => console.log(`Garden editor: http://127.0.0.1:${port}/admin/`));
}
