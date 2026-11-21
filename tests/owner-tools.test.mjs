import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginOwnerApi, createOwnerApi } from '../src/owner-tools.js';

test('owner sessions are enabled only on their exact site origin and never in draft preview frames', () => {
  const worker='https://shiratsume-page.amubis-shiratsume.workers.dev';
  assert.equal(sameOriginOwnerApi({apiBaseUrl:worker},worker+'/?owner=1'),worker);
  assert.equal(sameOriginOwnerApi({apiBaseUrl:worker},'https://amubis.github.io/shiratsumePage/'),null);
  assert.equal(sameOriginOwnerApi({apiBaseUrl:'https://user:password@example.test'},'https://example.test'),null);
  assert.equal(sameOriginOwnerApi({},worker+'/?editor-preview=private'),null);
  assert.equal(sameOriginOwnerApi({},'http://127.0.0.1:4352/'),'http://127.0.0.1:4352');
});

test('inline saves send only the selected public fields with same-origin cookies and CSRF', async () => {
  const requests=[];
  const api=createOwnerApi({baseUrl:'https://site.example',fetchImpl:async(url,options)=>{
    requests.push({url,options});return {ok:true,status:200,async json(){return {content:{media:[]}};}};
  }});
  await api.login('Amubis',' exact password ');
  await api.save({targetType:'photo',targetId:'photo-a',locale:'zh',patch:{caption:'新说明'}},'csrf-token');
  assert.deepEqual(JSON.parse(requests[0].options.body),{username:'Amubis',password:' exact password '});
  assert.equal(requests[0].options.headers['X-Garden-CSRF'],undefined);
  assert.equal(requests[1].url,'https://site.example/api/admin/live-content');
  assert.equal(requests[1].options.method,'PATCH');
  assert.equal(requests[1].options.credentials,'same-origin');
  assert.equal(requests[1].options.mode,'same-origin');
  assert.equal(requests[1].options.headers['X-Garden-CSRF'],'csrf-token');
  assert.deepEqual(JSON.parse(requests[1].options.body),{targetType:'photo',targetId:'photo-a',locale:'zh',patch:{caption:'新说明'}});
  assert.ok(!requests.some(request=>request.url.includes('/publish')),'inline editor never publishes a whole draft');
});

class OwnerNode {
  constructor(tag, doc) {
    this.localName=tag;this.ownerDocument=doc;this.parentElement=null;this.children=[];this.attributes=new Map();this.listeners=new Map();this.dataset={};this.hidden=false;this._classes=new Set();this._text='';this._html='';
    this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n),toggle:(n,force)=>{const enabled=force===undefined?!this._classes.has(n):Boolean(force);enabled?this._classes.add(n):this._classes.delete(n);return enabled;}};
  }
  get className(){return [...this._classes].join(' ');}set className(value){this._classes=new Set(String(value).split(/\s+/).filter(Boolean));}
  get textContent(){return this._text+this._html.replace(/<[^>]*>/g,'')+this.children.map(n=>n.textContent).join('');}set textContent(value){this.replaceChildren();this._text=String(value);}
  get innerHTML(){return this._html;}set innerHTML(value){this.replaceChildren();this._html=String(value);}
  get isConnected(){return this.localName==='document'||Boolean(this.parentElement?.isConnected);}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
  getAttribute(name){return this.attributes.get(name)??null;}removeAttribute(name){this.attributes.delete(name);}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.children.push(n);}}
  replaceChildren(...nodes){this.children.forEach(n=>{n.parentElement=null;});this.children=[];this._text='';this._html='';this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  matches(selector){return selector.split(',').some(part=>{const s=part.trim();if(!s)return false;const tag=s.match(/^[a-z][\w-]*/i)?.[0];if(tag&&this.localName!==tag)return false;const id=s.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;for(const [,name]of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(name))return false;for(const [,name,value]of s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(this.getAttribute(name)===null||(value!==undefined&&this.getAttribute(name)!==value))return false;return true;});}
  querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}querySelector(s){return this.querySelectorAll(s)[0]||null;}
  closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);}removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  async emit(type,fields={}){const e={type,target:this,prevented:false,preventDefault(){this.prevented=true;},...fields};for(let n=this;n;n=n.parentElement)for(const fn of [...(n.listeners.get(type)||[])])await fn(e);return e;}
  focus(){this.ownerDocument.activeElement=this;}blur(){this.ownerDocument.activeElement=this.ownerDocument.body;}showModal(){this.open=true;}close(){this.open=false;}
}

