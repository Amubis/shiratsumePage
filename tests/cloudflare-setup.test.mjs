import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { deployCloudflare, readDeploymentSettings, runWrangler, summarizeCloudContent, waitForCloudflareReadiness } from '../scripts/cloudflare-setup.mjs';
import { COMMENT_EMAIL_FROM, COMMENT_EMAIL_TO, createCommentEmailNotifier } from '../worker/comment-email.mjs';

const credentials = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-token', ADMIN_PASSWORD: '  exact password  ' };
const settings = readDeploymentSettings(credentials);
const database = { name: 'shiratsume-comments', uuid: '12345678-1234-1234-1234-123456789abc' };
const result = value => Response.json({ success: true, result: value });

async function fixture(t, { existing = false, publicBucket = false, noSubdomain = false, noSession = false, failRun = false, badLogin = false, brokenSession = false, requestedSubdomain = '', unavailableSubdomain = false, concurrentSubdomain = false, emptySubdomain = false, nullSubdomain = false, inspectContent = false, draftMedia = [], publishedMedia = [], badInspection = false, publishEmailContact = false, commentEmailEnabled = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cloudflare-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'worker'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/index.html'), 'website');
  const calls = [], commands = [], logs = [];
  let createdSubdomain = '', subdomainReads = 0;
  const request = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(`/client/v4/accounts/${settings.accountId}`, '');
    const method = options.method || 'GET';
    calls.push({ path, method });
    if (parsed.hostname.endsWith('.workers.dev')) {
      assert.equal(options.headers?.Authorization, undefined, 'provider token is never sent to the website');
      assert.equal(options.headers?.['User-Agent'], 'ShiratsumeDeploymentCheck/1.0 (+https://github.com/Amubis/shiratsumePage)', 'all public deployment checks identify the project honestly');
      assert.equal(options.headers.Accept, 'application/json');
      assert.equal(options.redirect, 'error', 'credentials cannot follow a redirect to another origin');
      if (path === '/api/admin/login') {
        assert.equal(options.headers.Origin, parsed.origin);
        assert.deepEqual(JSON.parse(options.body), { username: 'Amubis', password: credentials.ADMIN_PASSWORD });
        if (badLogin) return Response.json({ error: `Reflected credential must stay private: ${credentials.ADMIN_PASSWORD}` }, { status: 401 });
        return Response.json({ authenticated: true, configured: true, mode: 'cloud', csrfToken: 'private-csrf-token' }, { headers: { 'Set-Cookie': '__Host-garden_session=private-cookie; HttpOnly; Secure; Path=/; SameSite=Strict' } });
      }
      if (path === '/api/admin/logout') {
        assert.equal(options.headers.Cookie, '__Host-garden_session=private-cookie');
        assert.equal(options.headers['X-Garden-CSRF'], 'private-csrf-token');
        return Response.json({ authenticated: false });
      }
      if (publishEmailContact && path === '/api/admin/owner/contact') {
        assert.equal(method, 'POST');
        assert.equal(options.headers.Cookie, '__Host-garden_session=private-cookie');
        assert.equal(options.headers['X-Garden-CSRF'], 'private-csrf-token');
        assert.deepEqual(JSON.parse(options.body), { email: COMMENT_EMAIL_TO });
        return Response.json({ email: COMMENT_EMAIL_TO, updated: true });
      }
      if (inspectContent && path === '/api/admin/content') {
        assert.equal(options.headers.Cookie, '__Host-garden_session=private-cookie');
        if (badInspection) return Response.json({ error: credentials.ADMIN_PASSWORD }, { status: 503 });
        return Response.json({ content: { media: draftMedia }, revision: 'private-revision' });
      }
      if (inspectContent && path === '/api/content') {
        assert.equal(options.headers.Cookie, undefined, 'public content check does not need a private cookie');
        return Response.json({ media: publishedMedia });
      }
      assert.equal(path, '/api/admin/session', 'deployment checks never fetch private draft content');
      return Response.json({ authenticated: Boolean(options.headers?.Cookie) && !brokenSession, configured: true, mode: 'cloud' });
    }
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    if (path === '/workers/subdomain') {
      if (method === 'PUT') {
        assert.deepEqual(JSON.parse(options.body), { subdomain: requestedSubdomain });
        if (unavailableSubdomain) return Response.json({ success: false, errors: [{ code: 10031, message: credentials.CLOUDFLARE_API_TOKEN }] }, { status: 409 });
        createdSubdomain = requestedSubdomain;
        return result({ subdomain: createdSubdomain });
      }
      subdomainReads++;
      if (concurrentSubdomain && subdomainReads > 1) return result({ subdomain: 'already-created' });
      if (noSubdomain && !createdSubdomain && emptySubdomain) return result({});
      if (noSubdomain && !createdSubdomain && nullSubdomain) return result({ subdomain: null });
      return noSubdomain && !createdSubdomain ? new Response(null, { status: 404 }) : result({ subdomain: createdSubdomain || 'amubis' });
    }
    if (path === '/r2/buckets/shiratsume-page') return existing ? result({ name: settings.bucketName }) : new Response(null, { status: 404 });
    if (path === '/r2/buckets' && method === 'POST') return result({ name: settings.bucketName });
    if (path.endsWith('/domains/managed')) return result({ enabled: publicBucket });
    if (path.endsWith('/domains/custom')) return result({ domains: [] });
    if (path === '/d1/database') return method === 'POST' ? result(database) : result(existing ? [database] : []);
    if (path.endsWith('/secrets')) return result(existing && !noSession ? [{ name: 'SESSION_SECRET' }] : []);
    throw new Error(`Unexpected cloud request: ${method} ${url}`);
  };
  const run = async (args, options) => {
    const configPath = args[args.indexOf('--config') + 1];
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    commands.push({ args, options, config });
    if (failRun) throw new Error('Mock migration failure');
  };
  const deploy = () => deployCloudflare({ ...settings, workersSubdomain: requestedSubdomain, commentEmailEnabled }, { root, request, run, log: message => logs.push(message), env: credentials, random: () => 'unlogged-session-'.repeat(4), delay: async () => {}, inspectContent, publishEmailContact });
  return { root, request, run, calls, commands, logs, deploy };
}

