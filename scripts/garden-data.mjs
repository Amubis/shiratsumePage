import { publicGardenContent } from '../src/garden-content.js';

/** Never embed drafts, private original keys or VRCX metadata in public HTML. */
export function embedGardenData(html, garden) {
  const marker = '<script id="garden-data" type="application/json">null</script>';
  if (!html.includes(marker)) throw new Error('The garden data placeholder is missing.');
  if (garden?.schemaVersion !== 1) throw new TypeError('Garden content schemaVersion 1 is required.');
  const json = JSON.stringify(publicGardenContent(garden)).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return html.replace(marker, () => `<script id="garden-data" type="application/json">${json}</script>`);
}
