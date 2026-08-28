/**
 * OLYCITY · Malédiction — easter egg cosmétique de la page live, PARTAGÉ
 * entre tous les visiteurs du site (via Firebase) : si quelqu'un maudit la
 * game, tout le monde qui a la page live ouverte voit les tentacules, la
 * vignette, entend le son et voit les phrases — pas juste la personne qui a
 * cliqué. L'état vit dans live/curse {active, curser, matchId, startedAt} ;
 * applyCurseState() est le point unique qui synchronise l'état partagé. Les
 * effets locaux sont coupés hors de la page Live et lorsque l'onglet du
 * navigateur est masqué. La curse reste irréversible pendant la partie et se
 * réinitialise automatiquement lors de la fin ou du changement de match.
 */

const FIREBASE_URL = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
const CURSE_PATH = 'live/curse';

const DOSE = 10; // intensité du glitch zalgo, validée avec l'utilisateur
const TENTACLE_COUNT = 7;
const AMBIENCE_TARGET_GAIN = 0.32;

// Marques combinantes Unicode "haut"/"bas" uniquement — les marques "mid"
// (barrées/traversantes) sont volontairement exclues : ce sont elles qui
// rendent le zalgo illisible.
const UP = [0x0300,0x0301,0x0304,0x0306,0x0307,0x0308,0x030a,0x030b,0x030c,0x030f,
            0x0311,0x0313,0x0342,0x0350,0x0351,0x0357,0x035b,0x0363,0x0364,0x0365,
            0x0366,0x0367,0x0368,0x0369,0x036a,0x036b,0x036c,0x036d,0x036e,0x036f];
const DOWN = [0x0316,0x0317,0x0318,0x0319,0x031c,0x031e,0x031f,0x0320,0x0324,0x0325,
              0x0326,0x0329,0x032a,0x032c,0x032d,0x032e,0x032f,0x0330,0x0332,0x0333,
              0x0339,0x033a,0x033c,0x0345,0x0347,0x0348,0x0349,0x0353,0x0354,0x0356];

function mark(pool){ return String.fromCharCode(pool[(Math.random() * pool.length) | 0]); }

function zalgofy(text, dose){
  if (dose <= 0) return text;
  const maxPerChar = 1 + dose * 0.55;
  let out = '';
  for (const ch of text){
    out += ch;
    if (ch === ' ') continue;
    const ups = Math.round(Math.random() * maxPerChar * 0.6);
    const downs = Math.round(Math.random() * maxPerChar * 0.6);
    for (let u = 0; u < ups; u++) out += mark(UP);
    for (let d = 0; d < downs; d++) out += mark(DOWN);
  }
  return out;
}

// {player} est remplacé par un membre du roster OLYCITY tiré au hasard parmi
// ceux présents dans la game (côté équipe suivie) — chaque apparition tire
// un nom différent.
function buildPhrases(curser, roster){
  const player = roster.length ? roster[(Math.random() * roster.length) | 0] : 'quelqu’un';
  return [
    curser + ' a maudit cette partie',
    'La défaite est proche',
    'Aucun dodge ne vous sauvera',
    'Vos munitions vous abandonnent',
    'Soyez prêts pour le -20 RR',
    'Quelque chose regarde depuis le spawn',
    player + ', tu vas perdre tous tes duels',
    player + ', ton ping va grimper',
    player + ' va afk au spawn',
  ];
}