test('deployment validates only public input and presence of secrets without making network calls', () => {
  assert.equal(settings.username, 'Amubis');
  assert.equal(settings.password, credentials.ADMIN_PASSWORD, 'password whitespace is significant');
  assert.throws(() => readDeploymentSettings({ ...credentials, CLOUDFLARE_API_TOKEN: '' }), /Actions.*Secrets/);
  assert.throws(() => readDeploymentSettings({ ...credentials, ADMIN_PASSWORD: '' }), /ADMIN_PASSWORD/);
  assert.throws(() => readDeploymentSettings({ ...credentials, CLOUDFLARE_ACCOUNT_ID: 'not-an-id' }), /Account ID/);
  assert.throws(() => readDeploymentSettings({ ...credentials, CLOUDFLARE_R2_BUCKET: 'bad;command' }), /CLOUDFLARE_R2_BUCKET/);
  assert.throws(() => readDeploymentSettings({ ...credentials, PUBLIC_SITE_ORIGINS: 'https://example.com/path' }), /HTTPS origins/);
  assert.throws(() => readDeploymentSettings({ ...credentials, ADMIN_USERNAME: 'hidden\tcontrol' }), /ADMIN_USERNAME/);
  for (const prefix of ['https://example.workers.dev', 'BadPrefix', '-prefix', 'x', 'x'.repeat(64)]) assert.throws(() => readDeploymentSettings({ ...credentials, CLOUDFLARE_WORKERS_SUBDOMAIN: prefix }), /CLOUDFLARE_WORKERS_SUBDOMAIN/);
  assert.equal(readDeploymentSettings({ ...credentials, CLOUDFLARE_WORKERS_SUBDOMAIN: 'amubis-shiratsume' }).workersSubdomain, 'amubis-shiratsume');
});

