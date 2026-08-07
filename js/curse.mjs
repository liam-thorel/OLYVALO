/**
 * OLYCITY · Malédiction — easter egg cosmétique de la page live. Tant qu'une
 * game est suivie, n'importe qui peut « maudire » la partie : des tentacules
 * montent du bas de l'écran et des phrases glitchées flottent, ciblant au
 * hasard un membre du roster OLYCITY présent dans le match. Irréversible une
 * fois lancée (le bouton fuit le curseur) — tout se réinitialise seul à la
 * fin de la game (voir updateCurseMatch(false, ...) dans interactions.js).
 */

const DOSE = 10; // intensité du glitch zalgo, validée avec l'utilisateur
const TENTACLE_COUNT = 7;

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

export function initCurse(){
  const btn = document.getElementById('curse-btn');
  const btnLabel = document.getElementById('curse-btn-label');
  const canvas = document.getElementById('curse-tentacle-canvas');
  const cursedLayer = document.getElementById('curse-layer');
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

  function loop(){
    raf = requestAnimationFrame(loop);
    t += reduceMotion ? 0.006 : 0.016;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    let anyVisible = false;
    for (let i = 0; i < tentacleList.length; i++){
      const tn = tentacleList[i];
      const target = tentaclesActive ? 1 : 0;
      tn.rise += (target - tn.rise) * (reduceMotion ? 0.03 : 0.045);
      if (tn.rise > 0.003){ anyVisible = true; drawTentacle(tn, t + i * 3.1); }
    }

    if (!tentaclesActive && !anyVisible){
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  function setTentaclesActive(v){
    tentaclesActive = v;
    if (!raf) loop();
  }

  /* ---------------- floating cursed text ---------------- */
  let currentRoster = [];
  let spawnTimer = null;

  function currentCurser(){
    const profile = localStorage.getItem('olycity-profile') || '';
    return profile.split('#')[0] || 'Quelqu’un';
  }

  function spawnPhrase(){
    const phrases = buildPhrases(currentCurser(), currentRoster);
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

  function scheduleSpawn(){
    spawnPhrase();
    const delay = (1600 + Math.random() * 1800) / 1.5;
    spawnTimer = setTimeout(scheduleSpawn, delay);
  }

  function stopSpawning(){
    if (spawnTimer){ clearTimeout(spawnTimer); spawnTimer = null; }
    cursedLayer.replaceChildren();
  }

  /* ---------------- button: one-way lock, dodges the cursor ---------------- */
  let cursed = false;
  let locked = false;

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
  }

  btn.addEventListener('click', () => {
    if (locked){ dodge(); return; }
    cursed = true;
    locked = true;
    btn.classList.add('on', 'locked');
    btn.setAttribute('aria-pressed', 'true');
    btnLabel.textContent = 'Annuler la curse';
    setTentaclesActive(true);
    scheduleSpawn();
  });
  btn.addEventListener('pointerenter', () => { if (locked) dodge(); });

  /* ---------------- public API, driven by updateUI() ---------------- */
  function setRoster(names){
    currentRoster = Array.isArray(names) ? names.filter(Boolean) : [];
  }

  function setLive(isLive){
    if (isLive) return; // rien à faire tant que la game continue
    if (!cursed && !locked) return; // pas de curse en cours, rien à réinitialiser
    setTentaclesActive(false);
    stopSpawning();
    resetButton();
  }

  return { setRoster, setLive };
}
