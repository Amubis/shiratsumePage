import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlbumPageMotion,albumPagePhotoDelay,albumPagePhotoFrames} from '../src/album-page-motion.js';
function fixture(t){
 const handlers=new Map(),attrs=new Map(),animations=[],frames=new Map();let serial=0,reduced=false,active=true,commits=0;
 const target=()=>({addEventListener(k,f){if(!handlers.has(this))handlers.set(this,new Map());handlers.get(this).set(k,f);},removeEventListener(k){handlers.get(this)?.delete(k);}});
 const doc=target(),win=target();doc.defaultView=win;doc.hidden=false;win.getComputedStyle=()=>({transform:'none'});win.requestAnimationFrame=f=>{frames.set(++serial,f);return serial;};win.cancelAnimationFrame=i=>frames.delete(i);
 const photo=()=>({animate(keyframes,options){let resolve,reject;const a={keyframes,options,finished:new Promise((y,n)=>{resolve=y;reject=n;}),finish:()=>resolve(),cancel:()=>reject(new Error('cancel'))};animations.push(a);return a;}});
 let photos=[photo(),photo(),photo()];const root={ownerDocument:doc,getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelectorAll:()=>photos};
 const api=createAlbumPageMotion({root,reducedMotion:()=>reduced,isActive:()=>active});t.after(()=>api.destroy());
 const commit=()=>{commits++;photos=[photo(),photo()];};
 return{api,doc,animations,attrs,frames,commit,get commits(){return commits;},set reduced(v){reduced=v;},hide(){doc.hidden=true;handlers.get(doc).get('visibilitychange')();}};
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('page-turn timing remains bounded and frames peel and stick from the top edge',()=>{
 assert.ok(albumPagePhotoDelay(11,12)<=90);assert.ok(albumPagePhotoDelay(1,12)>0);
 const peel=albumPagePhotoFrames('peel'),stick=albumPagePhotoFrames('stick');
 assert.equal(peel.at(-1).opacity,0);assert.equal(stick[0].opacity,0);assert.equal(stick.at(-1).opacity,1);assert.match(peel.at(-1).transform,/rotateX/);assert.equal(stick[0].transformOrigin,'50% 0%');
});
test('old prints peel before the next DOM commits and new prints stick afterwards',async t=>{
 const f=fixture(t),p=f.api.run(f.commit);assert.equal(f.api.state,'peeling');assert.equal(f.commits,0);
 f.animations.slice().forEach(a=>a.finish());await tick();assert.equal(f.commits,1);assert.equal(f.api.state,'sticking');
 f.animations.slice(3).forEach(a=>a.finish());await tick();assert.equal(await p,true);assert.equal(f.api.state,'idle');assert.equal(f.frames.size,0);
});
test('rapid requests discard stale commits and hidden pages complete only the latest page',async t=>{
 const f=fixture(t),first=f.api.run(f.commit),second=f.api.run(f.commit);assert.equal(await first,false);assert.equal(f.commits,0);
 f.hide();assert.equal(await second,true);assert.equal(f.commits,1);assert.equal(f.api.busy,false);assert.equal(f.frames.size,0);
});
test('reduced motion commits synchronously and explicit cancellation never leaks an old page',async t=>{
 const f=fixture(t);f.reduced=true;assert.equal(await f.api.run(f.commit),true);assert.equal(f.commits,1);assert.equal(f.animations.length,0);
 f.reduced=false;const p=f.api.run(f.commit);f.api.cancel({commitPending:false});assert.equal(await p,false);assert.equal(f.commits,1);
});
test('destroy drops obsolete pending commits and prevents further work',async t=>{
 const f=fixture(t),p=f.api.run(f.commit);f.api.destroy();assert.equal(await p,false);assert.equal(f.commits,0);assert.equal(await f.api.run(f.commit),false);assert.equal(f.frames.size,0);
});
