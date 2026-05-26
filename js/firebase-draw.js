/**
 * OLYCITY — Dessin collaboratif temps réel via Firebase
 * Chargé dynamiquement via importmap-compatible CDN
 */

// Firebase CDN (compat version - works without bundler)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBOfJ_6l3Elifz4DC_1iqpyzLjlzPRskCE",
  authDomain: "realtime-database-5bb9f.firebaseapp.com",
  databaseURL: "https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "realtime-database-5bb9f",
};

let _db = null;

async function getDB() {
  if (_db) return _db;
  // Load Firebase compat SDK
  await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
  await loadScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js');
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  _db = firebase.database();
  return _db;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

export async function initDrawBoard(mapName, container) {
  const db = await getDB();

  let drawing = false;
  let currentPath = [];
  let currentColor = '#ff4656';
  let currentSize = 3;
  let paths = {};

  container.innerHTML = `
    <div class="draw-board">
      <div class="draw-toolbar">
        <div class="draw-tool-group">
          ${['#ff4656','#3fcfcf','#f5c842','#a87fff','#ffffff','#ff8200'].map(c =>
            `<button class="draw-color-btn ${c === '#ff4656' ? 'active' : ''}"
              style="background:${c}" data-color="${c}"
              onclick="window._drawSetColor('${c}',this)"></button>`
          ).join('')}
        </div>
        <div class="draw-tool-group">
          <input type="range" id="draw-size" min="1" max="20" value="3"
            oninput="window._drawSetSize(this.value)"
            style="width:80px;accent-color:var(--red)">
          <span id="draw-size-label" style="font-size:10px;color:var(--muted);min-width:20px">3px</span>
        </div>
        <div class="draw-tool-group">
          <button class="draw-btn" onclick="window._drawUndo()">↩ Undo</button>
          <button class="draw-btn draw-btn-danger" onclick="window._drawClear()">🗑 Effacer tout</button>
        </div>
        <div class="draw-tool-group" style="margin-left:auto">
          <span style="font-size:9px;letter-spacing:1px;color:#3fcfcf">● Live</span>
        </div>
      </div>
      <div class="draw-canvas-wrap">
        <canvas id="draw-canvas" style="cursor:crosshair;touch-action:none"></canvas>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#draw-canvas');
  const wrap = container.querySelector('.draw-canvas-wrap');
  // Load minimap from valorantApi (already loaded in main app)
  let minimapImg = null;
  const minimapUrl = window.OLYCITY?._getMapIcon?.(mapName);
  const loadMinimap = () => new Promise(res => {
    // Try to get URL from window.valorantApi first
    let url = null;
    try { url = window._valorantApiMaps?.[mapName]?.icon; } catch(e) {}
    if (!url) {
      // Fallback: fetch directly
      fetch('https://valorant-api.com/v1/maps')
        .then(r => r.json())
        .then(data => {
          const m = data.data?.find(d => d.displayName === mapName);
          if (!m?.displayIcon) return res();
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { minimapImg = img; res(); };
          img.onerror = () => res();
          img.src = m.displayIcon;
        }).catch(() => res());
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { minimapImg = img; res(); };
    img.onerror = () => res();
    img.src = url;
  });

  await loadMinimap();

  // Center canvas in full-width wrap
  wrap.style.maxWidth = '100%';
  wrap.style.background = 'var(--surf)';
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';

  const resize = () => {
    const w = Math.min(wrap.clientWidth - 2, 500);
    canvas.width = w;
    canvas.height = w; // displayIcon is always square
    redraw();
  };
  setTimeout(resize, 50);
  window.addEventListener('resize', resize);

  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) / rect.width * 100, y: (src.clientY - rect.top) / rect.height * 100 };
  };

  // Ctrl+Z = undo
  const ctrlZ = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (myPathKeys.length) {
        const key = myPathKeys.pop();
        db.ref(`drawings/${mapName}/${key}`).remove();
      }
    }
  };
  document.addEventListener('keydown', ctrlZ);

  canvas.addEventListener('mousedown', e => { drawing = true; currentPath = [pos(e)]; });
  canvas.addEventListener('mousemove', e => {
    if (!drawing) return;
    currentPath.push(pos(e));
    redraw();
    drawSinglePath(canvas.getContext('2d'), {points:currentPath,color:currentColor,size:currentSize});
  });
  canvas.addEventListener('mouseup', savePath);
  canvas.addEventListener('mouseleave', savePath);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; currentPath = [pos(e)]; }, {passive:false});
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (!drawing) return; currentPath.push(pos(e)); redraw(); drawSinglePath(canvas.getContext('2d'), {points:currentPath,color:currentColor,size:currentSize}); }, {passive:false});
  canvas.addEventListener('touchend', savePath);

  // Firebase listeners
  const mapRef = db.ref(`drawings/${mapName}`);
  mapRef.on('child_added', snap => { paths[snap.key] = snap.val(); redraw(); });
  mapRef.on('child_removed', snap => { delete paths[snap.key]; redraw(); });

  window._drawSetColor = (c, btn) => {
    currentColor = c;
    container.querySelectorAll('.draw-color-btn').forEach(b => b.classList.remove('active'));
    btn?.classList.add('active');
  };
  window._drawSetSize = (v) => {
    currentSize = +v;
    const lbl = document.getElementById('draw-size-label');
    if (lbl) lbl.textContent = v + 'px';
  };
  let myPathKeys = [];
  window._drawUndo = () => {
    if (!myPathKeys.length) return;
    const key = myPathKeys.pop();
    db.ref(`drawings/${mapName}/${key}`).remove();
  };
  window._drawClear = () => {
    if (!confirm('Effacer tous les dessins ?')) return;
    db.ref(`drawings/${mapName}`).remove();
  };

  function savePath() {
    if (!drawing || currentPath.length < 2) { drawing = false; currentPath = []; return; }
    drawing = false;
    db.ref(`drawings/${mapName}`).push({
      points: currentPath, color: currentColor, size: currentSize,
      author: localStorage.getItem('olycity-profile') || 'guest', ts: Date.now()
    }).then(ref => { myPathKeys.push(ref.key); });
    currentPath = [];
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw minimap background
    if (minimapImg) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Draw centered/fitted
      ctx.drawImage(minimapImg, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(6,8,12,.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#0d1117';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.globalAlpha = 1;
    Object.values(paths).forEach(p => drawSinglePath(ctx, p));
  }

  function drawSinglePath(ctx, p) {
    if (!p?.points?.length > 1) return;
    ctx.beginPath();
    ctx.moveTo(p.points[0].x/100*canvas.width, p.points[0].y/100*canvas.height);
    for (let i = 1; i < p.points.length; i++)
      ctx.lineTo(p.points[i].x/100*canvas.width, p.points[i].y/100*canvas.height);
    ctx.strokeStyle = p.color || '#ff4656';
    ctx.lineWidth = (p.size||3) * canvas.width/800;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
}
