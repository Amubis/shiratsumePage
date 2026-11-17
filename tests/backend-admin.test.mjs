import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createLocalAdminServer, createLocalStorage } from '../server/local-admin.mjs';
import { createAdminApi } from '../server/admin-api.mjs';
import { normalizeGardenContent } from '../src/garden-content.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQS3EDAAFsAMnoB9dkAAAAAElFTkSuQmCC', 'base64');
const seed = normalizeGardenContent({
  schemaVersion: 1,
  owner: { name: 'Seed owner' },
  media: [
    { id: 'public-photo', url: './assets/photo.png', enabled: true, originalName: 'private.png', metadataSource: { players: ['private'] }, warnings: ['private'], originalKey: `private/originals/${'a'.repeat(64)}.png` },
    { id: 'hidden-photo', url: './assets/hidden.png', enabled: false },
  ],
  journal: [{ id: 'public-note', body: 'Published text', published: true }, { id: 'hidden-note', body: 'Draft text', published: false }],
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function local(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'garden-http-'));
  const dataDir = join(rootDir, '.garden-data');
  await mkdir(join(rootDir, 'assets'));
  await mkdir(join(rootDir, 'admin'));
  await writeFile(join(rootDir, 'assets', 'photo.png'), PNG);
  await writeFile(join(rootDir, 'admin', 'index.html'), '<!doctype html><title>Editor</title>');
  await writeFile(join(rootDir, '.env'), 'SECRET=must-not-be-served');
  const errors = [];
  const server = await createLocalAdminServer({ rootDir, dataDir, seed, onError: error => errors.push(error) });
  const origin = await listen(server);
  t.after(async () => { await close(server); await rm(rootDir, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  const session = await (await fetch(`${origin}/api/admin/session`)).json();
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Garden-CSRF': session.csrfToken };
  return { server, origin, rootDir, dataDir, session, headers };
}

async function json(response, status = 200) {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
}

test('local HTTP session is explicit and all admin writes require the local Origin and CSRF token', async t => {
  const { origin, session, headers } = await local(t);
  assert.equal(session.authenticated, true);
  assert.equal(session.configured, true);
  assert.equal(session.mode, 'local');
  assert.match(session.csrfToken, /^[a-f\d]{48}$/);
  assert.equal(session.mediaBaseUrl, origin);
  const draft = await json(await fetch(`${origin}/api/admin/content`));
  const body = JSON.stringify({ content: draft.content, revision: draft.revision });
  for (const changed of [
    { ...headers, 'X-Garden-CSRF': '' },
    { ...headers, Origin: '' },
    { ...headers, Origin: 'https://evil.example' },
    { ...headers, 'Sec-Fetch-Site': 'cross-site' },
  ]) await json(await fetch(`${origin}/api/admin/content`, { method: 'PUT', headers: changed, body }), 403);
  await json(await fetch(`${origin}/api/admin/content`, { headers: { Origin: 'https://evil.example' } }), 403);
  const publicResponse = await fetch(`${origin}/api/content`, { headers: { Origin: 'https://reader.example' } });
  assert.equal(publicResponse.headers.get('access-control-allow-origin'), '*');
  await json(publicResponse);
});

test('draft save, concurrent revision conflict and publish remain distinct over real HTTP', async t => {
  const { origin, headers, dataDir } = await local(t);
  const original = await json(await fetch(`${origin}/api/admin/content`));
  const candidates = ['Owner A', 'Owner B'].map(name => ({ ...original.content, owner: { ...original.content.owner, name } }));
  const writes = await Promise.all(candidates.map(content => fetch(`${origin}/api/admin/content`, { method: 'PUT', headers, body: JSON.stringify({ content, revision: original.revision }) })));
  assert.deepEqual(writes.map(response => response.status).sort(), [200, 409]);
  const results = await Promise.all(writes.map(response => response.json()));
  const saved = results[writes.findIndex(response => response.status === 200)];
  assert.notEqual(saved.revision, original.revision);
  assert.equal((await json(await fetch(`${origin}/api/content`))).owner.name, 'Seed owner');
  await json(await fetch(`${origin}/api/admin/publish`, { method: 'POST', headers, body: JSON.stringify({ revision: original.revision }) }), 409);
  const publication = await json(await fetch(`${origin}/api/admin/publish`, { method: 'POST', headers, body: JSON.stringify({ revision: saved.revision }) }));
  assert.equal(publication.published, true);
  assert.equal(publication.revision, saved.revision);
  const publicResponse = await fetch(`${origin}/api/content`);
  const publicContent = await json(publicResponse);
  assert.equal(publicContent.owner.name, saved.content.owner.name);
  assert.deepEqual(publicContent.media.map(photo => photo.id), ['public-photo']);
  assert.deepEqual(publicContent.journal.map(note => note.id), ['public-note']);
  for (const field of ['originalKey', 'originalName', 'metadataSource', 'warnings']) assert.equal(field in publicContent.media[0], false);
  const unchanged = await fetch(`${origin}/api/content`, { headers: { 'If-None-Match': publicResponse.headers.get('etag') } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  const state = JSON.parse(await readFile(join(dataDir, 'state.json'), 'utf8'));
  assert.equal(state.draft.revision, saved.revision);
  assert.equal(state.published.revision, saved.revision);
  assert.equal(state.previousPublished.revision, original.revision);
});

test('new photo imports join the private album draft and become visible only after save and explicit publication', async t => {
  const { origin, headers } = await local(t);
  const original = await json(await fetch(`${origin}/api/admin/content`));
  const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
  const runUpload = source.match(/^async function runUpload\(job\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(runUpload, 'execute the real photo import handler');
  const file = new Blob([PNG], { type: 'image/png' });
  const job = {
    file: Object.assign(file, { name: 'VRChat_2026-11-17_12-00-00.png' }),
    photoId: 'new-upload', options: { kind: 'photo' },
    cache: { mime: 'image/png', width: 1, height: 1, metadata: { takenAt: '2026-11-17T12:00:00', timeZone: 'unspecified', source: {}, warnings: [] }, displayBlob: file, thumbnailBlob: file },
  };
  const state = { content: structuredClone(original.content), jobs: [job], section: 'photos' };
  let localChanges = 0;
  const uploadBlob = async (_job, blob, role, name) => json(await fetch(`${origin}/api/admin/upload?role=${role}&name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: blob,
  }), 201);
  await runInNewContext(`(${runUpload})(job)`, { state, job, uploadBlob, cloudLocked: () => false, changed: () => { localChanges++; }, render() {}, setJobProgress() {} });
  const imported = state.content.media.find(item => item.id === 'new-upload');
  assert.equal(imported.enabled, true, 'new imports are included in the next explicit album publication');
  assert.deepEqual(Array.from(imported.modelIds), [], 'uploading does not infer or preselect a model');
  assert.equal(state.content.media.find(item => item.id === 'hidden-photo').enabled, false, 'existing excluded photos remain excluded');
  assert.equal(localChanges, 1);
  assert.equal((await json(await fetch(`${origin}/api/admin/content`))).content.media.length, original.content.media.length, 'uploading files does not save or publish their draft reference');
  assert.deepEqual((await json(await fetch(`${origin}/api/content`))).media.map(item => item.id), ['public-photo']);
  const saved = await json(await fetch(`${origin}/api/admin/content`, { method: 'PUT', headers, body: JSON.stringify({ content: state.content, revision: original.revision }) }));
  assert.deepEqual((await json(await fetch(`${origin}/api/content`))).media.map(item => item.id), ['public-photo'], 'saving an included photo still keeps it private until publication');
  await json(await fetch(`${origin}/api/admin/publish`, { method: 'POST', headers, body: JSON.stringify({ revision: saved.revision }) }));
  assert.deepEqual((await json(await fetch(`${origin}/api/content`))).media.map(item => item.id), ['public-photo', 'new-upload']);
});

test('publication confirmation and success report the included and omitted album photo counts', async () => {
  const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
  const publish = source.match(/^async function publish\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(publish, 'execute the real publication handler');
  const messages = [], requests = [];
  const state = { content: { media: [{ enabled: true }, { enabled: false }, { enabled: false }], journal: [] }, revision: 'draft-revision' };
  await runInNewContext(`(${publish})()`, {
    state, $: () => ({ disabled: false }), validateGardenContent: () => [], cloudLocked: () => false,
    confirmAction: async (_title, message) => { messages.push(message); return true; },
    api: async (path, options) => { requests.push([path, options]); return { published: true, content: { media: [{}] } }; },
    updateChrome() {}, persistLocal() {}, toast: message => messages.push(message), reportError: error => { throw error; },
  });
  assert.match(messages[0], /相册将显示 1 张照片/);
  assert.match(messages[0], /2 张照片未纳入相册，本次不会显示/);
  assert.match(messages[1], /相册 1 张照片，2 张未纳入相册/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/admin/publish');
  assert.equal(requests[0][1].method, 'POST');
  assert.deepEqual(state.content.media.map(item => item.enabled), [true, false, false], 'publishing does not silently include excluded photos');
});

test('HTTP content writes reject malformed JSON, invalid content and missing or inconsistent revisions', async t => {
  const { origin, headers } = await local(t);
  const draft = await json(await fetch(`${origin}/api/admin/content`));
  const put = (body, changed = {}) => fetch(`${origin}/api/admin/content`, { method: 'PUT', headers: { ...headers, ...changed }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  await json(await put('{broken'), 400);
  await json(await put('[]'), 400);
  await json(await put({ content: draft.content, revision: draft.revision }, { 'Content-Type': 'text/plain' }), 415);
  await json(await put({ content: draft.content }), 428);
  await json(await put({ content: draft.content, revision: draft.revision }, { 'If-Match': '"other-revision"' }), 400);
  await json(await put({ content: { ...draft.content, schemaVersion: 99 }, revision: draft.revision }), 422);
  await json(await put({ content: { ...draft.content, settings: { ...draft.content.settings, publicSiteUrl: 'javascript:alert(1)' } }, revision: draft.revision }), 422);
  const saved = await json(await put({ content: draft.content }, { 'If-Match': `"${draft.revision}"` }));
  assert.notEqual(saved.revision, draft.revision);
});

test('HTTP uploads inspect image bytes, deduplicate, expose immutable derivatives and keep originals private', async t => {
  const { origin, headers } = await local(t);
  const upload = (role, body = PNG, mime = 'image/png') => fetch(`${origin}/api/admin/upload?role=${role}&name=private-name.png`, { method: 'POST', headers: { ...headers, 'Content-Type': mime }, body });
  await json(await upload('unsupported'), 400);
  await json(await upload('display', PNG, 'image/jpeg'), 415);
  await json(await upload('display', Buffer.from('<svg onload="alert(1)">'), 'image/png'), 415);
  const first = await json(await upload('display'), 201);
  const repeated = await json(await upload('thumbnail'), 201);
  assert.match(first.key, /^media\/[a-f\d]{64}\.png$/);
  assert.equal(first.bytes, PNG.length);
  assert.equal(first.width, 1);
  assert.equal(first.height, 1);
  assert.equal(first.deduplicated, false);
  assert.equal(repeated.key, first.key);
  assert.equal(repeated.deduplicated, true);
  const image = await fetch(first.url, { headers: { Origin: 'https://reader.example' } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('access-control-allow-origin'), '*');
  assert.match(image.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  const head = await fetch(first.url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), PNG.length);
  assert.equal(await head.text(), '');
  const cached = await fetch(first.url, { headers: { 'If-None-Match': head.headers.get('etag') } });
  assert.equal(cached.status, 304);
  await cached.text();
  const original = await json(await upload('original'), 201);
  assert.match(original.key, /^private\/originals\/[a-f\d]{64}\.png$/);
  const download = await fetch(`${origin}${original.url}`);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('cache-control'), /private/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), PNG);
  assert.equal((await fetch(`${origin}/${original.key}`)).status, 404);
  await json(await fetch(`${origin}${original.url}`, { headers: { Origin: 'https://evil.example' } }), 403);
});

test('local HTTP static serving rejects hidden files, traversal and non-loopback Host values', async t => {
  const { origin } = await local(t);
  assert.equal((await fetch(`${origin}/admin/`)).status, 200);
  for (const path of ['/.env', '/.garden-data/state.json', '/server/local-admin.mjs', '/assets/%2e%2e/%2eenv', '/assets/%5c.env']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    await response.text();
  }
  // Fetch normalizes Host, so send the DNS rebinding case through Node's raw HTTP client.
  const badHost = await new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}/api/admin/session`, { headers: { Host: 'evil.example' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(badHost, 403);
  const asset = await fetch(`${origin}/assets/photo.png`, { headers: { Range: 'bytes=1-4' } });
  assert.equal(asset.status, 206);
  assert.equal(asset.headers.get('content-range'), `bytes 1-4/${PNG.length}`);
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()), PNG.subarray(1, 5));
});

async function cloud(t, { configured = true, adminUsername = 'Amubis', adminPassword = 'test-password' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'garden-cloud-http-'));
  let clock = 1_800_000_000_000;
  const errors = [];
  const handle = createAdminApi({ storage: createLocalStorage(directory), seed, mode: 'cloud', adminUsername, adminPassword: configured ? adminPassword : '', sessionSecret: configured ? 'a-random-secret-at-least-32-characters' : '', now: () => clock, onError: error => errors.push(error) });
  // The transport is actual loopback HTTP; the handler sees its production HTTPS origin.
  const applicationOrigin = 'https://garden.example';
  const server = createServer(async (incoming, outgoing) => {
    const request = new Request(`${applicationOrigin}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await handle(request) || new Response('Not found', { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body && incoming.method !== 'HEAD') await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
    incoming.resume();
  });
  const transportOrigin = await listen(server);
  t.after(async () => { await close(server); await rm(directory, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  const headers = { Origin: applicationOrigin, 'Content-Type': 'application/json' };
  return { transportOrigin, applicationOrigin, headers, advance: milliseconds => { clock += milliseconds; } };
}

test('cloud HTTP authentication signs secure cookies and requires authentication, CSRF and matching Origin', async t => {
  const { transportOrigin: origin, headers, advance } = await cloud(t);
  const session = await json(await fetch(`${origin}/api/admin/session`));
  assert.equal(session.configured, true);
  assert.equal(session.authenticated, false);
  assert.equal('csrfToken' in session, false);
  await json(await fetch(`${origin}/api/admin/content`), 401);
  await json(await fetch(`${origin}/api/admin/login`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify({ username: 'Amubis', password: 'test-password' }) }), 403);
  await json(await fetch(`${origin}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'Amubis', password: 'wrong' }) }), 401);
  const loginResponse = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'Amubis', password: 'test-password' }) });
  const login = await json(loginResponse);
  const setCookie = loginResponse.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-garden_session=v1\./);
  for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) assert.ok(setCookie.includes(attribute), attribute);
  const cookie = setCookie.split(';')[0];
  const authHeaders = { ...headers, Cookie: cookie, 'X-Garden-CSRF': login.csrfToken };
  const draft = await json(await fetch(`${origin}/api/admin/content`, { headers: authHeaders }));
  const body = JSON.stringify({ revision: draft.revision, content: draft.content });
  await json(await fetch(`${origin}/api/admin/content`, { method: 'PUT', headers: { ...authHeaders, 'X-Garden-CSRF': 'wrong' }, body }), 403);
  await json(await fetch(`${origin}/api/admin/content`, { method: 'PUT', headers: { ...authHeaders, Origin: 'https://evil.example' }, body }), 403);
  await json(await fetch(`${origin}/api/admin/content`, { headers: { Cookie: `${cookie.slice(0, -1)}${cookie.endsWith('0') ? '1' : '0'}` } }), 401);
  await json(await fetch(`${origin}/api/admin/content`, { method: 'PUT', headers: authHeaders, body }));
  const originalResponse = await fetch(`${origin}/api/admin/upload?role=original`, { method: 'POST', headers: { ...authHeaders, 'Content-Type': 'image/png' }, body: PNG });
  const original = await json(originalResponse, 201);
  await json(await fetch(`${origin}${original.url}`), 401);
  const originalDownload = await fetch(`${origin}${original.url}`, { headers: authHeaders });
  assert.deepEqual(Buffer.from(await originalDownload.arrayBuffer()), PNG);
  const logout = await fetch(`${origin}/api/admin/logout`, { method: 'POST', headers: authHeaders });
  await json(logout);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  advance(12 * 60 * 60 * 1000 + 1);
  await json(await fetch(`${origin}/api/admin/content`, { headers: authHeaders }), 401);
});

