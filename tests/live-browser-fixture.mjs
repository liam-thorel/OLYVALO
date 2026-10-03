// Exécute le vrai rendu avec des données locales. Aucun envoi Firebase/Riot.
const errors = [];
const originalError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };
window.EventSource = class { addEventListener() {} close() {} };
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  const target = String(url);
  if (target.includes('firebasedatabase.app')) return Promise.resolve(new Response('{}', { status:200 }));
  if (target.includes('valorant-api.com')) return Promise.resolve(new Response('{"data":[]}', { status:200 }));
  return originalFetch(url, options);
};
try {
  const html = await (await originalFetch('../index.html')).text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script').forEach(script => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  if (new URLSearchParams(location.search).has('visual')) {
    document.documentElement.dataset.theme = 'dark';
    parsed.querySelectorAll('link[rel="stylesheet"]').forEach(source => {
      const link = source.cloneNode();
      link.href = new URL(source.getAttribute('href'), new URL('../index.html', location.href)).href;
      document.head.append(link);
    });
    const style = document.createElement('style');
    style.textContent = 'body>*:not(#fixture-result):not(#page-live){display:none!important}#page-live{display:block!important;padding:20px}#fixture-result{white-space:pre-wrap;font-size:11px;padding:16px}';
    document.head.append(style);
  }
  const report = document.createElement('pre');
  report.id = 'fixture-result';
  document.body.prepend(report);
  const { liveDataStore } = await import('../js/live-data-store.mjs?v=20260930-consistent-live');
  const { initLivePage } = await import('../js/interactions.js');
  const clients = { self:{ ts:Date.now(), state:'in-game', playerName:'Test#OLY', scriptVersion:'4.21.0' } };
  const base = {
    ts:Date.now(), active:true, mapClean:'Ascent', map:'Ascent', server:'Paris',
    mode:'competitive', queueId:'competitive', modeFamily:'standard', matchId:'fixture-match',
    playerName:'Test#OLY', scriptVersion:'4.21.0', selfTeam:'ORDER',
    score:{ blue:7, red:4 }, players:[{ puuid:'self', name:'Test#OLY', team:'ORDER', agent:'Omen', rank:{ tier:23, peakTier:26 } }],
  };
  const put = session => liveDataStore.apply('valorantSessions', {path:'/', data:{self:session}});
  liveDataStore.apply('valorantClients', {path:'/', data:clients});
  liveDataStore.apply('lolClients', {path:'/', data:{}});
  liveDataStore.apply('lolSessions', {path:'/', data:{}});
  put(base);
  const check = (condition, label) => { if (!condition) throw new Error(label); report.textContent += `PASS ${label}\n`; };
  let dispose = initLivePage();
  check(document.getElementById('live-score-mine').textContent === '7', 'partie déjà chargée au premier abonnement');
  check(document.querySelector('.live-player-row')?.textContent.includes('Ascendant 3'), 'rang initial rendu sans erreur');
  put({...base, score:{blue:8,red:4}});
  check(document.getElementById('live-score-mine').textContent === '8', 'score actualisé sans F5');
  put({...base, mode:'agent-select', phase:'pregame', players:[]});
  check(document.getElementById('live-score').hidden, 'pas de score pendant Agent Select');
  put({...base, matchId:'fixture-next', score:{blue:0,red:0}});
  check(!document.getElementById('live-score').hidden && document.getElementById('live-score-mine').textContent === '0', 'nouveau match sur la même carte');
  dispose();
  dispose = initLivePage();
  check(document.getElementById('live-score-mine').textContent === '0', 'retour de page sans F5');
  liveDataStore.apply('valorantClients', {path:'/', data:{
    self:{...clients.self, online:true, map:'Ascent', memberId:'liam'},
    mathis:{online:true, ts:Date.now(), state:'idle', activity:'queue', partySize:3, partyCapacity:5, memberId:'mathis', playerName:'Mathis#OLY'},
    nico:{online:true, ts:Date.now(), state:'idle', activity:'menu', partySize:1, partyCapacity:5, memberId:'nico', playerName:'Nico#OLY'},
    noe:{online:true, ts:Date.now(), state:'idle', activity:'away', memberId:'noe', playerName:'Noé#OLY'},
  }});
  check(document.querySelectorAll('.live-client-chip').length === 4, 'quatre cartes de membres rendues');
  check(document.querySelector('[data-state="away"] .live-client-info small')?.textContent === 'Absent', 'absent identifié en orange avec libellé');
  check(document.getElementById('live-client-list').textContent.includes('Dans le lobby · 1/5'), 'compteur du lobby affiché');
  check(document.getElementById('live-client-list').textContent.includes('En recherche · 3/5'), 'compteur de recherche affiché');
  check(document.querySelector('.live-player-row')?.textContent.includes('Ascendant 3'), 'ranks préservés après actualisation des cartes');
  check(errors.length === 0, `console sans erreur (${errors.join('; ')})`);
  dispose();
  liveDataStore.destroy();
  report.textContent += 'TOUS LES TESTS NAVIGATEUR PASSENT';
} catch (error) {
  let report = document.getElementById('fixture-result');
  if (!report) { report = document.createElement('pre'); report.id='fixture-result'; document.body.prepend(report); }
  report.textContent += `\nFAIL ${error.stack || error}`;
  console.error(error);
}
