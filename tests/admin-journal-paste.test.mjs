import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const value = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(value, `exercise the real ${name} behavior`);
  return value;
};
function fixture() {
  const note = { id: 'note-a', title: { zh: '标题', ja: '' }, body: { zh: '正在输入的正文', ja: '本文' }, images: [], published: false };
  const other = { id: 'note-b', body: '另一条草稿', images: [], published: true };
  const jobs = [], notices = [];
  let changes = 0, renders = 0, warningRemoved = 0;
  const list = {
    children: [], id: note.id,
    getAttribute(name) { return name === 'data-journal-id' ? this.id : null; },
    append(card) { this.children.push(card); },
  };
  const state = { content: { journal: [note, other] }, section: 'journal' };
  const names = ['clipboardImages', 'queueJournalImages', 'pasteJournalImages', 'queueFiles'];
  const controls = runInNewContext(`${names.map(handler).join('\n')}\n({${names.join(',')}})`, {
    state: Object.assign(state, { connected: true, authenticated: true, jobs }), MAX_FILE_SIZE: 25 * 1024 * 1024,
    identifier: () => `job-${jobs.length}`, toast: (...args) => notices.push(args), renderUploads() {}, pumpUploads() {},
    changed() { changes++; }, render() { renders++; },
    journalImageCard(current, entry) { return { current, entry, down: { disabled: true }, querySelector() { return this.down; } }; },
    $: selector => selector.endsWith('.journal-images') ? list : selector.endsWith('.journal-empty-warning') ? { remove() { warningRemoved++; } } : null,
  });
  return { controls, note, other, state, jobs, list, notices, get changes() { return changes; }, get renders() { return renders; }, get warningRemoved() { return warningRemoved; } };
}
const file = (name = 'screenshot.png', type = 'image/png', size = 123) => ({ name, type, size });
const clipboard = ({ images = [], files = images, text = '' } = {}) => ({
  clipboardData: {
    items: [...images.map(image => ({ kind: 'file', type: image.type, getAsFile: () => image })), ...(text ? [{ kind: 'string', type: 'text/plain' }] : [])],
    files, getData: () => text,
  },
  prevented: false, preventDefault() { this.prevented = true; },
});

test('clipboard images queue once despite duplicate item/file representations and preserve native text paste', () => {
  const f = fixture(), png = file(), jpeg = file('photo.jpg', 'image/jpeg');
  const event = clipboard({ images: [png, jpeg], text: '带图片的文本' });
  f.controls.pasteJournalImages(event, f.note);
  assert.equal(f.jobs.length, 2);
  assert.deepEqual(f.jobs.map(job => job.file), [png, jpeg]);
  assert.equal(f.jobs.every(job => job.options.kind === 'journal' && job.status === 'queued'), true);
  assert.equal(event.prevented, false);
  assert.equal(f.note.images.length, 0, 'images attach only after successful upload');
  assert.equal(f.note.published, false);
});

test('ordinary text and nonimage clipboard files do not start uploads or consume the native paste', () => {
  const f = fixture();
  for (const event of [clipboard({ text: '普通粘贴' }), clipboard({ images: [], files: [file('text.txt', 'text/plain')] }), {}]) {
    f.controls.pasteJournalImages(event, f.note);
    assert.notEqual(event.prevented, true);
  }
  assert.equal(f.jobs.length, 0);
  const png = file();
  f.controls.pasteJournalImages(clipboard({ images: [], files: [png] }), f.note);
  assert.equal(f.jobs.length, 1, 'files-only clipboard implementations are supported');
});

test('upload completion updates only images while retaining body, publishing state and current editor DOM', () => {
  const f = fixture();
  const body = f.note.body;
  f.controls.pasteJournalImages(clipboard({ images: [file()] }), f.note);
  f.note.body.zh += '：上传过程中继续写';
  f.jobs[0].options.onComplete({ reference: 'media/first.png' });
  assert.equal(f.note.body, body);
  assert.equal(f.note.body.zh, '正在输入的正文：上传过程中继续写');
  assert.equal(f.note.images[0].url, 'media/first.png');
  assert.equal(f.list.children.length, 1);
  assert.equal(f.renders, 0, 'textareas are not replaced, so selection and IME survive');
  assert.equal(f.changes, 1);
  assert.equal(f.warningRemoved, 1);
  assert.equal(f.note.published, false);
  f.controls.pasteJournalImages(clipboard({ images: [file('second.png')] }), f.note);
  f.jobs[1].options.onComplete({ reference: 'media/second.png' });
  assert.equal(f.list.children[0].down.disabled, false, 'existing image can move down after an append');
  assert.equal(f.list.children[1].down.disabled, true);
});

test('switching notes during upload retains the original target and never changes the new editor', () => {
  const f = fixture();
  f.controls.pasteJournalImages(clipboard({ images: [file()] }), f.note);
  f.list.id = f.other.id;
  f.jobs[0].options.onComplete({ reference: 'media/original-note.png' });
  assert.equal(f.note.images.length, 1);
  assert.equal(f.other.images.length, 0);
  assert.equal(f.other.published, true);
  assert.equal(f.list.children.length, 0);
  assert.equal(f.renders, 0);
});

test('deleted notes reject attachment visibly through the existing retryable upload job flow', () => {
  const f = fixture();
  f.controls.pasteJournalImages(clipboard({ images: [file()] }), f.note);
  f.state.content.journal.splice(0, 1);
  assert.throws(() => f.jobs[0].options.onComplete({ reference: 'media/deleted-note.png' }), /碎碎念已被移除/);
  assert.equal(f.other.images.length, 0);
  assert.equal(f.changes, 0);
});

test('paste follows existing authentication and size validation without losing note edits', () => {
  const f = fixture();
  f.state.authenticated = false;
  f.controls.pasteJournalImages(clipboard({ images: [file()] }), f.note);
  assert.equal(f.jobs.length, 0);
  assert.equal(f.notices[0][1], true);
  f.state.authenticated = true;
  f.controls.pasteJournalImages(clipboard({ images: [file('too-big.png', 'image/png', 26 * 1024 * 1024)] }), f.note);
  assert.equal(f.jobs.length, 0);
  assert.match(f.notices[1][0], /超过 25MiB/);
  assert.equal(f.note.body.zh, '正在输入的正文');
});