function fbPutJSON(path, data){
  return fetch(`${FIREBASE_URL}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function initCurse(){
  const btn = document.getElementById('curse-btn');
  const btnLabel = document.getElementById('curse-btn-label');
  const canvas = document.getElementById('curse-tentacle-canvas');
  const cursedLayer = document.getElementById('curse-layer');
  const vignetteEl = document.getElementById('curse-vignette');
  const muteBtn = document.getElementById('curse-mute-btn');
  const muteIcon = document.getElementById('curse-mute-icon');
  const muteLabel = document.getElementById('curse-mute-label');
  if (!btn || !btnLabel || !canvas || !cursedLayer) return null;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function makeTentacle(i, count){
    const spread = window.innerWidth / count;
    return {
      baseX: spread * i + spread * (0.3 + Math.random() * 0.4),
      segments: 13 + ((Math.random() * 4) | 0),
      length: 300 + Math.random() * 340,
      baseWidth: 34 + Math.random() * 26,
      freq1: 0.55 + Math.random() * 0.5,
      freq2: 1.3 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 40,
      speed: 0.6 + Math.random() * 0.5,
      rise: 0,
    };
  }

  const tentacleList = [];
  for (let i = 0; i < TENTACLE_COUNT; i++) tentacleList.push(makeTentacle(i, TENTACLE_COUNT));

  let tentaclesActive = false;
  let t = 0;
  let raf = null;
  let curseStartTime = 0;

  function drawTentacle(tn, time){
    const baseX = tn.baseX + Math.sin(time * 0.05 + tn.phase) * tn.drift;
    const h = window.innerHeight;
    const len = tn.length * tn.rise;
    if (len < 2) return;

    const pts = [];
    for (let s = 0; s <= tn.segments; s++){
      const f = s / tn.segments;
      const y = h - len * f;
      const sway =
        Math.sin(time * tn.speed * tn.freq1 + tn.phase + f * 4.2) * (26 * f) +
        Math.sin(time * tn.speed * tn.freq2 + tn.phase * 1.7) * (10 * f * f);
      pts.push({ x: baseX + sway, y, w: tn.baseWidth * (1 - f) * tn.rise + 1.5 });
    }

    const left = [], right = [];
    for (let k = 0; k < pts.length; k++){
      const p = pts[k];
      const prev = pts[k - 1] || p;
      const next = pts[k + 1] || p;
      const dx = next.x - prev.x, dy = next.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d;
      left.push({ x: p.x + nx * p.w, y: p.y + ny * p.w });
      right.push({ x: p.x - nx * p.w, y: p.y - ny * p.w });
    }

    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let a = 1; a < left.length; a++) ctx.lineTo(left[a].x, left[a].y);
    for (let b = right.length - 1; b >= 0; b--) ctx.lineTo(right[b].x, right[b].y);
    ctx.closePath();

    const grad = ctx.createLinearGradient(baseX, h, baseX, h - len);
    grad.addColorStop(0, 'rgba(4,1,9,.92)');
    grad.addColorStop(0.55, 'rgba(10,3,20,.82)');
    grad.addColorStop(1, 'rgba(18,6,32,.35)');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(139,47,201,.35)';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let c = 1; c < left.length; c++) ctx.lineTo(left[c].x, left[c].y);
    ctx.strokeStyle = 'rgba(167,85,232,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let m = 2; m < pts.length - 1; m += 2){
      const pp = pts[m];
      const r = Math.max(1, pp.w * 0.3);
      if (r < 1.4) continue;
      ctx.beginPath();
      ctx.ellipse(pp.x, pp.y, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(60,20,90,.35)';
      ctx.fill();
    }
  }

  /* ---------------- cursor ink trail ---------------- */
  const inkParticles = [];
  let lastInkSpawn = 0;
  document.addEventListener('pointermove', e => {
    if (!locked || reduceMotion) return;
    const now = performance.now();
    if (now - lastInkSpawn < 45) return;
    lastInkSpawn = now;
    inkParticles.push({
      x: e.clientX, y: e.clientY,
      vx: (Math.random() - 0.5) * 6, vy: -0.4 - Math.random() * 0.8,
      life: 0, maxLife: 700 + Math.random() * 500,
      size: 4 + Math.random() * 7,
    });
    if (inkParticles.length > 120) inkParticles.splice(0, inkParticles.length - 120);
  });

  function updateInk(dtMs){
    for (let i = inkParticles.length - 1; i >= 0; i--){
      const p = inkParticles[i];
      p.life += dtMs;
      if (p.life >= p.maxLife){ inkParticles.splice(i, 1); continue; }
      p.x += p.vx * (dtMs / 16);
      p.y += p.vy * (dtMs / 16);
      const f = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size * (0.5 + f * 0.5), p.size * (0.5 + f * 0.5), 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(90,30,140,${(f * 0.45).toFixed(3)})`;
      ctx.shadowColor = 'rgba(167,85,232,.5)';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  let lastFrameTime = performance.now();

  function loop(){
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dtMs = now - lastFrameTime;
    lastFrameTime = now;
    t += reduceMotion ? 0.006 : 0.016;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let anyVisible = false;
    let avgRise = 0;
    for (let i = 0; i < tentacleList.length; i++){
      const tn = tentacleList[i];
      const target = tentaclesActive ? 1 : 0;
      tn.rise += (target - tn.rise) * (reduceMotion ? 0.03 : 0.045);
      avgRise += tn.rise;
      if (tn.rise > 0.003){ anyVisible = true; drawTentacle(tn, t + i * 3.1); }
    }
    avgRise /= tentacleList.length;

    updateInk(dtMs);

    // Vignette : présente dès le début (pas un fondu depuis zéro), puis
    // continue de s'intensifier tant que la curse dure (plafonnée). Le throb
    // (pulsation synchronisée au balancement des tentacules) reste actif en
    // permanence, y compris en prefers-reduced-motion — seule l'amplitude
    // du balancement des tentacules elles-mêmes est réduite dans ce cas.
    if (vignetteEl){
      const minAlpha = 0.16;
      const age = tentaclesActive ? (Date.now() - curseStartTime) / 45000 : 0;
      const throb = Math.sin(t * 1.1) * 0.05;
      const baseAlpha = tentaclesActive ? minAlpha + Math.min(0.34, age * 0.34) : 0;
      const alpha = Math.max(0, (baseAlpha + throb) * avgRise);
      vignetteEl.style.background = `radial-gradient(ellipse at center, transparent 30%, rgba(8,2,16,${alpha.toFixed(3)}) 100%)`;
    }

    if (!tentaclesActive && !anyVisible && inkParticles.length === 0){
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  function setTentaclesActive(v){
    tentaclesActive = v;
    if (!raf) loop();
  }

  /* ---------------- ambient sound (drone + whispers, no external asset) ---------------- */
  let audioCtx = null, masterGain = null, whisperTimer = null, muted = false;
  let pageActive = document.getElementById('page-live')?.classList.contains('active') ?? false;

  function startAmbience(){
    // Le son n'est pas un effet de "mouvement" — pas de garde reduceMotion
    // ici, seul le bouton muet contrôle ça.
    if (audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    masterGain.gain.value = 0;

    const osc1 = audioCtx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 55;
    const osc2 = audioCtx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 55 * 1.5;
    const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220; filter.Q.value = 4;
    const droneGain = audioCtx.createGain(); droneGain.gain.value = 0.55;
    osc1.connect(filter); osc2.connect(filter); filter.connect(droneGain); droneGain.connect(masterGain);

    const lfo = audioCtx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 65;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency);

    osc1.start(); osc2.start(); lfo.start();
  }

  function scheduleWhisper(){
    if (whisperTimer) return;
    whisperTimer = setTimeout(() => { playWhisperBurst(); scheduleWhisper(); }, 3500 + Math.random() * 5000);
  }

  function playWhisperBurst(){
    if (!audioCtx || muted || !pageActive || document.hidden || !cursed) return;
    const dur = 1.2 + Math.random() * 1.5;
    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const noise = audioCtx.createBufferSource(); noise.buffer = buffer;
    const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 900; bp.Q.value = 1.4;
    const g = audioCtx.createGain(); g.gain.value = 0;
    const now = audioCtx.currentTime;
    g.gain.linearRampToValueAtTime(0.2, now + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, now + dur);
    noise.connect(bp); bp.connect(g); g.connect(masterGain);
    noise.start(); noise.stop(now + dur);
  }

  function stopAmbience(){
    if (whisperTimer){ clearTimeout(whisperTimer); whisperTimer = null; }
    if (masterGain && audioCtx){
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 1.2);
      const ctxToClose = audioCtx;
      setTimeout(() => { try { ctxToClose.close(); } catch { /* déjà fermé */ } }, 1300);
    }
    audioCtx = null; masterGain = null;
  }

  function refreshAmbience(){
    const shouldPlay = cursed && pageActive && !document.hidden && !muted;
    if (shouldPlay && !audioCtx) startAmbience();
    if (!audioCtx || !masterGain) return;

    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(shouldPlay ? AMBIENCE_TARGET_GAIN : 0, now + 0.25);
    if (shouldPlay) {
      audioCtx.resume?.().catch(() => {});
      scheduleWhisper();
    } else if (whisperTimer) {
      clearTimeout(whisperTimer);
      whisperTimer = null;
    }
  }

  function renderMuteButton(){
    if (!muteBtn) return;
    muteBtn.classList.toggle('muted', muted);
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.title = muted ? 'Réactiver le son de la curse' : 'Couper le son de la curse';
    if (muteIcon) muteIcon.textContent = muted ? '🔇' : '🔊';
    if (muteLabel) muteLabel.textContent = muted ? 'Réactiver le son' : 'Couper le son';
  }

  if (muteBtn){
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      renderMuteButton();
      refreshAmbience();
    });
  }

  /* ---------------- floating cursed text ---------------- */
  let currentRoster = [];
  let spawnTimer = null;

  function spawnPhrase(curserName){
    const phrases = buildPhrases(curserName, currentRoster);
    const text = phrases[(Math.random() * phrases.length) | 0];
    const el = document.createElement('div');
    el.className = 'curse-phrase';
    el.textContent = zalgofy(text, DOSE);
    const size = 13 + Math.random() * 9;
    el.style.fontSize = size.toFixed(1) + 'px';
    el.style.left = (8 + Math.random() * 62) + 'vw';
    el.style.top = (18 + Math.random() * 55) + 'vh';
    el.style.animationDuration = (reduceMotion ? 9 : 6 + Math.random() * 2.5) + 's';
    cursedLayer.appendChild(el);
    setTimeout(() => el.remove(), 9500);
  }

  function scheduleSpawn(curserName){
    if (spawnTimer || !cursed || !pageActive) return;
    spawnPhrase(curserName);
    const delay = (1600 + Math.random() * 1800) / 1.5;
    spawnTimer = setTimeout(() => {
      spawnTimer = null;
      scheduleSpawn(curserName);
    }, delay);
  }

  function stopSpawning(){
    if (spawnTimer){ clearTimeout(spawnTimer); spawnTimer = null; }
    cursedLayer.replaceChildren();
  }

  /* ---------------- button and lifecycle ---------------- */
  let cursed = false;
  let locked = false;
  let currentMatchId = '';
  let lastCurseState = null;
  let activeCurser = 'Quelqu’un';

  function dodge(){
    const margin = 70;
    const w = window.innerWidth, h = window.innerHeight;
    const bw = btn.offsetWidth || 160, bh = btn.offsetHeight || 40;
    const x = margin + Math.random() * Math.max(10, w - margin * 2 - bw);
    const y = margin + Math.random() * Math.max(10, h - margin * 2 - bh);
    btn.style.position = 'fixed';
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
    btn.style.right = 'auto';
  }

  function refreshLocalEffects(){
    const showEffects = cursed && pageActive;
    setTentaclesActive(showEffects);
    if (showEffects) scheduleSpawn(activeCurser);
    else stopSpawning();
    refreshAmbience();
  }

  function resetButton(){
    cursed = false;
    locked = false;
    btn.classList.remove('on', 'locked');
    btn.setAttribute('aria-pressed', 'false');
    btnLabel.textContent = 'Maudire la game';
    btn.style.position = '';
    btn.style.left = '';
    btn.style.top = '';
    btn.style.right = '';
    if (muteBtn) muteBtn.classList.remove('visible');
    renderMuteButton();
  }

  // Seule fonction qui déclenche les effets locaux (tentacules, vignette,
  // son, phrases, verrouillage du bouton) — appelée par le flux Firebase,
  // jamais directement par le clic. Ainsi la personne qui clique et tous les
  // autres visiteurs passent exactement par le même chemin.
  function applyCurseState(state){
    lastCurseState = state || null;
    const staleForThisMatch = !!(state?.matchId && currentMatchId && state.matchId !== currentMatchId);
    const isActive = !!(state && state.active) && !staleForThisMatch;

    if (isActive){
      activeCurser = state.curser || 'Quelqu’un';
      const wasCursed = cursed;
      cursed = true;
      locked = true;
      if (!wasCursed) curseStartTime = state.startedAt || Date.now();
      btn.classList.add('on', 'locked');
      btn.setAttribute('aria-pressed', 'true');
      btnLabel.textContent = 'Annuler la curse';
      if (muteBtn) muteBtn.classList.add('visible');
      refreshLocalEffects();
    } else {
      setTentaclesActive(false);
      stopSpawning();
      stopAmbience();
      if (cursed) resetButton();
    }
  }

  function currentCurser(){
    const profile = localStorage.getItem('olycity-profile') || '';
    return profile.split('#')[0] || 'Quelqu’un';
  }

  btn.addEventListener('click', () => {
    if (locked){ dodge(); return; }
    // Démarre l'ambiance sonore ici, en synchrone avec le vrai clic — les
    // navigateurs bloquent Web Audio hors d'un geste utilisateur direct, et
    // l'écho Firebase (qui déclenche applyCurseState pour tout le monde,
    // nous y compris) arrive toujours de façon asynchrone, donc trop tard
    // pour compter comme ce geste. startAmbience() est idempotent (no-op si
    // déjà démarré), donc le second appel via applyCurseState ne fait rien.
    startAmbience();
    fbPutJSON(CURSE_PATH, {
      active: true,
      curser: currentCurser(),
      matchId: currentMatchId,
      startedAt: Date.now(),
    }).catch(() => stopAmbience());
  });
  btn.addEventListener('pointerenter', () => { if (locked) dodge(); });

  document.addEventListener('visibilitychange', refreshAmbience);
  window.addEventListener('olycity:page-change', event => {
    pageActive = event.detail?.page === 'live';
    refreshLocalEffects();
    if (pageActive) startCurseStream();
    else stopCurseStream();
  });

  /* ---------------- sync with Firebase (shared across all visitors) ---------------- */
  // Pas de fetch initial séparé ici : Firebase envoie toujours un premier
  // événement "put" avec la valeur complète dès l'ouverture du flux, et
  // live/curse est un tout petit objet (pas de délai notable à attendre,
  // contrairement à live/sessions qui a sa propre justification pour un
  // seed fetch). Lancer les deux en parallèle créait une course : un clic
  // juste après le chargement de la page pouvait voir le fetch initial
  // (plus lent) écraser l'état "actif" tout juste confirmé par le flux.
  let curseSource = null;
  function startCurseStream() {
    if (!pageActive || curseSource || typeof EventSource === 'undefined') return;
    curseSource = new EventSource(`${FIREBASE_URL}/${CURSE_PATH}.json`);
    curseSource.addEventListener('put', e => {
      try {
        const message = JSON.parse(e.data);
        if ((message.path || '/') === '/') applyCurseState(message.data);
      } catch { /* flux temporairement invalide, ignoré */ }
    });
  }
  function stopCurseStream() {
    curseSource?.close();
    curseSource = null;
  }
  startCurseStream();

  /* ---------------- public API, driven by updateUI() ---------------- */
  function setRoster(names){
    currentRoster = Array.isArray(names) ? names.filter(Boolean) : [];
  }

  function setMatch(matchId){
    const nextMatchId = matchId || '';
    if (nextMatchId === currentMatchId) return;
    currentMatchId = nextMatchId;
    // Une curse de la partie précédente ne doit jamais suivre la suivante.
    applyCurseState(lastCurseState);
  }

  function setLive(isLive){
    if (isLive) return; // rien à faire tant que la game continue
    // Fin de partie détectée localement : on efface l'état partagé pour que
    // tout le monde reparte de zéro sur la prochaine game. Idempotent — peu
    // importe si plusieurs visiteurs déclenchent ce reset au même moment.
    const belongsToCurrentMatch = !lastCurseState?.matchId
      || !currentMatchId
      || lastCurseState.matchId === currentMatchId;
    applyCurseState(null);
    if (belongsToCurrentMatch) fbPutJSON(CURSE_PATH, null).catch(() => {});
  }

  return { setRoster, setMatch, setLive };
}