async function ownerFixture(t,{authenticated=false,crossOrigin=false,entryHidden=false,caption={zh:'说明'}}={}) {
  const {createOwnerTools}=await import('../src/owner-tools.js');
  const doc=new OwnerNode('document');doc.ownerDocument=doc;doc.createElement=tag=>new OwnerNode(tag,doc);const win=new OwnerNode('window',doc);win.location={href:crossOrigin?'https://pages.example/site/':'https://site.example/'};win.matchMedia=()=>({matches:true});doc.defaultView=win;doc.body=doc.createElement('body');doc.append(doc.body);doc.activeElement=doc.body;
  const profile=doc.createElement('div');profile.className='owner-profile';const card=doc.createElement('section');card.className='owner-card';const entry=doc.createElement('a');entry.className='owner-admin-link';entry.hidden=entryHidden;entry.href='https://site.example/admin/';entry.innerHTML='<svg aria-hidden="true"></svg>';card.append(entry);profile.append(card);doc.body.append(profile);
  const photo=doc.createElement('dialog');photo.className='album-player';photo.setAttribute('data-photo-id','photo-a');const stage=doc.createElement('div');stage.className='album-player-stage';photo.append(stage);const note=doc.createElement('article');note.className='personal-journal-post';note.setAttribute('data-journal-id','note-a');doc.body.append(photo,note);
  let loggedIn=authenticated;const calls=[],sessions=[],published=[];
  let content={owner:{name:'Amubis'},media:[{id:'photo-a',caption}],journal:[{id:'note-a',title:'旧标题',body:{zh:'正文'}}]};
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/login'))loggedIn=true;
    if(url.endsWith('/logout'))loggedIn=false;
    if(url.endsWith('/live-content')){
      const {targetType,targetId,patch}=JSON.parse(options.body);
      const collection=targetType==='photo'?'media':'journal';
      content={...content,[collection]:content[collection].map(item=>item.id===targetId?{...item,...patch}:item)};
      return {ok:true,status:200,json:async()=>({content})};
    }
    return {ok:true,status:200,json:async()=>loggedIn?{authenticated:true,csrfToken:'fixture-csrf'}:{authenticated:false}};
  };
  let language='zh';const api=createOwnerTools({root:doc.body,pageURL:win.location.href,getContent:()=>content,getLanguage:()=>language,onPublished:next=>{content=next;published.push(next);},onSession:s=>sessions.push(s),fetchImpl});
  t.after(()=>api.destroy());api.setRuntime({apiBaseUrl:'https://site.example',adminUrl:'https://site.example/admin/'});await api.refresh();
  const find=s=>doc.querySelector(s);return {api,doc,entry,card,note,photo,find,calls,sessions,published,setLanguage(value){language=value;api.setLanguage(value);}};
}

