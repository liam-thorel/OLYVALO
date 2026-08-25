let installPrompt = null;
let waitingWorker = null;

function showAppStatus({ title, detail, action = '', state = 'offline' }) {
  const banner = document.getElementById('app-status-banner');
  if (!banner) return;
  banner.dataset.state = state;
  document.getElementById('app-status-title').textContent = title;
  document.getElementById('app-status-detail').textContent = detail;
  const button = document.getElementById('app-status-action');
  button.textContent = action;
  button.hidden = !action;
  banner.hidden = false;
}

function hideAppStatus() {
  const banner = document.getElementById('app-status-banner');
  if (banner) banner.hidden = true;
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function installInstructions(userAgent = navigator.userAgent) {
  const agent = String(userAgent || '');
  if (/iphone|ipad|ipod/i.test(agent)) return {
    device:'Sur iPhone ou iPad',
    summary:'Ajoute OLYCITY à ton écran d’accueil depuis Safari.',
    steps:['Ouvre cette page dans Safari.', 'Appuie sur le bouton Partager.', 'Choisis « Sur l’écran d’accueil », puis « Ajouter ».'],
  };
  if (/android/i.test(agent)) return {
    device:'Sur Android',
    summary:'Installe OLYCITY comme une application depuis Chrome.',
    steps:['Ouvre le menu ⋮ de Chrome.', 'Choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».', 'Confirme avec « Installer ».'],
  };
  return {
    device:'Sur ordinateur',
    summary:'Ouvre OLYCITY dans sa propre fenêtre depuis ton navigateur.',
    steps:['Ouvre le menu de Chrome ou Edge.', 'Choisis « Installer OLYCITY » ou « Applications → Installer ce site ».', 'Confirme pour créer le raccourci.'],
  };
}

function closeModal() {
  document.getElementById('pwa-install-modal').hidden = true;
}

function closeAppModal() {
  const modal = document.getElementById('home-app-modal');
  if (modal) modal.hidden = true;
}

function refreshAppLauncher() {
  const launcher = document.getElementById('home-app-launcher');
  if (!launcher) return;
  const install = document.getElementById('pwa-install-band');
  const push = document.getElementById('push-notification-band');
  launcher.hidden = Boolean(install?.hidden && push?.hidden);
}

function openModal() {
  const guide = installInstructions();
  document.getElementById('pwa-install-device').textContent = guide.device;
  document.getElementById('pwa-install-steps').innerHTML = guide.steps.map(step => `<li>${step}</li>`).join('');
  const action = document.getElementById('pwa-install-action');
  action.hidden = !installPrompt;
  document.getElementById('pwa-install-modal').hidden = false;
  closeAppModal();
}

async function installNow() {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  await prompt.userChoice.catch(() => null);
  closeModal();
  refreshBanner();
}

function refreshBanner() {
  const banner = document.getElementById('pwa-install-band');
  if (!banner) return;
  banner.hidden = isStandalone();
  const summary = document.getElementById('pwa-install-summary');
  if (summary) summary.textContent = installInstructions().summary;
  refreshAppLauncher();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    if (hadController) navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    }, { once:true });
    const registration = await navigator.serviceWorker.register('./sw.js', { scope:'./', updateViaCache:'none' });
    const announceUpdate = worker => {
      if (!worker || !navigator.serviceWorker.controller) return;
      waitingWorker = worker;
      showAppStatus({
        title:'Nouvelle version disponible',
        detail:'La mise à jour est prête sans interrompre ce que tu regardes.',
        action:'Mettre à jour', state:'update',
      });
    };
    announceUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') announceUpdate(worker);
      });
    });
    registration.update().catch(() => {});
  } catch (error) {
    console.warn('[OLYCITY] Installation hors ligne indisponible', error);
  }
}

export function initPwaInstall() {
  document.getElementById('app-status-action')?.addEventListener('click', () => {
    if (waitingWorker) waitingWorker.postMessage({ type:'SKIP_WAITING' });
    else window.location.reload();
  });
  document.getElementById('app-status-close')?.addEventListener('click', hideAppStatus);
  window.addEventListener('offline', () => showAppStatus({
    title:'Mode hors connexion', detail:'La dernière copie disponible reste accessible.', state:'offline',
  }));
  window.addEventListener('online', () => {
    showAppStatus({ title:'Connexion rétablie', detail:'Les données se synchronisent en arrière-plan.', state:'online' });
    window.setTimeout(() => { if (!waitingWorker) hideAppStatus(); }, 2600);
  });
  if (!navigator.onLine) showAppStatus({
    title:'Mode hors connexion', detail:'La dernière copie disponible reste accessible.', state:'offline',
  });
  document.getElementById('home-app-launcher')?.addEventListener('click', () => {
    const modal = document.getElementById('home-app-modal');
    if (modal) modal.hidden = false;
  });
  document.querySelectorAll('[data-home-app-close]').forEach(button => button.addEventListener('click', closeAppModal));
  document.getElementById('home-app-modal')?.addEventListener('click', event => {
    if (event.target.id === 'home-app-modal') closeAppModal();
  });
  document.getElementById('pwa-install-band')?.addEventListener('click', openModal);
  document.getElementById('pwa-install-action')?.addEventListener('click', installNow);
  document.querySelectorAll('[data-pwa-close]').forEach(button => button.addEventListener('click', closeModal));
  document.getElementById('pwa-install-modal')?.addEventListener('click', event => { if (event.target.id === 'pwa-install-modal') closeModal(); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    refreshBanner();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    refreshBanner();
  });
  window.addEventListener('olycity:app-options-change', refreshAppLauncher);
  refreshBanner();
  void registerServiceWorker();
}
