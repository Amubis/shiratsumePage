import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WRANGLER_VERSION = '4.164.0';
const API = 'https://api.cloudflare.com/client/v4';
const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CHECK_USER_AGENT = 'ShiratsumeDeploymentCheck/1.0 (+https://github.com/Amubis/shiratsumePage)';

export function readDeploymentSettings(env = process.env) {
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the 32-character Account ID in Actions variables or the manual workflow input.');
  const token = (env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!token || /\s/.test(token)) throw new Error('Add CLOUDFLARE_API_TOKEN in repository Settings → Secrets and variables → Actions → Secrets.');
  const password = env.ADMIN_PASSWORD;
  if (typeof password !== 'string' || !password.length) throw new Error('Add ADMIN_PASSWORD as a repository Actions secret. Its value is never placed in a configuration file.');
  if (password.length > 1024) throw new Error('ADMIN_PASSWORD exceeds the management login limit of 1024 characters.');
  const named = (key, fallback, min, max) => {
    const value = (env[key] || fallback).trim();
    if (!NAME.test(value) || value.length < min || value.length > max) throw new Error(`${key} must contain ${min}–${max} lowercase letters, digits or hyphens, with a letter or digit at each end.`);
    return value;
  };
  const username = (env.ADMIN_USERNAME || 'Amubis').trim();
  if (!username || username.length > 120 || /[\u0000-\u001f\u007f]/.test(username)) throw new Error('ADMIN_USERNAME must contain 1–120 characters.');
  const workersSubdomain = (env.CLOUDFLARE_WORKERS_SUBDOMAIN || '').trim();
  if (workersSubdomain && (!NAME.test(workersSubdomain) || workersSubdomain.length < 3 || workersSubdomain.length > 63)) {
    throw new Error('CLOUDFLARE_WORKERS_SUBDOMAIN must be blank or 3–63 lowercase letters, digits or hyphens, with a letter or digit at each end.');
  }
  const origins = (env.PUBLIC_SITE_ORIGINS || 'https://amubis.github.io').split(',').map(value => value.trim()).filter(Boolean);
  for (const value of origins) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('PUBLIC_SITE_ORIGINS must be comma-separated HTTPS origins, without paths.'); }
    if (parsed.protocol !== 'https:' || parsed.origin !== value) throw new Error('PUBLIC_SITE_ORIGINS must be comma-separated HTTPS origins, without paths.');
  }
  return {
    accountId, token, password, username, workersSubdomain, origins: [...new Set(origins)].join(','),
    workerName: named('CLOUDFLARE_WORKER_NAME', 'shiratsume-page', 1, 63),
    bucketName: named('CLOUDFLARE_R2_BUCKET', 'shiratsume-page', 3, 63),
    databaseName: named('CLOUDFLARE_D1_NAME', 'shiratsume-comments', 1, 63),
  };
}