test('email-enabled deploy confines the binding and appends the requested contact through the owner session', async t => {
  assert.equal(settings.commentEmailEnabled, false);
  assert.equal(readDeploymentSettings({ ...credentials, CLOUDFLARE_COMMENT_EMAIL_ENABLED: 'true' }).commentEmailEnabled, true);
  const f = await fixture(t, { existing: true, publishEmailContact: true, commentEmailEnabled: true });
  await f.deploy();
  const config = f.commands.find(command => command.args[0] === 'deploy').config;
  assert.deepEqual(config.send_email, [{ name: 'COMMENT_EMAIL', destination_address: COMMENT_EMAIL_TO }]);
  assert.ok(f.calls.some(call => call.path === '/api/admin/owner/contact' && call.method === 'POST'));
});

test('comment email stays in the worker background and uses the fixed owner recipient', async () => {
  const messages = [], failures = [];
  let background;
  const notify = createCommentEmailNotifier({ send: async message => { messages.push(message); throw new Error('Unavailable'); } }, error => failures.push(error.message));
  const result = notify({ targetType: 'photo', nickname: '小草', body: '照片真好看！', email: 'visitor@example.org' }, { waitUntil(promise) { background = promise; } });
  assert.equal(result, undefined);
  await background;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, COMMENT_EMAIL_TO);
  assert.equal(messages[0].from.email, COMMENT_EMAIL_FROM);
  assert.match(messages[0].text, /小草 在照片下留言\n\n照片真好看！/);
  assert.match(messages[0].text, /https:\/\/amubis\.art\/admin\//);
  assert.deepEqual(failures, ['Unavailable']);
  assert.equal(createCommentEmailNotifier(undefined), undefined);
});

test('first deploy creates only missing private resources, migrates before deployment, and sends secrets only in protected stdin', async t => {
  const f = await fixture(t);
  const deployed = await f.deploy();
  assert.equal(deployed.adminUrl, 'https://shiratsume-page.amubis.workers.dev/admin/');
  assert.deepEqual(f.calls.filter(call => call.method !== 'GET').map(call => call.path), ['/r2/buckets', '/d1/database', '/api/admin/login', '/api/admin/logout']);
  assert.deepEqual(f.commands.map(command => command.args.slice(0, 3)), [['d1', 'migrations', 'apply'], ['deploy', '--config', f.commands[1].args[2]], ['secret', 'bulk', '--config']]);
  const secrets = JSON.parse(f.commands[2].options.input);
  assert.equal(secrets.ADMIN_PASSWORD, credentials.ADMIN_PASSWORD);
  assert.equal(secrets.SESSION_SECRET, 'unlogged-session-'.repeat(4));
  assert.equal(f.commands[2].options.sensitive, true);
  const configText = JSON.stringify(f.commands[0].config);
  for (const secret of [credentials.ADMIN_PASSWORD, credentials.CLOUDFLARE_API_TOKEN, secrets.SESSION_SECRET]) {
    assert.ok(!configText.includes(secret));
    assert.ok(!f.logs.join('\n').includes(secret));
    assert.ok(!JSON.stringify(f.commands.map(command => command.args)).includes(secret));
  }
  assert.equal(f.commands[0].config.assets.directory, '../dist');
  assert.equal(f.commands[0].config.d1_databases[0].database_id, database.uuid);
  assert.equal(f.commands[0].config.keep_vars, true);
  assert.deepEqual(await readdir(join(f.root, 'worker')), [], 'temporary deployment configuration is removed');
  assert.ok(f.calls.every(call => call.method !== 'DELETE'), 'deployment never deletes resources or seeds content over existing state');
});

test('repeat deploy reuses resources and preserves the existing session secret', async t => {
  const f = await fixture(t, { existing: true });
  await f.deploy();
  assert.deepEqual(f.calls.filter(call => call.method !== 'GET').map(call => call.path), ['/api/admin/login', '/api/admin/logout']);
  assert.deepEqual(JSON.parse(f.commands[2].options.input), { ADMIN_PASSWORD: credentials.ADMIN_PASSWORD });
  assert.ok(f.logs.some(message => message.includes('Keeping the existing session secret')));
});

