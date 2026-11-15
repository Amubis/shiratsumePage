import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import worker from '../worker/index.mjs';

async function serve(t, env) {
  const server = createServer(async (incoming, outgoing) => {
    const request = new Request(`https://garden.example${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('Worker keeps content available and explicitly disables comments without a D1 binding over HTTP', async t => {
  const origin = await serve(t, {
    BUCKET: { get: async () => null },
    ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'a-secret-containing-at-least-32-characters',
    ASSETS: { fetch: async () => new Response('Static page') },
  });
  const contentResponse = await fetch(`${origin}/api/content`);
  const content = await contentResponse.json();
  assert.equal(contentResponse.status, 200);
  assert.equal(content.schemaVersion, 1);
  const etag = contentResponse.headers.get('etag');
  const conditional = await fetch(`${origin}/api/content`, { headers: { 'If-None-Match': etag } });
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), '');
  const commentsResponse = await fetch(`${origin}/api/comments?targetType=photo&targetId=anything`, { headers: { Origin: 'https://public.example' } });
  assert.equal(commentsResponse.status, 503);
  assert.equal(commentsResponse.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await commentsResponse.json(), { error: 'Comments are unavailable. Configure the comments database first.', code: 'comments_unavailable', available: false });
  const post = await fetch(`${origin}/api/comments`, { method: 'POST', headers: { Origin: 'https://garden.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'photo', targetId: 'anything', body: 'Hello' }) });
  assert.equal(post.status, 503);
  assert.equal(post.headers.get('access-control-allow-origin'), 'https://garden.example');
  assert.equal((await post.json()).code, 'comments_unavailable');
  const admin = await fetch(`${origin}/api/admin/notifications`);
  assert.equal(admin.status, 401);
  await admin.json();
  const login = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers: { Origin: 'https://garden.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  await login.json();
  const notifications = await fetch(`${origin}/api/admin/notifications`, { headers: { Cookie: cookie } });
  assert.equal(notifications.status, 503);
  assert.equal((await notifications.json()).code, 'comments_unavailable');
  assert.equal(await (await fetch(`${origin}/admin/`)).text(), 'Static page');
});
