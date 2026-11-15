import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeGardenContent, validateGardenContent } from '../src/garden-content.js';
import { acceptGardenPreview, loadPublishedGarden, normalizeGardenRuntime, readGardenData, setGardenText } from '../src/garden-runtime.js';
import { embedGardenData } from '../scripts/garden-data.mjs';

const seed=normalizeGardenContent({schemaVersion:1,texts:{site:{zh:{explore:'开始'}}},owner:{name:'Amubis',avatar:'./assets/owner-avatar.png'},media:[{id:'p',url:'./assets/frame-01.jpg'}]});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});

test('a static GitHub project URL preserves its public build content when no server exists',async()=>{
  const requests=[];
  const result=await loadPublishedGarden({pageURL:'https://amubis.github.io/shiratsumePage/?lang=ja#hello',defaults:seed,fetchImpl:async(url,options)=>{
    requests.push([url,options.credentials]);
    return requests.length===1?response({apiBaseUrl:''}):new Response('not found',{status:404});
  }});
  assert.deepEqual(requests,[['https://amubis.github.io/shiratsumePage/data/runtime.json','omit'],['https://amubis.github.io/api/content','omit']]);
  assert.equal(result.connected,false);assert.equal(result.content.texts.site.zh.explore,'开始');assert.equal(result.content.owner.name,'Amubis');
});

test('published remote edits and stable media keys load without a GitHub rebuild',async()=>{
  const requests=[];
  const result=await loadPublishedGarden({pageURL:'https://amubis.github.io/shiratsumePage/',defaults:seed,fetchImpl:async(url,options)=>{
    requests.push(url);assert.equal(options.credentials,'omit');
    return requests.length===1?response({apiBaseUrl:'https://garden.example/',adminUrl:'https://garden.example/admin/'}):response({...seed,settings:{mediaBaseUrl:'https://cdn.example/'},owner:{...seed.owner,bio:'New biography'},media:[{id:'new',url:'media/hash.webp'}]});
  }});
  assert.equal(requests[1],'https://garden.example/api/content');assert.equal(result.connected,true);assert.equal(result.content.owner.bio,'New biography');assert.equal(result.content.media[0].url,'https://cdn.example/media/hash.webp');
  assert.equal(result.runtime.adminUrl,'https://garden.example/admin/');
});

test('invalid or unavailable remote publications fall back without erasing working pages',async()=>{
  for(const payload of [{schemaVersion:2},{...seed,media:[{url:'javascript:alert(1)'}]}]){
    let n=0;
    const result=await loadPublishedGarden({pageURL:'https://garden.example/',defaults:seed,fetchImpl:async()=>response(++n===1?{}:payload)});
    assert.equal(result.connected,false);assert.equal(result.content.media[0].id,'p');
  }
  assert.equal(normalizeGardenRuntime({apiBaseUrl:'javascript:alert(1)',adminUrl:'https://user:pass@example.test/'}).apiBaseUrl,'');
  assert.equal(normalizeGardenRuntime({adminUrl:'https://user:pass@example.test/'}).adminUrl,'');
});

test('draft preview requires the matching parent, same origin and per-editor token',()=>{
  const parent={},origin='https://garden.example',token='random-editor-token';
  const options={parent,origin,token,defaults:seed};
  const event={source:parent,origin,data:{type:'garden-preview',token,content:{...seed,texts:{site:{zh:{explore:'私有预览'}}},media:[{id:'published',url:'media/a.webp',enabled:true},{id:'draft',url:'media/b.webp',enabled:false}]}}};
  const preview=acceptGardenPreview(event,options);assert.equal(preview.texts.site.zh.explore,'私有预览');assert.deepEqual(preview.media.map(x=>x.id),['published']);
  for(const bad of [{...event,source:{}},{...event,origin:'https://other.example'},{...event,data:{...event.data,token:'old-token'}}])assert.equal(acceptGardenPreview(bad,options),null);
  assert.equal(acceptGardenPreview(event,{...options,token:null}),null);
});

test('public HTML safely embeds only publishable content and recovers defaults after malformed JSON',()=>{
  const html=embedGardenData('<script id="garden-data" type="application/json">null</script>',{...seed,owner:{...seed.owner,bio:'</script><img src=x onerror=alert(1)>'},journal:[{id:'private',body:'private draft',published:false}],media:[{id:'p',url:'media/a.webp',originalKey:`private/originals/${'a'.repeat(64)}.png`,metadataSource:{players:['private player']}}]});
  assert.equal((html.match(/<\/script>/g)||[]).length,1);assert.ok(!html.includes('private draft'));assert.ok(!html.includes('private/originals'));assert.ok(!html.includes('private player'));
  const value=html.match(/application\/json">(.*)<\/script>/s)[1];
  assert.equal(readGardenData({getElementById:()=>({textContent:value})},seed).owner.bio,'</script><img src=x onerror=alert(1)>');
  assert.equal(readGardenData({getElementById:()=>({textContent:'{broken'})},seed).owner.name,'Amubis');
});

test('editable copy preserves line breaks and small captions while treating arbitrary HTML as plain text',()=>{
  const doc={createTextNode:value=>({text:value}),createElement:tag=>({tag,children:[],append(child){this.children.push(child);}})};
  const target={ownerDocument:doc,children:[],replaceChildren(){this.children=[];},append(child){this.children.push(child);}};
  setGardenText(target,'Hi<br><small>caption</small><img src=x onerror=alert(1)>');
  assert.deepEqual(target.children,[{text:'Hi'},{tag:'br',children:[],append:target.children[1].append},{tag:'small',children:[{text:'caption'}],append:target.children[2].append},{text:'<img src=x onerror=alert(1)>'}]);
});

test('photo metadata provenance is not mistaken for a capture timestamp during draft save',()=>{
  const payload={...seed,media:[{id:'p',url:'media/photo.webp',takenAt:'2026-11-10T20:14:15',metadataSource:{takenAt:'filename',world:'VRCX',fileModifiedAt:'2026-11-11T20:00:00Z'}}]};
  assert.deepEqual(validateGardenContent(payload),[]);
  assert.equal(normalizeGardenContent(payload).media[0].takenAt,'2026-11-10T20:14:15');
  assert.equal(normalizeGardenContent(payload).media[0].metadataSource.takenAt,'filename');
});

test('the editable seed has valid bilingual copy, unique outfits and an owner profile',async()=>{
  const value=JSON.parse(await readFile(new URL('../data/garden.json',import.meta.url),'utf8'));
  assert.deepEqual(validateGardenContent(value),[]);assert.ok(value.owner.name);assert.ok('bio' in value.owner);
  assert.equal(new Set(value.outfits.map(item=>item.id)).size,value.outfits.length);
  for(const locale of ['zh','ja'])for(const group of ['site','album','outfits','owner','personal','comments','fixed'])assert.equal(typeof value.texts[group][locale],'object');
  assert.equal(typeof value.texts.comments.zh.nickname,'string');
});