test('missing session secret is initialized on an interrupted earlier deployment', async t => {
  const f = await fixture(t, { existing: true, noSession: true });
  await f.deploy();
  assert.ok(JSON.parse(f.commands[2].options.input).SESSION_SECRET.length >= 32);
});

test('public buckets stop before database setup or Worker deployment and are never reconfigured', async t => {
  const f = await fixture(t, { existing: true, publicBucket: true });
  await assert.rejects(f.deploy, /bucket is public/);
  assert.equal(f.commands.length, 0);
  assert.ok(!f.calls.some(call => call.path.startsWith('/d1/')));
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('an unconfigured account subdomain stops before any cloud mutation', async t => {
  const f = await fixture(t, { noSubdomain: true });
  await assert.rejects(f.deploy, /Activate your workers.dev subdomain/);
  assert.deepEqual(f.calls.map(call => call.path), ['/workers/subdomain']);
});

test('a missing workers.dev prefix is created only from explicit input before provisioning storage', async t => {
  const f = await fixture(t, { noSubdomain: true, requestedSubdomain: 'amubis-shiratsume' });
  const deployed = await f.deploy();
  assert.equal(deployed.origin, 'https://shiratsume-page.amubis-shiratsume.workers.dev');
  assert.deepEqual(f.calls.slice(0, 3), [{ path: '/workers/subdomain', method: 'GET' }, { path: '/workers/subdomain', method: 'GET' }, { path: '/workers/subdomain', method: 'PUT' }]);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  assert.deepEqual(f.calls[3], { path: '/workers/subdomain', method: 'GET' }, 'new prefix is read back before storage setup');
});

test('a successful empty account subdomain object is treated as uninitialized', async t => {
  const f = await fixture(t, { noSubdomain: true, emptySubdomain: true, requestedSubdomain: 'amubis-shiratsume' });
  const deployed = await f.deploy();
  assert.equal(deployed.origin, 'https://shiratsume-page.amubis-shiratsume.workers.dev');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});

test('an explicit null account subdomain is treated as uninitialized', async t => {
  const f = await fixture(t, { noSubdomain: true, nullSubdomain: true, requestedSubdomain: 'amubis-shiratsume' });
  const deployed = await f.deploy();
  assert.equal(deployed.origin, 'https://shiratsume-page.amubis-shiratsume.workers.dev');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
});

test('an existing workers.dev prefix is reused even when a different prefix was explicitly entered', async t => {
  const f = await fixture(t, { requestedSubdomain: 'amubis-shiratsume' });
  const deployed = await f.deploy();
  assert.equal(deployed.origin, 'https://shiratsume-page.amubis.workers.dev');
  assert.ok(!f.calls.some(call => call.method === 'PUT'));
});

test('a workers.dev prefix created concurrently is preserved by the pre-creation recheck', async t => {
  const f = await fixture(t, { noSubdomain: true, requestedSubdomain: 'amubis-shiratsume', concurrentSubdomain: true });
  const deployed = await f.deploy();
  assert.equal(deployed.origin, 'https://shiratsume-page.already-created.workers.dev');
  assert.ok(!f.calls.some(call => call.method === 'PUT'));
});

test('an unavailable requested prefix stops before storage mutations and never echoes provider secrets', async t => {
  const f = await fixture(t, { noSubdomain: true, requestedSubdomain: 'amubis-shiratsume', unavailableSubdomain: true });
  await assert.rejects(f.deploy, error => {
    assert.ok(error.message.includes('requested workers.dev prefix could not be created'));
    assert.ok(error.message.includes('HTTP 409; codes 10031'));
    assert.ok(!error.message.includes(credentials.CLOUDFLARE_API_TOKEN));
    return true;
  });
  assert.equal(f.commands.length, 0);
  assert.ok(f.calls.every(call => call.path === '/workers/subdomain'));
});

test('failed migration cleans temporary config and does not continue to deploy or modify secrets', async t => {
  const f = await fixture(t, { failRun: true });
  await assert.rejects(f.deploy, /Mock migration failure/);
  assert.equal(f.commands.length, 1);
  assert.deepEqual(await readdir(join(f.root, 'worker')), []);
  assert.ok(!f.calls.some(call => call.path.endsWith('/secrets')));
});

test('oversized assets fail before any cloud request', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'dist/oversized.mp4'), '');
  await truncate(join(f.root, 'dist/oversized.mp4'), 25 * 1024 * 1024 + 1);
  await assert.rejects(f.deploy, /25 MiB per-file limit/);
  assert.equal(f.calls.length, 0);
});