test('cloud HTTP login throttles repeated bad passwords and unconfigured authentication stays unavailable', async t => {
  const { transportOrigin: origin, headers, advance } = await cloud(t);
  for (let attempt = 0; attempt < 5; attempt++) await json(await fetch(`${origin}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'Amubis', password: 'incorrect' }) }), 401);
  const limited = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'Amubis', password: 'test-password' }) });
  await json(limited, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
  advance(15 * 60 * 1000 + 1);
  await json(await fetch(`${origin}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'Amubis', password: 'test-password' }) }));
  const missing = await cloud(t, { configured: false });
  const session = await json(await fetch(`${missing.transportOrigin}/api/admin/session`));
  assert.equal(session.configured, false);
  assert.equal(session.authenticated, false);
  await json(await fetch(`${missing.transportOrigin}/api/admin/content`), 503);
  await json(await fetch(`${missing.transportOrigin}/api/admin/login`, { method: 'POST', headers: missing.headers, body: JSON.stringify({ username: 'Amubis', password: 'anything' }) }), 503);
});

test('cloud HTTP login requires the configured account as well as the password and uses one failure message',async t=>{
  const {transportOrigin:origin,headers,advance}=await cloud(t,{adminUsername:'GardenEditor'});
  const signIn=credentials=>fetch(`${origin}/api/admin/login`,{method:'POST',headers,body:JSON.stringify(credentials)});
  for(const credentials of [{password:'test-password'},{username:'Amubis',password:'test-password'},{username:'GardenEditor',password:'wrong'},{username:{name:'GardenEditor'},password:'test-password'}]){
    const response=await signIn(credentials);assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await json(response,401)).error,'Incorrect username or password.');
  }
  const response=await signIn({username:'  gardenEDITOR  ',password:'test-password'});
  assert.equal((await json(response)).authenticated,true);assert.ok(response.headers.get('set-cookie'));
  advance(16*60*1000);
  for(let i=0;i<5;i++)await json(await signIn({username:'wrong-user',password:'test-password'}),401);
  await json(await signIn({username:'GardenEditor',password:'test-password'}),429);
});

test('changing the administrator account or password invalidates an existing signed cookie',async t=>{
  const original=await cloud(t);
  const response=await fetch(`${original.transportOrigin}/api/admin/login`,{method:'POST',headers:original.headers,body:JSON.stringify({username:'Amubis',password:'test-password'})});
  await json(response);const cookie=response.headers.get('set-cookie').split(';')[0];
  for(const change of [{adminUsername:'AnotherEditor'},{adminPassword:'changed-password'}]){
    const updated=await cloud(t,change);
    await json(await fetch(`${updated.transportOrigin}/api/admin/content`,{headers:{Cookie:cookie}}),401);
  }
  const unchanged=await cloud(t,{adminUsername:'  AMUBIS  '});
  await json(await fetch(`${unchanged.transportOrigin}/api/admin/content`,{headers:{Cookie:cookie}}));
});
