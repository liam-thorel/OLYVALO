export function initSiteSwitcher(root = document.querySelector('header') || document.querySelector('nav')) {
  if (!root || document.querySelector('.oly-site-switcher')) return;
  const style = document.createElement('style');
  style.textContent = '.oly-site-switcher{position:relative;flex-shrink:0;margin-left:8px;font:600 13px system-ui;color:#e2e5ee}.oly-site-switcher summary{cursor:pointer;min-height:44px;display:flex;align-items:center;padding:0 12px;border:1px solid #343844;border-radius:6px;background:#101319}.oly-site-switcher nav{position:absolute;top:100%;right:0;z-index:10000;display:grid!important;min-width:180px;padding:6px;background:#101319;border:1px solid #343844;border-radius:6px;box-shadow:0 12px 30px #0008}.oly-site-switcher a{display:block;min-height:44px;padding:12px;box-sizing:border-box;color:#e2e5ee;text-decoration:none;white-space:nowrap}.oly-site-switcher a:hover,.oly-site-switcher a:focus-visible{background:#242832}.oly-site-switcher [aria-current]{color:#ff6978}';
  document.head.append(style);
  const details = document.createElement('details');
  details.className = 'oly-site-switcher';
  const services = [['Portail','https://olycity.fr/'],['Tracker','https://tracker.olycity.fr/'],['Games','https://games.olycity.fr/'],['Musique','https://musique.olycity.fr/']];
  details.innerHTML = '<summary aria-label="Changer de site OLYCITY"><svg class="site-switch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Sites</span><span class="game-switch-chevron" aria-hidden="true"></span></summary><nav aria-label="Sites OLYCITY">' + services.map(([name,url]) => '<a href="'+url+'"'+(new URL(url).origin === location.origin ? ' aria-current="page"' : '')+'>'+name+'</a>').join('') + '</nav>';
  root.append(details);
  details.addEventListener('keydown', event => { if (event.key === 'Escape') { details.open = false; details.querySelector('summary').focus(); } });
  document.addEventListener('click', event => { if (!details.contains(event.target)) details.open = false; });
  details.addEventListener('focusout', event => { if (!details.contains(event.relatedTarget)) details.open = false; });
  details.addEventListener('toggle', () => {
    if (details.open) document.querySelectorAll('.game-switch[open]').forEach(el => { el.open = false; });
  });
}