test('photo editing switches visible languages, retains both changes and saves without closing the player',async t=>{
  const f=await ownerFixture(t,{authenticated:true,caption:{zh:'中文原文',ja:'日本語の原文'}});
  f.photo.showModal();await f.find('.owner-photo-edit').emit('click');
  const chinese=f.find('.owner-tools-caption-zh'),japanese=f.find('.owner-tools-caption-ja');
  assert.equal(f.find('.owner-tools-fields').querySelectorAll('textarea').length,2);
  assert.equal(chinese.value,'中文原文');assert.equal(japanese.value,'日本語の原文');
  assert.equal(chinese.getAttribute('lang'),'zh-CN');assert.equal(japanese.getAttribute('lang'),'ja');
  assert.equal(f.find('#owner-tools-panel-zh').hidden,false);assert.equal(f.find('#owner-tools-panel-ja').hidden,true);
  const chineseTab=f.find('.owner-tools-language-zh'),japaneseTab=f.find('.owner-tools-language-ja');
  assert.equal(chineseTab.getAttribute('aria-selected'),'true');assert.equal(japaneseTab.tabIndex,-1);
  chinese.value='新的中文说明';
  const key=await chineseTab.emit('keydown',{key:'ArrowRight'});
  assert.equal(key.prevented,true);assert.equal(f.doc.activeElement,japaneseTab);
  assert.equal(japaneseTab.getAttribute('aria-selected'),'true');assert.equal(chineseTab.tabIndex,-1);
  assert.equal(f.find('#owner-tools-panel-zh').hidden,true);assert.equal(f.find('#owner-tools-panel-ja').hidden,false);
  japanese.value='新しい日本語の説明';
  await chineseTab.emit('click');
  assert.equal(chinese.value,'新的中文说明');assert.equal(japanese.value,'新しい日本語の説明');
  await f.find('.owner-tools-form').emit('submit');
  const save=f.calls.find(call=>call.url.endsWith('/live-content'));
  assert.deepEqual(JSON.parse(save.options.body),{targetType:'photo',targetId:'photo-a',patch:{caption:{zh:'新的中文说明',ja:'新しい日本語の説明'}}});
  assert.equal(save.options.headers['X-Garden-CSRF'],'fixture-csrf');assert.equal(f.published.length,1);
  assert.equal(f.photo.open,true);assert.equal(f.photo.getAttribute('data-photo-id'),'photo-a');assert.equal(f.find('.owner-tools-dialog').open,false);
  f.setLanguage('ja');await f.find('.owner-photo-edit').emit('click');
  assert.equal(f.find('.owner-tools-caption-zh').value,'新的中文说明');assert.equal(f.find('.owner-tools-caption-ja').value,'新しい日本語の説明');
  assert.equal(f.find('#owner-tools-panel-zh').hidden,true);assert.equal(f.find('#owner-tools-panel-ja').hidden,false);
});

test('photo language fields do not copy fallback text into a missing translation',async t=>{
  const f=await ownerFixture(t,{authenticated:true,caption:{zh:'只有中文'}});f.setLanguage('ja');await f.find('.owner-photo-edit').emit('click');
  assert.equal(f.find('.owner-tools-caption-zh').value,'只有中文');assert.equal(f.find('.owner-tools-caption-ja').value,'');
  assert.equal(f.doc.activeElement,f.find('.owner-tools-caption-ja'));
});

test('a legacy unlocalized photo caption enters only the Chinese field',async t=>{
  const f=await ownerFixture(t,{authenticated:true,caption:'旧照片原文'});await f.find('.owner-photo-edit').emit('click');
  assert.equal(f.find('.owner-tools-caption-zh').value,'旧照片原文');assert.equal(f.find('.owner-tools-caption-ja').value,'');
});

test('journal editing stages both languages and sends only edited title and body locales',async t=>{
  const f=await ownerFixture(t,{authenticated:true});
  f.setLanguage('ja');await f.find('.owner-note-edit').emit('click');
  assert.equal(f.find('.owner-tools-title-ja').value,'');assert.equal(f.find('.owner-tools-body-ja').value,'');
  f.find('.owner-tools-title-ja').value='新しい題名';
  await f.find('.owner-tools-language-zh').emit('click');
  assert.equal(f.find('.owner-tools-title-zh').value,'旧标题');assert.equal(f.find('.owner-tools-body-zh').value,'正文');
  f.find('.owner-tools-body-zh').value='新的正文';
  await f.find('.owner-tools-form').emit('submit');
  const saves=f.calls.filter(call=>call.url.endsWith('/live-content'));
  assert.equal(saves.length,1);
  assert.deepEqual(JSON.parse(saves[0].options.body),{targetType:'journal',targetId:'note-a',patch:{title:{ja:'新しい題名'},body:{zh:'新的正文'}}});
  assert.equal(f.find('.owner-tools-dialog').open,false);
});

