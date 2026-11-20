import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const value = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(value, `exercise the real ${name} behavior`);
  return value;
};
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function fixture() {
  const state = { authenticated: true, connected: true, section: 'overview', messageStatus: 'pending', messageUnread: false,
    messagesBusy: false, messagesLoaded: false, messagesError: '', comments: [], notifications: [], unreadCount: 0, pendingCount: 0 };
  const calls = [], notices = [];
  let version = 1, renders = 0, implementation = async path => path.includes('/notifications?')
    ? { notifications: [{ id: `notification-${version}` }], unreadCount: version, pendingCount: version }
    : { comments: [{ id: `comment-${version}`, body: `正文 ${version}` }], pendingCount: version };
  const controls = runInNewContext(`let messagesRequest=0; const messageCache=new Map(), messageActions=new Set();
    ${['clearMessageCache', 'recordSession', 'refreshMessages', 'mutateMessages'].map(handler).join('\n')}
    ({clearMessageCache,recordSession,refreshMessages,mutateMessages})`, {
    state, URLSearchParams, document: { hidden: false, activeElement: null },
    localStorage: { setItem() {}, removeItem() {} }, MODE_KEY: 'admin-mode',
    api: (path, options) => { calls.push({ path, options }); return implementation(path, options); },
    navigation() {}, renderMessagesBody() { renders++; }, cloudLocked: () => !state.authenticated,
    reportError: error => notices.push(error.message), toast: message => notices.push(message),
  });
  return { state, controls, calls, notices, setVersion(value) { version = value; }, setApi(value) { implementation = value; }, get renders() { return renders; } };
}

test('administrator summaries and visited comment filters are retained until an explicit refresh', async () => {
  const f = fixture();
  await f.controls.refreshMessages(); await f.controls.refreshMessages({ quiet: true });
  assert.equal(f.calls.length, 1, 'the initial badge summary is loaded once');
  f.state.section = 'messages';
  await f.controls.refreshMessages();
  assert.equal(f.calls.length, 3, 'entering messages fetches its full notifications and selected comments once');
  f.setVersion(2);
  await f.controls.refreshMessages();
  assert.equal(f.state.comments[0].id, 'comment-1');
  assert.equal(f.calls.length, 3);
  f.state.messageStatus = 'all'; await f.controls.refreshMessages();
  assert.equal(f.calls.length, 5, 'a previously unseen filter can load its own results');
  f.state.messageStatus = 'pending'; await f.controls.refreshMessages();
  assert.equal(f.calls.length, 5); assert.equal(f.state.comments[0].id, 'comment-1');
  await f.controls.refreshMessages({ force: true });
  assert.equal(f.calls.length, 7); assert.equal(f.state.comments[0].id, 'comment-2');
});

test('overlapping ordinary requests share their completed result without a queued duplicate fetch', async () => {
  const f = fixture();
  let finish;
  f.setApi(() => new Promise(resolve => { finish = resolve; }));
  const first = f.controls.refreshMessages();
  await f.controls.refreshMessages({ quiet: true });
  assert.equal(f.calls.length, 1);
  finish({ notifications: [], unreadCount: 0, pendingCount: 0 });
  await first; await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.state.messagesLoaded, true);
});

test('administrator mutations invalidate cached filter results and read their acknowledged changes', async () => {
  const f = fixture(); f.state.section = 'messages';
  await f.controls.refreshMessages();
  f.state.messageStatus = 'all'; await f.controls.refreshMessages();
  const before = f.calls.length;
  const saved = await f.controls.mutateMessages('comment-1', async () => {
    f.setVersion(3); return { unreadCount: 3, pendingCount: 3 };
  });
  assert.equal(saved, true); assert.equal(f.state.comments[0].id, 'comment-3');
  assert.equal(f.calls.length, before + 2);
  f.state.messageStatus = 'pending'; await f.controls.refreshMessages();
  assert.equal(f.state.comments[0].id, 'comment-3', 'an old status cache cannot survive moderation or a reply');
  assert.equal(f.calls.length, before + 4);
});

test('failed reads can retry without preserving a failure as cached content', async () => {
  const f = fixture();
  f.setApi(async () => { throw new Error('临时离线'); });
  await f.controls.refreshMessages();
  assert.equal(f.state.messagesLoaded, false); assert.equal(f.state.messagesError, '临时离线');
  f.setApi(async () => ({ notifications: [{ id: 'reconnected' }], unreadCount: 0 }));
  await f.controls.refreshMessages();
  assert.equal(f.state.messagesError, ''); assert.equal(f.state.notifications[0].id, 'reconnected');
});

test('session changes clear private message caches and ignore late results from the previous session', async () => {
  const f = fixture();
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-one', mode: 'cloud' });
  await f.controls.refreshMessages();
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-one', mode: 'cloud' });
  await f.controls.refreshMessages();
  assert.equal(f.calls.length, 1, 'a repeated identical session does not invalidate the cache');
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-two', mode: 'cloud' });
  assert.equal(f.state.notifications.length, 0);
  let finish;
  f.setApi(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controls.refreshMessages();
  f.controls.clearMessageCache(); f.state.authenticated = false;
  finish({ notifications: [{ id: 'private-late-result' }], unreadCount: 4 });
  await pending;
  assert.equal(f.state.notifications.length, 0); assert.equal(f.state.messagesLoaded, false);
});

test('window activation and timers no longer register automatic admin message fetching', () => {
  assert.doesNotMatch(source, /(?:addEventListener\(['"](?:focus|visibilitychange)['"]|setInterval)[^\n]*refreshMessages/);
  assert.match(source, /刷新消息[^\n]+refreshMessages\(\{ force: true \}\)/);
});
