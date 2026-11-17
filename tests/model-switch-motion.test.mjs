import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_SWITCH_TIMING, modelSpacePose, modelSwitchRestPose, modelSwitchJellyPose, createModelSwitchMotion } from '../src/model-switch-motion.js';

class Node {
  constructor(doc) {
    this.ownerDocument = doc; this.children = []; this.attributes = new Map(); this.events = new Map(); this.dataset = {};
    const properties = new Map();
    this.style = { setProperty: (key,value) => properties.set(key,value), removeProperty:key=>properties.delete(key), getPropertyValue:key=>properties.get(key) || '', clipPath:'', webkitClipPath:'' };
    const names = new Set(); this.classList = { add:name=>names.add(name), remove:name=>names.delete(name), contains:name=>names.has(name) };
  }
  append(...nodes) { nodes.forEach(node=>{node.parentElement=this;this.children.push(node);}); }
  remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this); }
  setAttribute(key,value) { this.attributes.set(key,String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener(event,handler) { if(!this.events.has(event))this.events.set(event,new Set());this.events.get(event).add(handler); }
  removeEventListener(event,handler) { this.events.get(event)?.delete(handler); }
  emit(event,fields={}) { for(const handler of this.events.get(event)||[])handler({type:event,...fields}); }
  querySelector(selector) { return selector==='.model-choice-color'?this.color:null; }
}

function fixture({reduced=false,themes,onFrame}={}) {
  let time=0,serial=0,notify=()=>{},disconnected=false;const frames=new Map();
  const doc=new Node();doc.ownerDocument=doc;doc.hidden=false;doc.body=new Node(doc);doc.createElementNS=()=>new Node(doc);
  const win=new Node(doc);doc.defaultView=win;win.performance={now:()=>time};
  win.requestAnimationFrame=callback=>{frames.set(++serial,callback);return serial;};win.cancelAnimationFrame=id=>frames.delete(id);
  win.MutationObserver=class { constructor(callback){notify=callback;} observe(){} disconnect(){disconnected=true;} };
  const root=new Node(doc);root.dataset.selection='left';const color=new Node(doc);color.style.clipPath='inset(8% 52% 8% 2% round 8px)';root.color=color;root.append(color);doc.body.append(root);
  const controller=createModelSwitchMotion({root,reducedMotion:()=>reduced,themes,onFrame});
  const flush=stamp=>{const work=[...frames.values()];frames.clear();work.forEach(callback=>callback(stamp));};
  return {doc,win,root,color,controller,frames,notify:()=>notify(),get disconnected(){return disconnected;},setReduced:value=>{reduced=value;},block(delta){time+=delta;},frameAt(stamp){flush(stamp);},step(delta){time+=delta;flush(time);}};
}

test('the rounded slider overruns in either direction, compresses at impact and settles without drift',()=>{
  for(const selection of ['right','left']){
    const from=modelSwitchRestPose(selection==='right'?'left':'right'),target=modelSwitchRestPose(selection);
    assert.deepEqual(modelSwitchJellyPose(0,{from,selection}),from);
    const impact=modelSwitchJellyPose(.53,{from,selection});
    assert.ok(selection==='right'?impact.center>target.center:impact.center<target.center);
    assert.ok(impact.width<target.width&&impact.height>target.height);
    assert.ok(impact.shellX>1&&impact.shellY<1);
    const rebound=modelSwitchJellyPose(.74,{from,selection});
    assert.ok(selection==='right'?rebound.center<target.center:rebound.center>target.center);
    assert.ok(rebound.shellX<1&&rebound.shellY>1);
    assert.deepEqual(modelSwitchJellyPose(1,{from,selection}),target);
  }
});

test('initial rendering is static and every animated frame reuses one clip and matching rounded rim',t=>{
  const f=fixture();t.after(()=>f.controller.destroy());
  assert.equal(f.frames.size,0);assert.equal(f.controller.animating,false);
  const url=f.color.style.clipPath;
  assert.match(url,/^url\("#model-color-window-\d+"\)$/);assert.ok(!url.includes('data:'));
  const definitions=f.doc.body.children[1],clip=definitions.children[0].children[0],mask=clip.children[0],rim=f.root.children[1].children[0];
  assert.equal(clip.getAttribute('clipPathUnits'),'objectBoundingBox');assert.equal(mask.getAttribute('rx'),'0.052');assert.equal(mask.getAttribute('ry'),'0.14');
  f.root.dataset.selection='right';f.notify();assert.equal(f.frames.size,1);
  f.step(MODEL_SWITCH_TIMING.slide*.53);
  assert.ok(f.controller.pose.center>.75);assert.equal(f.color.style.clipPath,url);assert.equal(f.doc.body.children[1],definitions);
  for(const key of ['x','y','width','height','rx','ry'])assert.equal(mask.getAttribute(key),rim.getAttribute(key),key);
  f.step(MODEL_SWITCH_TIMING.duration-MODEL_SWITCH_TIMING.slide*.53);
  assert.equal(f.frames.size,0);assert.deepEqual(f.controller.pose,modelSwitchRestPose('right'));assert.equal(f.color.style.clipPath,url);
  assert.equal(f.root.style.getPropertyValue('--model-shell-x'),'1.00000');
});

test('a rapid opposite selection continues from the visible pose and leaves only one animation loop',t=>{
  const f=fixture();t.after(()=>f.controller.destroy());
  f.controller.setSelection('right');f.step(280);const visible=f.controller.pose;
  assert.equal(f.controller.setSelection('left'),true);assert.deepEqual(f.controller.pose,visible);assert.equal(f.frames.size,1);
  f.step(0);assert.deepEqual(f.controller.pose,visible);
  f.step(MODEL_SWITCH_TIMING.duration);assert.deepEqual(f.controller.pose,modelSwitchRestPose('left'));assert.equal(f.frames.size,0);
  assert.equal(f.controller.setSelection('left'),false);assert.equal(f.frames.size,0);
});

test('both borders adopt the requested model accent before page theme changes, including reversal',t=>{
  const f=fixture({themes:{left:'#123456',right:'#abcdef'}});t.after(()=>f.controller.destroy());
  assert.equal(f.root.style.getPropertyValue('--model-accent'),'#123456');
  assert.equal(f.root.classList.contains('is-model-switch-still'),true,'the first accent does not animate');
  f.controller.setSelection('right');assert.equal(f.root.style.getPropertyValue('--model-accent'),'#abcdef');
  assert.equal(f.root.classList.contains('is-model-switch-still'),false,'CSS can interpolate the border and matching rim');
  f.step(100);f.controller.setSelection('left');assert.equal(f.root.style.getPropertyValue('--model-accent'),'#123456');
  f.setReduced(true);f.controller.setSelection('right');assert.equal(f.root.style.getPropertyValue('--model-accent'),'#abcdef');
  assert.equal(f.root.classList.contains('is-model-switch-still'),true,'reduced motion removes color interpolation too');
  f.controller.destroy();assert.equal(f.root.style.getPropertyValue('--model-accent'),'');
});

test('reduced motion, page hiding and resize settle a complete readable selection',t=>{
  const f=fixture({reduced:true});t.after(()=>f.controller.destroy());
  f.controller.setSelection('right');assert.deepEqual(f.controller.pose,modelSwitchRestPose('right'));assert.equal(f.frames.size,0);
  f.setReduced(false);f.controller.setSelection('left');f.step(150);assert.equal(f.controller.animating,true);
  f.doc.hidden=true;f.doc.emit('visibilitychange');assert.deepEqual(f.controller.pose,modelSwitchRestPose('left'));assert.equal(f.frames.size,0);
  f.doc.hidden=false;f.controller.setSelection('right');f.step(150);f.win.emit('resize');assert.deepEqual(f.controller.pose,modelSwitchRestPose('right'));assert.equal(f.frames.size,0);
  f.controller.setSelection('left');f.step(150);f.setReduced(true);f.controller.refresh();assert.deepEqual(f.controller.pose,modelSwitchRestPose('left'));assert.equal(f.frames.size,0);
});

test('destroy removes live geometry, restores fallback clipping and does not retain frame callbacks',()=>{
  const f=fixture(),original='inset(8% 52% 8% 2% round 8px)';f.controller.setSelection('right');f.step(50);f.controller.destroy();
  assert.equal(f.frames.size,0);assert.equal(f.doc.body.children.length,1);assert.equal(f.root.children.length,1);assert.equal(f.disconnected,true);
  assert.equal(f.color.style.clipPath,original);assert.equal(f.color.style.webkitClipPath,'');assert.equal(f.root.classList.contains('has-model-switch-motion'),false);
  assert.equal(f.root.style.getPropertyValue('--model-shell-x'),'');assert.equal(f.controller.setSelection('left'),false);
  f.controller.destroy();assert.equal(f.doc.body.children.length,1);
});

test('page handoff receives the very same continuous travel as the visible slider',t=>{
 const reports=[],f=fixture({onFrame:frame=>reports.push(frame)});t.after(()=>f.controller.destroy());
 const firstQuarter=MODEL_SWITCH_TIMING.slide*.25;
 f.controller.setSelection('right');f.step(firstQuarter);
 assert.equal(reports.at(-1).progress,firstQuarter/MODEL_SWITCH_TIMING.duration);
 assert.ok(Math.abs(reports.at(-1).travel-(f.controller.pose.center-.25)/.5)<1e-8);
 f.step(MODEL_SWITCH_TIMING.duration-firstQuarter);assert.equal(reports.at(-1).progress,1);assert.equal(reports.at(-1).travel,1);
 // The exported pose is smooth through former keyframe boundaries.
 for(const p of [.29,.53,.74,.9]){
   const a=modelSwitchJellyPose(p-.0001),b=modelSwitchJellyPose(p+.0001);
   assert.ok(Math.abs(b.center-a.center)>1e-7,'intermediate boundaries do not impose pauses');
   assert.ok(Math.abs(b.center-a.center)<.001,'the path does not jump');
 }
});


test('pointer intent enlarges only the approached image without moving the selected window',t=>{
 const f=fixture();t.after(()=>f.controller.destroy());
 f.root.getBoundingClientRect=()=>({left:100,width:200});
 const rest=f.controller.pose,url=f.color.style.clipPath;
 f.root.emit('pointermove',{clientX:110,pointerType:'mouse'});assert.equal(f.root.dataset.hoverSide,'left');
 f.root.emit('pointermove',{clientX:290,pointerType:'mouse'});assert.equal(f.root.dataset.hoverSide,'right');
 assert.deepEqual(f.controller.pose,rest);assert.equal(f.color.style.clipPath,url);assert.equal(f.frames.size,0);
 f.root.emit('pointerleave');assert.equal(f.root.dataset.hoverSide,undefined);
 f.root.emit('pointermove',{clientX:110,pointerType:'touch'});assert.equal(f.root.dataset.hoverSide,undefined);
 f.root.emit('pointermove',{clientX:110,pointerType:'mouse'});f.doc.hidden=true;f.doc.emit('visibilitychange');assert.equal(f.root.dataset.hoverSide,undefined);
});

test('space transition has a fully covered loading interval before content is revealed',()=>{
 const t=MODEL_SWITCH_TIMING,at=milliseconds=>modelSpacePose(milliseconds/t.duration);
 assert.equal(t.cover+t.hold+t.reveal,t.duration);
 assert.ok(t.duration>=1800&&t.hold>=500,'the new space has a deliberate readable dwell');
 assert.deepEqual(at(0),{stage:'enter',position:-1,loaderAlpha:0,covered:false});
 const arriving=at(t.cover*.8);assert.equal(arriving.stage,'enter');assert.ok(arriving.position<0&&arriving.loaderAlpha>0&&!arriving.covered);
 for(const time of [t.cover,t.cover+t.hold*.5,t.cover+t.hold-1])assert.deepEqual(at(time),{stage:'loading',position:0,loaderAlpha:1,covered:true});
 const reveal=at(t.cover+t.hold+t.reveal*.4);assert.equal(reveal.stage,'reveal');assert.ok(reveal.position>0&&reveal.position<1&&reveal.loaderAlpha<1&&reveal.covered);
 assert.deepEqual(at(t.duration),{stage:'complete',position:1,loaderAlpha:0,covered:true});
});

test('the page cover and reveal accelerate and decelerate instead of moving uniformly',()=>{
 const t=MODEL_SWITCH_TIMING,at=milliseconds=>modelSpacePose(milliseconds/t.duration);
 assert.ok(at(t.cover*.2).position<-.8);
 assert.ok(at(t.cover*.8).position>-.2);
 const revealStarts=t.cover+t.hold;
 assert.ok(at(revealStarts+t.reveal*.2).position<.2);
 assert.ok(at(revealStarts+t.reveal*.8).position>.8);
 for(let i=1;i<=100;i++)assert.ok(modelSpacePose(i/100).position>=modelSpacePose((i-1)/100).position);
});

test('the selected slider settles while the single clock keeps its loading hold alive',t=>{
 const reports=[],f=fixture({onFrame:value=>reports.push(value)});t.after(()=>f.controller.destroy());
 f.controller.setSelection('right');f.step(MODEL_SWITCH_TIMING.cover);
 assert.deepEqual(f.controller.pose,modelSwitchRestPose('right'));
 assert.equal(modelSpacePose(reports.at(-1).progress).stage,'loading');
 assert.equal(f.controller.animating,true);
 f.step(MODEL_SWITCH_TIMING.hold*.5);
 assert.deepEqual(f.controller.pose,modelSwitchRestPose('right'));
 assert.equal(modelSpacePose(reports.at(-1).progress).stage,'loading');
 f.doc.hidden=true;f.doc.emit('visibilitychange');
 assert.equal(f.frames.size,0);assert.equal(reports.at(-1).progress,1);
 assert.equal(modelSpacePose(reports.at(-1).progress).stage,'complete');
});

test('measured synchronous covered work cannot consume the visible loading hold',t=>{
 let f,blocked=false;const reports=[];
 f=fixture({onFrame:value=>{
   reports.push(value);
   if(!blocked&&value.progress>=MODEL_SWITCH_TIMING.cover/MODEL_SWITCH_TIMING.duration&&value.progress<1){blocked=true;f.block(625);}
 }});t.after(()=>f.controller.destroy());
 f.controller.setSelection('right');f.step(MODEL_SWITCH_TIMING.cover);
 assert.equal(f.controller.coveredWorkMs,625);assert.equal(f.root.dataset.modelCoveredWorkMs,'625');
 const heldProgress=reports.at(-1).progress;
 // A slightly stale RAF stamp cannot move the compensated clock backward.
 f.frameAt(MODEL_SWITCH_TIMING.cover+625-8);
 assert.equal(reports.at(-1).progress,heldProgress);
 f.step(MODEL_SWITCH_TIMING.hold-1);
 assert.equal(modelSpacePose(reports.at(-1).progress).stage,'loading');
 f.step(1);assert.equal(modelSpacePose(reports.at(-1).progress).stage,'reveal');
 assert.equal(f.controller.coveredWorkMs,625,'the first covered callback is measured only once');
 f.step(MODEL_SWITCH_TIMING.reveal);assert.equal(reports.at(-1).progress,1);assert.equal(f.frames.size,0);
 assert.ok(reports.every((value,index)=>!index||value.progress>=reports[index-1].progress));
});

test('normal callbacks retain the 1900ms duration and a new selection resets its metric',t=>{
 const reports=[],f=fixture({onFrame:value=>reports.push(value)});t.after(()=>f.controller.destroy());
 assert.equal(f.controller.coveredWorkMs,0);assert.equal(f.root.dataset.modelCoveredWorkMs,'0');
 f.controller.setSelection('right');f.step(MODEL_SWITCH_TIMING.cover);f.step(MODEL_SWITCH_TIMING.hold);f.step(MODEL_SWITCH_TIMING.reveal);
 assert.equal(reports.at(-1).progress,1);assert.equal(f.frames.size,0);assert.equal(f.controller.coveredWorkMs,0);
 f.controller.setSelection('left');assert.equal(f.root.dataset.modelCoveredWorkMs,'0');
 f.win.emit('resize');assert.equal(reports.at(-1).progress,1);assert.equal(f.frames.size,0);
});

test('a covered callback that restarts selection cannot charge its work to the new animation',t=>{
 let f,restarted=false;const reports=[];
 f=fixture({onFrame:value=>{
   reports.push(value);
   if(!restarted&&value.progress>=MODEL_SWITCH_TIMING.cover/MODEL_SWITCH_TIMING.duration&&value.progress<1){
     restarted=true;f.block(180);f.controller.setSelection('left');
   }
 }});t.after(()=>f.controller.destroy());
 f.controller.setSelection('right');f.step(MODEL_SWITCH_TIMING.cover);
 assert.equal(reports.at(-1).selection,'left');assert.equal(reports.at(-1).progress,0);
 assert.equal(f.controller.coveredWorkMs,0);assert.equal(f.root.dataset.modelCoveredWorkMs,'0');assert.equal(f.frames.size,1);
 f.step(MODEL_SWITCH_TIMING.cover);
 assert.equal(modelSpacePose(reports.at(-1).progress).stage,'loading');assert.equal(f.controller.coveredWorkMs,0);
 f.step(MODEL_SWITCH_TIMING.hold+MODEL_SWITCH_TIMING.reveal);
 assert.equal(reports.at(-1).progress,1);assert.equal(f.frames.size,0);assert.deepEqual(f.controller.pose,modelSwitchRestPose('left'));
});