function cloudflareApi(settings, request) {
  return async (path, { method = 'GET', body, missing = false } = {}) => {
    let response;
    try {
      response = await request(`${API}/accounts/${settings.accountId}${path}`, {
        method,
        headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error(`Cloudflare ${method} ${path.split('?')[0]} could not be reached. Check connectivity and rerun the workflow.`); }
    if (missing && response.status === 404) return null;
    let data;
    try { data = await response.json(); } catch { /* Never echo a provider response or credentials. */ }
    if (!response.ok || data?.success !== true) {
      const codes = (data?.errors || []).map(error => error.code).filter(code => Number.isSafeInteger(code));
      throw new Error(`Cloudflare ${method} ${path.split('?')[0]} failed (HTTP ${response.status}${codes.length ? `; codes ${codes.join(', ')}` : ''}). Check the account, token permissions and resource names; existing resources were not deleted.`);
    }
    return data;
  };
}

/** Deliberately capture output: secret bulk must never echo its stdin, even on failure. */
export function runWrangler(args, { cwd = project, env = process.env, input = '', sensitive = false } = {}) {
  return new Promise((accept, reject) => {
    const childEnv = { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
    delete childEnv.ADMIN_PASSWORD;
    delete childEnv.SESSION_SECRET;
    const child = spawn('npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = '';
    const capture = chunk => { if (!sensitive) output = (output + chunk.toString()).slice(-16_000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', () => reject(new Error('Wrangler could not start. Check Node.js, npm and registry access.')));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('close', code => {
      if (code === 0) return accept();
      // Token/password values are scrubbed even if a third-party CLI includes them in errors.
      for (const value of [env.CLOUDFLARE_API_TOKEN, env.ADMIN_PASSWORD, env.SESSION_SECRET]) if (value) output = output.split(value).join('[redacted]');
      reject(new Error(`Wrangler ${args.slice(0, 3).join(' ')} failed (exit ${code ?? 'unknown'}).${!sensitive && output.trim() ? `\n${output.trim()}` : ' Check the token permissions and Cloudflare service status, then rerun.'}`));
    });
  });
}

async function checkAssets(root) {
  const output = join(root, 'dist');
  try { await stat(join(output, 'index.html')); } catch { throw new Error('Build dist/ before deploying: npm run build.'); }
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((await stat(path)).size > 25 * 1024 * 1024) throw new Error(`Static asset exceeds the Workers 25 MiB per-file limit: ${path.slice(root.length + 1)}. Deployment stopped before creating resources.`);
    }
  };
  await visit(output);
}

export function summarizeCloudContent(draft, published) {
  if (!Array.isArray(draft?.content?.media) || !Array.isArray(published?.media)) throw new Error('Content inspection did not receive valid draft and public photo lists.');
  const items = draft.content.media;
  const included = item => item?.enabled !== false;
  const uploaded = item => item?.sourceKind === 'upload' || (typeof item?.url === 'string' && /^(?:\.?\/)?media\/|^https?:\/\/[^/]+\/media\//.test(item.url));
  const shiratsume = item => Array.isArray(item?.modelIds) && item.modelIds.includes('shiratsume');
  const uploads = items.filter(uploaded);
  return {
    draftTotal: items.length,
    draftIncluded: items.filter(included).length,
    draftExcluded: items.filter(item => !included(item)).length,
    draftUploadedTotal: uploads.length,
    draftUploadedIncluded: uploads.filter(included).length,
    draftUploadedExcluded: uploads.filter(item => !included(item)).length,
    draftShiratsumeTotal: items.filter(shiratsume).length,
    draftShiratsumeIncluded: items.filter(item => included(item) && shiratsume(item)).length,
    publishedTotal: published.media.length,
    publishedUploaded: published.media.filter(uploaded).length,
    publishedShiratsume: published.media.filter(shiratsume).length,
  };
}

async function verifyAdministratorAccess(settings, origin, request, { inspectContent = false, log = console.log } = {}) {
  let cookie = '', csrf = '', stage = 'sign-in', status;
  const send = (path, options = {}) => request(`${origin}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Origin: origin, 'User-Agent': CHECK_USER_AGENT, Accept: 'application/json', ...options.headers },
  });
  try {
    const login = await send('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: settings.username, password: settings.password }),
    });
    status = login.status;
    if (!login.ok) throw new Error();
    const signedIn = await login.json();
    const cookies = login.headers.getSetCookie?.() || [login.headers.get('set-cookie') || ''];
    cookie = cookies.map(value => value.split(';')[0]).find(value => /^__Host-garden_session=[^\s;]+$/.test(value)) || '';
    csrf = typeof signedIn.csrfToken === 'string' ? signedIn.csrfToken : '';
    if (!signedIn.authenticated || !cookie || !csrf) throw new Error();
    stage = 'authenticated session';
    status = undefined;
    const session = await send('/api/admin/session', { headers: { Cookie: cookie } });
    status = session.status;
    if (!session.ok || (await session.json()).authenticated !== true) throw new Error();
    if (inspectContent === true) {
      stage = 'read-only content counts';
      status = undefined;
      const draft = await send('/api/admin/content', { headers: { Cookie: cookie } });
      status = draft.status;
      if (!draft.ok) throw new Error();
      const draftBody = await draft.json();
      const published = await send('/api/content');
      status = published.status;
      if (!published.ok) throw new Error();
      const summary = summarizeCloudContent(draftBody, await published.json());
      log(`Content inspection (counts only): ${JSON.stringify(summary)}`);
    }
  } catch {
    // Provider response text, cookies, CSRF tokens and credential-bearing errors are never logged.
    throw new Error(`Administrator ${stage} check failed${status ? ` (HTTP ${status})` : ''}. Check ADMIN_USERNAME and the ADMIN_PASSWORD Actions secret, then rerun; no content was changed.`);
  } finally {
    if (cookie && csrf) {
      try {
        const response = await send('/api/admin/logout', { method: 'POST', headers: { Cookie: cookie, 'X-Garden-CSRF': csrf } });
        if (!response.ok) throw new Error();
      } catch {
        // The session stays only in this runner's memory and is never persisted as a browser cookie.
        // A failed logout must not replace a more useful sign-in/session diagnostic.
      }
    }
    cookie = '';
    csrf = '';
  }
}

export async function waitForCloudflareReadiness(origin, {
  request = fetch, log = console.log, delay = ms => new Promise(accept => setTimeout(accept, ms)),
  now = () => Date.now(), timeoutMs = 180_000, retryMs = 5000,
} = {}) {
  const deadline = now() + timeoutMs;
  const attempts = Math.ceil(timeoutMs / retryMs) + 1;
  for (let attempt = 1; attempt <= attempts && now() < deadline; attempt++) {
    let status = 'network-error', session = null;
    try {
      const response = await request(`${origin}/api/admin/session`, { headers: { 'User-Agent': CHECK_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now()))), redirect: 'error' });
      status = response.status;
      try { session = await response.json(); } catch { /* An edge gateway can temporarily return an HTML error. */ }
      if (response.ok && session?.configured === true && session.authenticated === false && session.mode === 'cloud') return;
    } catch { /* New workers.dev DNS/TLS and secret versions can need time to propagate. */ }
    const flag = key => typeof session?.[key] === 'boolean' ? String(session[key]) : 'unknown';
    const mode = ['cloud', 'local'].includes(session?.mode) ? session.mode : 'unknown';
    // These fields have a fixed vocabulary. Never log response bodies, error text,
    // cookies, CSRF values, or other fields returned by an intermediate gateway.
    log(`Waiting for public edge (${attempt}/${attempts}): HTTP ${status}; JSON=${session !== null && typeof session === 'object' ? 'yes' : 'no'}; configured=${flag('configured')}; authenticated=${flag('authenticated')}; mode=${mode}.`);
    const remaining = deadline - now();
    if (attempt < attempts && remaining > 0) await delay(Math.min(retryMs, remaining));
  }
  throw new Error(`Deployment finished, but public authentication at ${origin} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds. The workers.dev DNS/TLS or secret deployment may still be propagating; inspect the safe status checks above and rerun. Existing resources, content and session secrets were kept.`);
}

export async function deployCloudflare(settings, {
  root = project, request = fetch, run = runWrangler, log = console.log,
  env = process.env, random = () => randomBytes(48).toString('hex'),
  delay = ms => new Promise(accept => setTimeout(accept, ms)),
  inspectContent = false,
} = {}) {
  await checkAssets(root);
  const api = cloudflareApi(settings, request);
  // Read first, including once more immediately before creation. An existing
  // account-level hostname always wins over input; this workflow never renames it.
  const readSubdomain = async () => {
    const response = await api('/workers/subdomain', { missing: true });
    if (response === null || response.result === null || response.result?.subdomain === null || response.result?.subdomain === '' || (response.result && typeof response.result === 'object' && !Array.isArray(response.result) && Object.keys(response.result).length === 0)) return '';
    const value = response.result?.subdomain;
    if (typeof value !== 'string' || !NAME.test(value) || value.length > 63) throw new Error('Cloudflare returned an unexpected workers.dev subdomain. No account-level hostname was changed.');
    return value;
  };
  let subdomain = await readSubdomain();
  if (!subdomain) {
    if (!settings.workersSubdomain) throw new Error('Activate your workers.dev subdomain in Cloudflare → Workers & Pages, or explicitly fill the optional workers_subdomain workflow input to create it, then rerun. An existing account-level subdomain is never renamed.');
    subdomain = await readSubdomain();
    if (!subdomain) {
      let created;
      try { created = await api('/workers/subdomain', { method: 'PUT', body: { subdomain: settings.workersSubdomain } }); }
      catch (error) { throw new Error(`The requested workers.dev prefix could not be created. It may be unavailable; choose another explicit prefix or check Cloudflare permissions. ${error.message}`); }
      subdomain = created.result?.subdomain;
      if (subdomain !== settings.workersSubdomain) throw new Error('Cloudflare did not confirm the requested workers.dev prefix. Storage and Worker deployment were not started.');
      let confirmed = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        confirmed = await readSubdomain();
        if (confirmed) break;
        if (attempt < 2) await delay(750);
      }
      if (confirmed !== subdomain) throw new Error('The new workers.dev prefix could not be verified. Rerun the workflow after Cloudflare finishes activation; storage and Worker deployment were not started.');
      log(`Created the explicitly requested workers.dev prefix: ${subdomain}`);
    }
  }

  const bucketPath = `/r2/buckets/${settings.bucketName}`;
  if (!await api(bucketPath, { missing: true })) {
    await api('/r2/buckets', { method: 'POST', body: { name: settings.bucketName, storageClass: 'Standard' } });
    log(`Created private R2 bucket: ${settings.bucketName}`);
  } else log(`Reusing R2 bucket: ${settings.bucketName}`);
  const managed = (await api(`${bucketPath}/domains/managed`)).result;
  const custom = (await api(`${bucketPath}/domains/custom`)).result;
  if (managed?.enabled !== false || !Array.isArray(custom?.domains) || custom.domains.some(domain => domain.enabled !== false)) {
    throw new Error('The chosen R2 bucket is public or its privacy could not be verified. Disable its r2.dev and public custom-domain access in Cloudflare, or choose a dedicated private bucket. No domain setting was changed.');
  }

  let database;
  for (let page = 1; ; page++) {
    const result = await api(`/d1/database?name=${encodeURIComponent(settings.databaseName)}&per_page=100&page=${page}`);
    if (!Array.isArray(result.result)) throw new Error('Cloudflare returned an unexpected D1 database list. Deployment stopped.');
    for (const candidate of result.result) if (candidate.name === settings.databaseName) {
      if (database) throw new Error('Several D1 databases have the requested name. Choose a unique CLOUDFLARE_D1_NAME before deploying.');
      database = candidate;
    }
    if (result.result.length < 100) break;
    if (page >= 100) throw new Error('D1 lookup exceeded its safe pagination limit. Choose a more specific database name.');
  }
  if (!database) {
    database = (await api('/d1/database', { method: 'POST', body: { name: settings.databaseName } })).result;
    log(`Created D1 database: ${settings.databaseName}`);
  } else log(`Reusing D1 database: ${settings.databaseName}`);
  if (!/^[a-f0-9-]{36}$/i.test(database?.uuid || '')) throw new Error('Cloudflare did not return a valid D1 database identifier.');

  const configPath = join(root, 'worker', `.cloudflare-deploy.${randomBytes(8).toString('hex')}.json`);
  const config = {
    name: settings.workerName, account_id: settings.accountId, main: 'index.mjs', compatibility_date: '2026-11-01',
    workers_dev: true, preview_urls: false, keep_vars: true,
    assets: { directory: '../dist', binding: 'ASSETS', run_worker_first: ['/api/*', '/media/*'] },
    r2_buckets: [{ binding: 'BUCKET', bucket_name: settings.bucketName }],
    d1_databases: [{ binding: 'DB', database_name: settings.databaseName, database_id: database.uuid, migrations_dir: 'migrations' }],
    vars: { ADMIN_USERNAME: settings.username, PUBLIC_SITE_ORIGINS: settings.origins },
  };
  const runnerEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: settings.accountId, CLOUDFLARE_API_TOKEN: settings.token };
  try {
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    log('Applying pending D1 migrations without resetting existing tables.');
    await run(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath], { cwd: root, env: runnerEnv, input: 'y\n' });
    log(`Deploying ${settings.workerName} and its static website.`);
    // The initial deployment has no working administrator login until both secrets exist.
    // Later deploys preserve existing secrets; no content import or seed reset is performed.
    await run(['deploy', '--config', configPath], { cwd: root, env: runnerEnv });
    const secrets = (await api(`/workers/scripts/${settings.workerName}/secrets`)).result;
    if (!Array.isArray(secrets)) throw new Error('Cloudflare did not return the Worker secret-name list. No existing session secret was changed.');
    const values = { ADMIN_PASSWORD: settings.password };
    if (!secrets.some(secret => secret.name === 'SESSION_SECRET')) {
      values.SESSION_SECRET = random();
      if (values.SESSION_SECRET.length < 32) throw new Error('Generated session secret is too short.');
      log('Creating the initial session secret; subsequent runs preserve it.');
    } else log('Keeping the existing session secret.');
    await run(['secret', 'bulk', '--config', configPath], { cwd: root, env: runnerEnv, input: JSON.stringify(values), sensitive: true });
  } finally { await rm(configPath, { force: true }); }

  const origin = `https://${settings.workerName}.${subdomain}.workers.dev`;
  await waitForCloudflareReadiness(origin, { request, log, delay });
  await verifyAdministratorAccess(settings, origin, request, { inspectContent, log });
  log('Administrator sign-in and authenticated session verified; temporary login credentials were discarded.');
  log(`Cloudflare is ready: ${origin}/admin/`);
  return { origin, adminUrl: `${origin}/admin/`, apiBaseUrl: origin, bucketName: settings.bucketName, databaseName: settings.databaseName };
}

async function main() {
  const settings = readDeploymentSettings();
  if (process.argv.includes('--check')) { console.log('Cloudflare deployment inputs are present and valid. No cloud request was made.'); return; }
  const result = await deployCloudflare(settings, { inspectContent: process.env.CLOUDFLARE_INSPECT_CONTENT === 'true' });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `origin=${result.origin}\nadmin_url=${result.adminUrl}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    '## Cloudflare deployment ready', '',
    `- Website: ${result.origin}/`, `- Content management: ${result.adminUrl}`,
    `- Administrator: ${settings.username}`, `- Private R2: ${result.bucketName}`, `- D1: ${result.databaseName}`, '',
    'Next: set `data/runtime.json` to `' + JSON.stringify({ apiBaseUrl: result.origin, adminUrl: result.adminUrl }) + '` and deploy GitHub Pages to connect its public site. This workflow does not overwrite existing published content.', '',
  ].join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Cloudflare setup: ${error.message}`); process.exitCode = 1; });
}
