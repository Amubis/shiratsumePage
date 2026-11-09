const marker = '<script id="owner-profile-data" type="application/json">null</script>';

/** Keep the public owner configuration available even if its JSON request fails. */
export function embedOwnerProfileData(html, profile) {
  if (!profile || profile.schemaVersion !== 1) throw new TypeError('An owner profile with schemaVersion 1 is required.');
  if (!html.includes(marker)) throw new Error('The owner profile data placeholder is missing.');
  const json = JSON.stringify(profile).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return html.replace(marker, () => `<script id="owner-profile-data" type="application/json">${json}</script>`);
}
