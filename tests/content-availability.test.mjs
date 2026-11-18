import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContentAvailability } from '../src/content-availability.js';

function fixture() {
  const classes = new Set(), listeners = new Map(), keys = new Map();
  const title = {}, description = {}, retry = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, focus() { doc.activeElement = this; }, blur() { doc.activeElement = null; } };
  const main = { inert: false }, navigation = { inert: true };
  const panel = { attributes: {}, querySelector(name) { return name.endsWith('title') ? title : name.endsWith('description') ? description : retry; }, setAttribute(key,value) { this.attributes[key] = value; } };
  const doc = { activeElement: null, addEventListener(type,fn) { keys.set(type, fn); }, removeEventListener(type) { keys.delete(type); } };
  const root = { ownerDocument: doc, dataset: {}, classList: { toggle(key,on) { if(on)classes.add(key);else classes.delete(key); }, remove(key) { classes.delete(key); } }, querySelector: () => panel, querySelectorAll: () => [main,navigation] };
  let locale = 'zh', retried = 0;
  const api = createContentAvailability({root,getLanguage:()=>locale,onRetry(){retried++;}});
  return { api,root,main,navigation,panel,title,description,retry,listeners,keys,get retried(){return retried;},set locale(value){locale=value;} };
}

test('unverified content is locked and failure offers an explicit retry instead of exposing defaults', () => {
  const f=fixture();
  assert.equal(f.root.dataset.contentConnection,'loading'); assert.equal(f.main.inert,true);assert.equal(f.retry.hidden,true);
  f.api.error();assert.equal(f.root.dataset.contentConnection,'offline');assert.match(f.title.textContent,/暂时无法/);assert.match(f.description.textContent,/重试/);assert.equal(f.retry.hidden,false);
  f.listeners.get('click')();assert.equal(f.retried,1);
  let stopped=false;f.keys.get('keydown')({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
  f.api.loading();f.listeners.get('click')();assert.equal(f.retried,1);
  f.api.ready();assert.equal(f.root.dataset.contentConnection,'online');assert.equal(f.main.inert,false);assert.equal(f.navigation.inert,true);assert.equal(f.panel.attributes['aria-hidden'],'true');
  f.api.error();assert.equal(f.main.inert,true);f.api.destroy();assert.equal(f.main.inert,false);assert.equal(f.keys.size,0);
});

test('Japanese state labels and intentional local/editor previews remain available', () => {
  const f=fixture();f.locale='ja';f.api.error();assert.match(f.description.textContent,/再試行/);
  f.api.ready('preview');assert.equal(f.root.dataset.contentConnection,'preview');assert.equal(f.main.inert,false);
  f.api.ready('static');assert.equal(f.root.dataset.contentConnection,'static');f.api.destroy();
});

test('first paint and startup gate keep seeded pages hidden until verified content arrives',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<body[^>]+data-content-connection="loading"/);
  assert.match(html,/body\[data-content-connection="offline"\].*visibility: hidden !important/s);
  assert.match(html,/!\['loading','offline'\]\.includes\(document\.body\?\.dataset\.contentConnection\)/);
  const main=await readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/if\(!connected\)\{contentAvailability\.error\(\);return;\}/);
  assert.match(main,/contentAvailability\.ready\(\);\s*beginPublicScene\(\)/);
  assert.doesNotMatch(main,/onCached\(content\)/);
});