test('provider errors report numeric diagnostics without echoing arbitrary response contents', async t => {
  const f = await fixture(t);
  await assert.rejects(() => deployCloudflare(settings, { root: f.root, request: async () => Response.json({ success: false, errors: [{ code: 10000, message: credentials.CLOUDFLARE_API_TOKEN }] }, { status: 403 }) }), error => {
    assert.ok(error.message.includes('HTTP 403; codes 10000'));
    assert.ok(!error.message.includes(credentials.CLOUDFLARE_API_TOKEN));
    return true;
  });
});

test('live credential failure reports only its HTTP status and never reflects a password or retries login', async t => {
  const f = await fixture(t, { badLogin: true });
  await assert.rejects(f.deploy, error => {
    assert.ok(error.message.includes('sign-in check failed (HTTP 401)'));
    assert.ok(!error.message.includes(credentials.ADMIN_PASSWORD));
    return true;
  });
  assert.equal(f.calls.filter(call => call.path === '/api/admin/login').length, 1);
  assert.ok(!f.logs.join('\n').includes(credentials.ADMIN_PASSWORD));
});

test('public edge readiness waits through gateway and secret propagation with safe status diagnostics', async () => {
  let time = 0, requests = 0;
  const logs = [], delays = [];
  await waitForCloudflareReadiness('https://example.workers.dev', {
    request: async () => {
      requests++;
      if (requests === 1) return new Response('private intermediary details must not be logged', { status: 503 });
      if (requests === 2) return Response.json({ configured: false, authenticated: false, mode: 'cloud', csrfToken: 'private-csrf-token' });
      return Response.json({ configured: true, authenticated: false, mode: 'cloud' });
    },
    now: () => time, delay: async ms => { delays.push(ms); time += ms; }, log: message => logs.push(message),
  });
  assert.equal(requests, 3);
  assert.deepEqual(delays, [5000, 5000]);
  assert.ok(logs[0].includes('HTTP 503; JSON=no'));
  assert.ok(logs[1].includes('configured=false; authenticated=false; mode=cloud'));
  assert.ok(!logs.join('\n').includes('private intermediary'));
  assert.ok(!logs.join('\n').includes('private-csrf-token'));
});

test('public edge readiness stops at its time budget without exposing unknown response fields', async () => {
  let time = 0, requests = 0;
  const logs = [];
  await assert.rejects(() => waitForCloudflareReadiness('https://example.workers.dev', {
    request: async () => { requests++; return Response.json({ configured: 'private-string', authenticated: null, mode: 'private-string', error: 'private-string' }, { status: 503 }); },
    now: () => time, timeoutMs: 12_000, retryMs: 5000,
    delay: async ms => { time += ms; }, log: message => logs.push(message),
  }), /did not become ready within 12 seconds/);
  assert.equal(requests, 3);
  assert.equal(time, 12_000);
  assert.ok(logs.every(message => message.includes('configured=unknown; authenticated=unknown; mode=unknown')));
  assert.ok(!logs.join('\n').includes('private-string'));
});

test('live login requires a working authenticated cookie round trip and logs out after a failed session check', async t => {
  const f = await fixture(t, { brokenSession: true });
  await assert.rejects(f.deploy, /authenticated session check failed/);
  assert.equal(f.calls.at(-1).path, '/api/admin/logout');
  assert.ok(!f.logs.join('\n').includes('private-cookie'));
  assert.ok(!f.logs.join('\n').includes('private-csrf-token'));
});

