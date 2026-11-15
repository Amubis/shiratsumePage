import { normalizeGardenContent, publicGardenContent, resolveGardenMedia, validateGardenContent } from './garden-content.js';

export const FIXED_COPY = Object.freeze({
  zh: Object.freeze({ homeEyebrow: 'A LITTLE LUCK, A LITTLE EVERYDAY.', coordinate: "SHIRATSUME'S LITTLE GARDEN", coordinatePages: '01 — 04', navHomeSubtitle: 'HOME', navHelloSubtitle: 'HELLO', navMomentsSubtitle: 'MOMENTS', navCollectionSubtitle: 'ABOUT', modelReading: 'SHIRATSUME', modelFooter: 'A LITTLE CLOVER, MANY LITTLE SIDES.', modelPage: '01 / 03', primaryModelName: 'しらつめ', videoLabel: '首页视频' }),
  ja: Object.freeze({ homeEyebrow: 'A LITTLE LUCK, A LITTLE EVERYDAY.', coordinate: "SHIRATSUME'S LITTLE GARDEN", coordinatePages: '01 — 04', navHomeSubtitle: 'HOME', navHelloSubtitle: 'HELLO', navMomentsSubtitle: 'MOMENTS', navCollectionSubtitle: 'ABOUT', modelReading: 'SHIRATSUME', modelFooter: 'A LITTLE CLOVER, MANY LITTLE SIDES.', modelPage: '01 / 03', primaryModelName: 'しらつめ', videoLabel: 'ホームの映像' }),
});

export function readGardenData(doc, defaults = {}) {
  try {
    const value = JSON.parse(doc.getElementById('garden-data')?.textContent || 'null');
    if (value?.schemaVersion === 1 && !validateGardenContent(value).length) return normalizeGardenContent(value, defaults);
  } catch { /* A malformed optional payload must not prevent the site opening. */ }
  return normalizeGardenContent(defaults);
}

/** Text supports the two small formatting tags used by the original copy only. */
export function setGardenText(element, value) {
  const doc = element.ownerDocument;
  element.replaceChildren();
  const parents = [element];
  for (const part of String(value ?? '').split(/(<br\s*\/?\s*>|<small>|<\/small>)/gi)) {
    if (/^<br\s*\/?\s*>$/i.test(part)) parents.at(-1).append(doc.createElement('br'));
    else if (/^<small>$/i.test(part)) { const child = doc.createElement('small'); parents.at(-1).append(child); parents.push(child); }
    else if (/^<\/small>$/i.test(part)) { if (parents.length > 1) parents.pop(); }
    else if (part) parents.at(-1).append(doc.createTextNode(part));
  }
}

export function normalizeGardenRuntime(value, pageURL = 'https://garden.invalid/') {
  const allowed = reference => {
    if (typeof reference !== 'string' || !reference.trim()) return '';
    try {
      const url = new URL(reference, pageURL);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  return { schemaVersion: 1, apiBaseUrl: allowed(value?.apiBaseUrl), adminUrl: allowed(value?.adminUrl) };
}

async function getJSON(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Content unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}

/** Remote errors keep the build's public defaults; draft preview never writes. */
export async function loadPublishedGarden({ fetchImpl = globalThis.fetch, pageURL = globalThis.location?.href, defaults = {}, onRuntime = () => {} } = {}) {
  const runtimeURL = new URL('./data/runtime.json', pageURL);
  let runtime = normalizeGardenRuntime({}, pageURL);
  try { runtime = normalizeGardenRuntime(await getJSON(runtimeURL.href, fetchImpl), pageURL); } catch { /* Same-origin local/Worker API is also supported. */ }
  onRuntime(runtime);
  const endpoint = new URL('/api/content', runtime.apiBaseUrl || pageURL);
  try {
    const payload = await getJSON(endpoint.href, fetchImpl);
    if (payload?.schemaVersion !== 1 || validateGardenContent(payload).length) throw new Error('Invalid published content');
    return { content: resolveGardenMedia(normalizeGardenContent(payload, defaults)), runtime, connected: true };
  } catch { return { content: resolveGardenMedia(publicGardenContent(defaults)), runtime, connected: false }; }
}

export function acceptGardenPreview(event, { token, origin, parent, defaults = {} }) {
  if (!token || !parent || event.source !== parent || event.origin !== origin || event.data?.type !== 'garden-preview' || event.data.token !== token) return null;
  const payload = event.data.content;
  if (payload?.schemaVersion !== 1 || validateGardenContent(payload).length) return null;
  return resolveGardenMedia(publicGardenContent(normalizeGardenContent(payload, defaults)));
}
