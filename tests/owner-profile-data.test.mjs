import test from 'node:test';
import assert from 'node:assert/strict';
import { embedOwnerProfileData } from '../scripts/owner-profile-data.mjs';
import { readOwnerProfileData } from '../src/owner-profile.js';

const template = '<head><script id="owner-profile-data" type="application/json">null</script></head>';

test('bundled public owner data survives HTML parsing without becoming executable markup', () => {
  const profile = { schemaVersion: 1, name: 'Amubis', bio: '</script><img src=x onerror=alert(1)> & \u2028\u2029', avatar: './assets/owner-avatar.png', socials: { x: 'https://example.org/?a=1&b=2' } };
  const html = embedOwnerProfileData(template, profile);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.includes('<img'));
  const doc = { getElementById(id) { return id === 'owner-profile-data' ? { textContent: html.match(/application\/json">([\s\S]*)<\/script>/)[1] } : null; } };
  assert.deepEqual(readOwnerProfileData(doc), profile);
});

test('missing, damaged, or unsupported embedded owner data cannot replace a valid profile', () => {
  for (const textContent of ['', 'null', '{bad', '{"schemaVersion":2}', '[]']) {
    assert.equal(readOwnerProfileData({ getElementById() { return { textContent }; } }), null);
  }
  assert.equal(readOwnerProfileData({}), null);
  assert.throws(() => embedOwnerProfileData(template, { schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => embedOwnerProfileData('<head></head>', { schemaVersion: 1 }), /placeholder/);
});
