// Neutral filename: some content blockers reject modules whose URL contains
// "push-notifications", even though this feature is explicitly user-initiated.
const PROFILE_ID_KEY = 'olycity-member-id';
const PROFILE_NAME_KEY = 'olycity-profile';

function base64UrlBytes(value = '') {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function config() {
  try {
    const module = await import('../config.js');
    const endpoint = String(module.CONFIG?.NOTIFICATION_ENDPOINT || '').replace(/\/$/, '');
    if (!endpoint) return null;
    const response = await fetch(`${endpoint}/config`, { headers:{ Accept:'application/json' } });
    if (!response.ok) return null;
    const remote = await response.json();
    return { endpoint, publicKey:String(remote.publicKey || '') };
  } catch { return null; }
}

function selectedProfile() {
  const memberId = localStorage.getItem(PROFILE_ID_KEY) || '';
  const name = localStorage.getItem(PROFILE_NAME_KEY) || '';
  return memberId && name && name !== 'Guest' ? { memberId, name } : null;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

function pushError(error, stage = 'subscribe') {
  const message = String(error?.message || error || '');
  if (/push service error|push service not available|could not connect to push server/i.test(message)) {
    return new Error('Le service Push de ce navigateur est indisponible. Ouvre OLYCITY dans Chrome ou Edge, puis installe l’application depuis ce navigateur.');
  }
  if (/load failed|failed to fetch|networkerror|network request failed/i.test(message)) {
    return new Error(stage === 'test'
      ? 'Le test n’a pas pu joindre le service OLYCITY. Réessaie dans une minute.'
      : 'Connexion au service de notifications impossible. Vérifie le réseau puis réessaie.');
  }
  if (/notallowederror|permission denied|denied/i.test(message)) {
    return new Error('Les notifications sont bloquées dans les réglages du navigateur ou du téléphone.');
  }
  return new Error(message || 'Activation des notifications impossible.');
}

export async function currentPushState() {
  if (!pushSupported()) return { state:'unsupported', label:'Notifications non compatibles' };
  if (Notification.permission === 'denied') return { state:'denied', label:'Notifications bloquées dans le navigateur' };
  const subscription = await (await registration()).pushManager.getSubscription();
  return subscription
    ? { state:'enabled', label:'Notifications activées sur cet appareil' }
    : { state:'disabled', label:'Rappels à 30 et 15 min, plus les rank-ups' };
}

export async function enablePushNotifications() {
  const profile = selectedProfile();
  if (!profile) throw new Error('Choisis d’abord ton profil OLYCITY.');
  if (!pushSupported()) throw new Error('Ce navigateur ne prend pas en charge les notifications.');
  if (Notification.permission === 'denied') throw new Error('Les notifications sont bloquées dans les réglages du navigateur.');
  const remote = await config();
  if (!remote?.publicKey) throw new Error('Le service de notifications n’est pas encore configuré.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Autorisation de notification refusée.');
  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  if (!subscription) {
    try {
      subscription = await worker.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:base64UrlBytes(remote.publicKey),
      });
    } catch (error) {
      throw pushError(error);
    }
  }
  let response;
  try {
    response = await fetch(`${remote.endpoint}/subscriptions`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ ...profile, subscription:subscription.toJSON(), userAgent:navigator.userAgent }),
    });
  } catch (error) { throw pushError(error, 'register'); }
  if (!response.ok) throw new Error('Impossible d’enregistrer cet appareil.');
  window.dispatchEvent(new CustomEvent('olycity:push-state'));
  return currentPushState();
}

export async function disablePushNotifications() {
  if (!pushSupported()) return { state:'unsupported', label:'Notifications non compatibles' };
  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription();
  if (subscription) {
    const remote = await config();
    if (remote) await fetch(`${remote.endpoint}/subscriptions`, {
      method:'DELETE',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ endpoint:subscription.endpoint }),
    }).catch(() => null);
    await subscription.unsubscribe();
  }
  window.dispatchEvent(new CustomEvent('olycity:push-state'));
  return currentPushState();
}

export async function sendTestPush() {
  const profile = selectedProfile();
  if (!profile || !['nico', 'liam'].includes(profile.memberId)) {
    throw new Error('Le test est réservé à Nico et Liam.');
  }
  const remote = await config();
  if (!remote) throw new Error('Le service de notifications n’est pas encore configuré.');
  let response;
  try {
    response = await fetch(`${remote.endpoint}/notifications/test`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(profile),
    });
  } catch (error) { throw pushError(error, 'test'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Le test a échoué.');
  return payload;
}

export function initPushNotifications() {
  const band = document.getElementById('push-notification-band');
  const summary = document.getElementById('push-notification-summary');
  if (!band || !pushSupported()) {
    if (band) band.hidden = true;
    return;
  }
  const refresh = async () => {
    const state = await currentPushState();
    band.dataset.state = state.state;
    if (summary) summary.textContent = state.label;
    band.hidden = false;
    window.dispatchEvent(new CustomEvent('olycity:app-options-change'));
  };
  band.addEventListener('click', async () => {
    band.disabled = true;
    try {
      const current = await currentPushState();
      if (summary) summary.textContent = current.state === 'enabled' ? 'Désactivation…' : 'Activation…';
      const state = current.state === 'enabled' ? await disablePushNotifications() : await enablePushNotifications();
      if (summary) summary.textContent = state.label;
    } catch (error) {
      if (summary) summary.textContent = error.message;
    } finally { band.disabled = false; }
  });
  window.addEventListener('olycity:profile-change', refresh);
  window.addEventListener('olycity:push-state', refresh);
  void refresh();
}
