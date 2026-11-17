import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../admin/app.js', import.meta.url), 'utf8');
const handler = name => {
  const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `execute the actual ${name} control`);
  return match[0];
};
function element(tag, attributes = {}, ...children) {
  const listeners = new Map();
  const result = {
    tag, children: children.flat(Infinity).filter(value => value !== null && value !== undefined),
    checked: false, disabled: false, hidden: false,
    append(...next) { this.children.push(...next); },
    addEventListener(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); },
    emit(type) { for (const callback of listeners.get(type) || []) callback({ target: this }); },
  };
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith('on') && typeof value === 'function') result.addEventListener(key.slice(2), value);
    else result[key] = value;
  }
  return result;
}
const all = root => [root, ...root.children.filter(child => typeof child === 'object').flatMap(all)];
const text = root => root.children.map(child => typeof child === 'object' ? text(child) : child).join('');
const pick = (root, value) => all(root).find(item => item.tag === 'input' && item.value === value);
const click = (root, label) => all(root).find(item => item.tag === 'button' && text(item) === label).emit('click');
function controls(state = {}) {
  return runInNewContext(`${handler('photoModelPicker')}\n${handler('photoBatchEditor')}\n({photoModelPicker,photoBatchEditor})`, {
    state, node: element, button: (label, action) => element('button', { onclick: action }, label),
    changed() {}, render() {}, toast() {},
  });
}

test('photo models support both enum choices, empty selection, and explicit removal of existing unknown tags', () => {
  const changes = [];
  const picker = controls().photoModelPicker(['legacy-custom', 'shiratsume'], tags => changes.push(Array.from(tags)));
  assert.equal(changes.length, 0, 'rendering a photo never rewrites its model tags');
  assert.deepEqual(all(picker).filter(item => item.tag === 'input').map(item => item.value), ['shiratsume', 'milfy']);
  pick(picker, 'milfy').checked = true; pick(picker, 'milfy').emit('change');
  assert.deepEqual(changes.at(-1), ['shiratsume', 'milfy', 'legacy-custom']);
  pick(picker, 'shiratsume').checked = false; pick(picker, 'shiratsume').emit('change');
  pick(picker, 'milfy').checked = false; pick(picker, 'milfy').emit('change');
  assert.deepEqual(changes.at(-1), ['legacy-custom'], 'changing enum choices preserves an existing unknown tag');
  click(picker, '移除其他标签');
  assert.deepEqual(changes.at(-1), [], 'the explicit remove action permits a completely untagged photo');
});

test('bulk model editing distinguishes preserving tags from clearing or replacing the selected photos', () => {
  const state = { content: { media: [
    { id: 'a', modelIds: ['shiratsume', 'legacy-custom'], enabled: false },
    { id: 'b', modelIds: ['milfy'], enabled: true },
    { id: 'unselected', modelIds: ['legacy-other'], enabled: false },
  ] }, selectedPhotos: new Set(['a', 'b']) };
  const editor = controls(state).photoBatchEditor();
  click(editor, '应用填写内容');
  assert.deepEqual(state.content.media.map(item => item.modelIds), [['shiratsume', 'legacy-custom'], ['milfy'], ['legacy-other']]);
  const mode = all(editor).find(item => item.class === 'photo-model-mode').children[0];
  mode.checked = true; mode.emit('change'); click(editor, '应用填写内容');
  assert.deepEqual(state.content.media.map(item => Array.from(item.modelIds)), [[], [], ['legacy-other']], 'explicit model replacement with no selected choices clears tags');
  pick(editor, 'milfy').checked = true; pick(editor, 'milfy').emit('change'); click(editor, '应用填写内容');
  assert.deepEqual(state.content.media.map(item => Array.from(item.modelIds)), [['milfy'], ['milfy'], ['legacy-other']]);
  assert.deepEqual(state.content.media.map(item => item.enabled), [false, true, false], 'tag editing never changes album inclusion');
});
