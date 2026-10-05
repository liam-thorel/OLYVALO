// A shared display preference, never an authentication or an authorization token.
const KEY = 'olycity-display-profile';
export function sharedProfileId(doc = globalThis.document) {
  try {
    const value = doc?.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(KEY+'='));
    const id = value ? decodeURIComponent(value.slice(KEY.length+1)) : '';
    return /^[a-z0-9-]{1,48}$/.test(id) ? id : '';
  } catch { return ''; }
}
export function rememberSharedProfile(id, doc = globalThis.document, loc = globalThis.location) {
  if (!/^[a-z0-9-]{1,48}$/.test(String(id || ''))) return;
  if (loc?.protocol !== 'https:' || !(loc.hostname === 'olycity.fr' || loc.hostname.endsWith('.olycity.fr'))) return;
  try { doc.cookie = KEY+'='+encodeURIComponent(id)+'; Domain=olycity.fr; Path=/; Max-Age=2592000; SameSite=Lax; Secure'; } catch {}
}