test('the avatar clover logs in and then presents only management and logout in its own card',async t=>{
  const f=await ownerFixture(t);
  assert.equal(f.entry.hidden,false);assert.equal(f.entry.getAttribute('aria-label'),'站长登录');assert.equal(f.entry.getAttribute('role'),'button');assert.equal(f.find('.owner-tools-bar'),null);assert.equal(f.find('.owner-tools-toggle'),null);
  const space=await f.entry.emit('keydown',{key:' '});assert.equal(space.prevented,true);assert.equal(f.find('.owner-tools-dialog').open,true);await f.find('.owner-tools-close').emit('click');
  const click=await f.entry.emit('click');assert.equal(click.prevented,true);assert.equal(f.find('.owner-tools-dialog').open,true);
  f.find('.owner-tools-password').value='local-fixture';await f.find('.owner-tools-form').emit('submit');
  assert.equal(f.api.session.authenticated,true);assert.equal(f.entry.hidden,true);assert.equal(f.find('.owner-tools-dialog').open,false);
  const actions=f.find('.owner-profile-actions');assert.equal(actions.parentElement,f.card);assert.equal(actions.hidden,false);assert.equal(f.find('.owner-tools-manage').textContent,'管理页');assert.equal(f.find('.owner-tools-logout').textContent,'退出登录');
  await f.find('.owner-tools-logout').emit('click');assert.equal(f.entry.hidden,false);assert.equal(actions.hidden,true);assert.equal(f.api.session.authenticated,false);assert.equal(f.sessions.at(-1).authenticated,false);
});

test('authenticated editors use icon-only entry points without a visibility toggle',async t=>{
  const f=await ownerFixture(t,{authenticated:true});
  for(const [selector,label]of [['.owner-photo-edit','编辑照片说明'],['.owner-note-edit','编辑碎碎念']]){const edit=f.find(selector);assert.equal(edit.hidden,false);assert.equal(edit.textContent,'');assert.match(edit.innerHTML,/<svg\b/);assert.equal(edit.getAttribute('aria-label'),label);assert.equal(edit.title,label);}
  assert.equal(f.note.classList.contains('owner-editable-note'),true);
  f.setLanguage('ja');assert.equal(f.find('.owner-tools-manage').textContent,'管理ページ');assert.equal(f.find('.owner-tools-logout').textContent,'ログアウト');
  await f.find('.owner-tools-logout').emit('click');assert.equal(f.find('.owner-photo-edit').hidden,true);assert.equal(f.find('.owner-note-edit').hidden,true);assert.equal(f.note.classList.contains('owner-editable-note'),false);
});

test('a cross-origin browsing page keeps the avatar link and never attempts owner authentication',async t=>{
  const f=await ownerFixture(t,{crossOrigin:true});assert.equal(f.calls.length,0);const click=await f.entry.emit('click');assert.equal(click.prevented,false);assert.equal(f.find('.owner-tools-dialog').open,undefined);assert.equal(f.entry.hidden,false);assert.equal(f.doc.querySelectorAll('.owner-inline-edit').filter(node=>!node.hidden).length,0);
});

 test('without same-origin owner authentication an intentionally hidden entry stays hidden',async t=>{
  const f=await ownerFixture(t,{crossOrigin:true,entryHidden:true});f.setLanguage('ja');assert.equal(f.entry.hidden,true);assert.equal(f.card.classList.contains('has-owner-session'),false);assert.equal(f.calls.length,0);
});
