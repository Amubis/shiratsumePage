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
  const state = { authenticated: true, connected: true, section: 'overview', messageView: 'all', messageType: '',
    messagesBusy: false, messagesError: '', unreadCount: 0 };
  const calls = [], notices = [];
  let version = 1;
  let implementation = async () => ({ notifications: [{ id: `notification-${version}` }], unreadCount: version });
  const renders = [];
  const controls = runInNewContext(`let messagesRequest=0; const MESSAGE_LIMIT=200, messageCache=new Map(), messageActions=new Set();
    ${['clearMessageCache', 'recordSession', 'messageQuery', 'refreshMessages', 'mutateMessages'].map(handler).join('\n')}
    ({clearMessageCache,recordSession,refreshMessages,mutateMessages,records:()=>messageCache.get(messageQuery())})`, {
    state, URLSearchParams, document: { hidden: false, activeElement: null },
    localStorage: { setItem() {}, removeItem() {} }, MODE_KEY: 'admin-mode',
    api: (path, options) => { calls.push({ path, options }); return implementation(path, options); },
    navigation() {}, renderMessagesBody() { renders.push(controls.records()?.[0]?.id); }, cloudLocked: () => !state.authenticated,
    reportError: error => notices.push(error.message), toast: message => notices.push(message),
  });
  return { state, controls, calls, notices, renders, setVersion(value) { version = value; }, setApi(value) { implementation = value; } };
}

test('administrator summaries and visited notification filters are retained until an explicit refresh', async () => {
  const f = fixture();
  await f.controls.refreshMessages(); await f.controls.refreshMessages({ quiet: true });
  assert.equal(f.calls.length, 1, 'the initial badge summary is loaded once');
  f.state.section = 'messages';
  await f.controls.refreshMessages();
  assert.equal(f.calls.length, 2, 'entering messages fetches one sorted notification list');
  assert.equal(f.calls[1].path, '/api/admin/notifications?limit=200&unread=all');
  f.setVersion(2);
  await f.controls.refreshMessages();
  assert.equal(f.controls.records()[0].id, 'notification-1');
  assert.equal(f.calls.length, 2);
  f.state.messageView = 'unread'; f.state.messageType = 'photo'; await f.controls.refreshMessages();
  assert.equal(f.calls.length, 3, 'a previously unseen filter can load its own results');
  assert.equal(f.calls[2].path, '/api/admin/notifications?limit=200&unread=true&targetType=photo');
  f.state.messageView = 'all'; f.state.messageType = ''; await f.controls.refreshMessages();
  assert.equal(f.calls.length, 3); assert.equal(f.controls.records()[0].id, 'notification-1');
  assert.equal(f.state.unreadCount, 2, 'revisiting all items does not restore an older unread count');
  await f.controls.refreshMessages({ force: true });
  assert.equal(f.calls.length, 4); assert.equal(f.controls.records()[0].id, 'notification-2');
});

test('overlapping ordinary requests share their completed result without a queued duplicate fetch', async () => {
  const f = fixture();
  let finish;
  f.setApi(() => new Promise(resolve => { finish = resolve; }));
  const first = f.controls.refreshMessages();
  await f.controls.refreshMessages({ quiet: true });
  assert.equal(f.calls.length, 1);
  finish({ notifications: [], unreadCount: 0 });
  await first; await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.controls.records().length, 0);
});

test('a late notification response does not render into a different source filter', async () => {
  const f = fixture(); f.state.section = 'messages';
  let finish;
  f.setApi(path => path.endsWith('targetType=note')
    ? Promise.resolve({ notifications: [{ id: 'note' }], unreadCount: 2 })
    : new Promise(resolve => { finish = resolve; }));
  const first = f.controls.refreshMessages();
  f.state.messageType = 'note'; await f.controls.refreshMessages();
  finish({ notifications: [{ id: 'all' }], unreadCount: 2 });
  await first; await tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.renders.includes('all'), false);
  assert.equal(f.renders.at(-1), 'note');
});

test('administrator mutations invalidate cached filter results and read their acknowledged changes', async () => {
  const f = fixture(); f.state.section = 'messages';
  await f.controls.refreshMessages();
  f.state.messageView = 'unread'; await f.controls.refreshMessages();
  const before = f.calls.length;
  const saved = await f.controls.mutateMessages('comment-1', async () => {
    f.setVersion(3); return { unreadCount: 3 };
  });
  assert.equal(saved, true); assert.equal(f.controls.records()[0].id, 'notification-3');
  assert.equal(f.calls.length, before + 1);
  f.state.messageView = 'all'; await f.controls.refreshMessages();
  assert.equal(f.controls.records()[0].id, 'notification-3', 'an old filter cache cannot survive a read or reply');
  assert.equal(f.calls.length, before + 2);
});

test('failed reads can retry without preserving a failure as cached content', async () => {
  const f = fixture();
  f.setApi(async () => { throw new Error('临时离线'); });
  await f.controls.refreshMessages();
  assert.equal(f.controls.records(), undefined); assert.equal(f.state.messagesError, '临时离线');
  f.setApi(async () => ({ notifications: [{ id: 'reconnected' }], unreadCount: 0 }));
  await f.controls.refreshMessages();
  assert.equal(f.state.messagesError, ''); assert.equal(f.controls.records()[0].id, 'reconnected');
});

test('session changes clear private message caches and ignore late results from the previous session', async () => {
  const f = fixture();
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-one', mode: 'cloud' });
  await f.controls.refreshMessages();
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-one', mode: 'cloud' });
  await f.controls.refreshMessages();
  assert.equal(f.calls.length, 1, 'a repeated identical session does not invalidate the cache');
  f.controls.recordSession({ authenticated: true, csrfToken: 'session-two', mode: 'cloud' });
  assert.equal(f.controls.records(), undefined);
  let finish;
  f.setApi(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.controls.refreshMessages();
  f.controls.clearMessageCache(); f.state.authenticated = false;
  finish({ notifications: [{ id: 'private-late-result' }], unreadCount: 4 });
  await pending;
  assert.equal(f.controls.records(), undefined); assert.equal(f.state.unreadCount, 0);
});

test('window activation and timers no longer register automatic admin message fetching', () => {
  assert.doesNotMatch(source, /(?:addEventListener\(['"](?:focus|visibilitychange)['"]|setInterval)[^\n]*refreshMessages/);
  assert.match(source, /刷新消息[^\n]+refreshMessages\(\{ force: true \}\)/);
});