test('explicit content inspection logs aggregate upload and model counts without revealing or changing private content', async t => {
  const media = [
    { id: 'private-photo-id', filename: 'private-filename.png', url: 'media/private-image.png', enabled: false, modelIds: ['shiratsume'], caption: '<script>private-text</script>' },
    { id: 'another-private-id', url: 'https://private.example/media/private-url.jpg', enabled: true, modelIds: ['shiratsume'] },
    { sourceKind: 'upload', url: 'private-source-path', enabled: true, modelIds: ['other-model'] },
    { url: 'assets/seed.jpg', enabled: true, modelIds: ['shiratsume'] },
  ];
  const published = [media[3]];
  const before = JSON.stringify(media);
  const f = await fixture(t, { existing: true, inspectContent: true, draftMedia: media, publishedMedia: published });
  await f.deploy();
  const line = f.logs.find(message => message.startsWith('Content inspection (counts only): '));
  assert.deepEqual(JSON.parse(line.slice('Content inspection (counts only): '.length)), {
    draftTotal: 4, draftIncluded: 3, draftExcluded: 1,
    draftUploadedTotal: 3, draftUploadedIncluded: 2, draftUploadedExcluded: 1,
    draftShiratsumeTotal: 3, draftShiratsumeIncluded: 2,
    publishedTotal: 1, publishedUploaded: 0, publishedShiratsume: 1,
  });
  assert.equal(JSON.stringify(media), before);
  for (const forbidden of ['private-photo-id', 'private-filename', 'private.example', 'private-url', 'private-text', 'private-revision', 'private-cookie', 'private-csrf-token']) assert.ok(!f.logs.join('\n').includes(forbidden));
  assert.deepEqual(f.calls.filter(call => call.method !== 'GET').map(call => call.path), ['/api/admin/login', '/api/admin/logout']);
  assert.equal(f.calls.at(-1).path, '/api/admin/logout');
});

test('inspection failures do not log private provider errors and still discard the login session', async t => {
  const f = await fixture(t, { inspectContent: true, badInspection: true });
  await assert.rejects(f.deploy, error => {
    assert.ok(error.message.includes('read-only content counts check failed (HTTP 503)'));
    assert.ok(!error.message.includes(credentials.ADMIN_PASSWORD));
    return true;
  });
  assert.equal(f.calls.at(-1).path, '/api/admin/logout');
  assert.throws(() => summarizeCloudContent({ content: {} }, { media: [] }), /valid draft and public photo lists/);
});

test('a failing secret command cannot echo protected stdin and never inherits the admin password', async t => {
  const f = await fixture(t);
  const executable = join(f.root, 'npx');
  const record = join(f.root, 'child-env.json');
  await writeFile(executable, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.TEST_RECORD,JSON.stringify({password:process.env.ADMIN_PASSWORD??null,session:process.env.SESSION_SECRET??null}));\nfor await (const part of process.stdin) process.stderr.write(part);\nprocess.exitCode=1;\n`);
  await chmod(executable, 0o700);
  const input = JSON.stringify({ ADMIN_PASSWORD: credentials.ADMIN_PASSWORD, SESSION_SECRET: 'do-not-output-this-random-key' });
  await assert.rejects(() => runWrangler(['secret', 'bulk'], {
    cwd: f.root,
    env: { ...process.env, ...credentials, SESSION_SECRET: 'inherited-secret', PATH: `${f.root}${delimiter}${process.env.PATH}`, TEST_RECORD: record },
    input, sensitive: true,
  }), error => {
    assert.ok(error.message.includes('secret bulk failed'));
    assert.ok(!error.message.includes(credentials.ADMIN_PASSWORD));
    assert.ok(!error.message.includes('do-not-output-this-random-key'));
    return true;
  });
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), { password: null, session: null });
});
