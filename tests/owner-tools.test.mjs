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
