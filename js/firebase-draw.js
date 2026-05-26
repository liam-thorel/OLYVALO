/**
 * OLYCITY — Dessin collaboratif temps réel via Firebase
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, push, onChildAdded, onChildRemoved, remove, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const firebaseConfig = {
  apiKey: "AIzaSyBOfJ_6l3Elifz4DC_1iqpyzLjlzPRskCE",
  authDomain: "realtime-database-5bb9f.firebaseapp.com",
  databaseURL: "https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "realtime-database-5bb9f",
  storageBucket: "realtime-database-5bb9f.firebasestorage.app",
  messagingSenderId: "702240703792",
  appId: "1:702240703792:web:29435064610a9b89d474f5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ─── State ─────────────────────────────────────
let currentMap = null;
let drawing = false;
let currentPath = [];
let currentColor = '#ff4656';
let currentSize = 3;
let dbListener = null;
let paths = {}; // { id: pathData }

// ─── Init: attach to map tab "Dessin" ──────────
export function initDrawBoard(mapName, container) {
  currentMap = mapName;
  paths = {};
  drawing = false;
  currentPath = [];

  // Remove old listener
  if (dbListener) { dbListener(); dbListener = null; }

  // Create UI
  container.innerHTML = `
    <div class="draw-board">
      <div class="draw-toolbar">
        <div class="draw-tool-group">
          ${['#ff4656','#3fcfcf','#f5c842','#a87fff','#ffffff','#ff8200'].map(c =>
            `<button class="draw-color-btn ${c === '#ff4656' ? 'active' : ''}"
              style="background:${c}" data-color="${c}"
              onclick="window.OLYCITY_DRAW.setColor('${c}',this)"></button>`
          ).join('')}
        </div>
        <div class="draw-tool-group">
          <input type="range" id="draw-size" min="1" max="20" value="3"
            oninput="window.OLYCITY_DRAW.setSize(this.value)"
            style="width:80px;accent-color:var(--red)">
          <span id="draw-size-label" style="font-size:10px;color:var(--muted);min-width:20px">3px</span>
        </div>
        <div class="draw-tool-group">
          <button class="draw-btn" onclick="window.OLYCITY_DRAW.undo()">↩ Undo</button>
          <button class="draw-btn draw-btn-danger" onclick="window.OLYCITY_DRAW.clearAll()">🗑 Tout effacer</button>
        </div>
        <div class="draw-tool-group" style="margin-left:auto">
          <div style="font-size:9px;letter-spacing:1px;color:var(--dim)">
            <span style="width:8px;height:8px;background:#3fcfcf;border-radius:50%;display:inline-block;margin-right:4px"></span>
            Live · Firebase
          </div>
        </div>
      </div>
      <div class="draw-canvas-wrap">
        <canvas id="draw-canvas" style="cursor:crosshair;touch-action:none"></canvas>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#draw-canvas');
  const wrap = container.querySelector('.draw-canvas-wrap');

  // Size canvas to fill wrap
  const resize = () => {
    canvas.width = wrap.clientWidth || 800;
    canvas.height = Math.round(canvas.width * (600/800));
    redraw();
  };
  resize();
  const resizeObs = new ResizeObserver(resize);
  resizeObs.observe(wrap);

  // Draw events
  const pos = (e) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: ((src.clientX - rect.left) / rect.width * 100),
      y: ((src.clientY - rect.top) / rect.height * 100)
    };
  };

  canvas.addEventListener('mousedown', e => { drawing = true; currentPath = [pos(e)]; });
  canvas.addEventListener('mousemove', e => {
    if (!drawing) return;
    currentPath.push(pos(e));
    redraw();
    drawCurrentPath(canvas.getContext('2d'));
  });
  canvas.addEventListener('mouseup', () => { if (drawing) savePath(); drawing = false; });
  canvas.addEventListener('mouseleave', () => { if (drawing) savePath(); drawing = false; });

  // Touch support
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; currentPath = [pos(e)]; }, {passive:false});
  canvas.addEventListener('touchmove', e => { e.preventDefault(); if (!drawing) return; currentPath.push(pos(e)); redraw(); drawCurrentPath(canvas.getContext('2d')); }, {passive:false});
  canvas.addEventListener('touchend', () => { if (drawing) savePath(); drawing = false; });

  // Firebase listener
  const mapRef = ref(db, `drawings/${mapName}`);
  onChildAdded(mapRef, snap => {
    paths[snap.key] = snap.val();
    redraw();
  });
  onChildRemoved(mapRef, snap => {
    delete paths[snap.key];
    redraw();
  });
  // Load existing paths
  get(mapRef).then(snap => {
    if (snap.exists()) {
      snap.forEach(child => { paths[child.key] = child.val(); });
      redraw();
    }
  });

  window.OLYCITY_DRAW = {
    setColor(c, btn) {
      currentColor = c;
      container.querySelectorAll('.draw-color-btn').forEach(b => b.classList.remove('active'));
      btn?.classList.add('active');
    },
    setSize(v) {
      currentSize = +v;
      container.querySelector('#draw-size-label').textContent = v + 'px';
    },
    undo() {
      // Remove last path by this client — find last key
      const keys = Object.keys(paths);
      if (!keys.length) return;
      const lastKey = keys[keys.length - 1];
      remove(ref(db, `drawings/${mapName}/${lastKey}`));
    },
    clearAll() {
      if (!confirm('Effacer tous les dessins sur cette map ?')) return;
      remove(ref(db, `drawings/${mapName}`));
    }
  };

  function savePath() {
    if (currentPath.length < 2) { currentPath = []; return; }
    const data = {
      points: currentPath,
      color: currentColor,
      size: currentSize,
      author: localStorage.getItem('olycity-profile') || 'guest',
      ts: Date.now()
    };
    push(ref(db, `drawings/${mapName}`), data);
    currentPath = [];
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.values(paths).forEach(p => drawPath(ctx, p, canvas));
  }

  function drawCurrentPath(ctx) {
    if (currentPath.length < 2) return;
    drawPath(ctx, { points: currentPath, color: currentColor, size: currentSize }, canvas);
  }

  function drawPath(ctx, p, canvas) {
    if (!p.points || p.points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(p.points[0].x / 100 * canvas.width, p.points[0].y / 100 * canvas.height);
    for (let i = 1; i < p.points.length; i++) {
      ctx.lineTo(p.points[i].x / 100 * canvas.width, p.points[i].y / 100 * canvas.height);
    }
    ctx.strokeStyle = p.color || '#ff4656';
    ctx.lineWidth = (p.size || 3) * (canvas.width / 800);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}
