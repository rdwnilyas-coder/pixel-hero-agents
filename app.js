/* Pixel office open space — top-down random layout
   Strategi update:
   - Slot assignment di-cache per session_id (TIDAK pindah meja saat refresh)
   - DOM diff update: existing elements di-update, tidak di-recreate
     supaya CSS animations (wiggle, pc-anim, orbit sub-roamer, dll) terus jalan
     tanpa restart
*/
const REFRESH_SEC = 2;
let countdown = REFRESH_SEC;
let knownSubagents = {};
let slotMap = new Map();          // session_id -> slot index (PERSISTEN)
let occupiedSlots = new Set();    // slot indices yang dipakai
let agentMap = new Map();         // session_id -> agent index 0-14 (UNIK)
let usedAgents = new Set();       // agent indices yang dipakai
let staticRendered = false;

/* Room: 30 × 16 tiles @ 48px = 1440 × 768
   ZONE WORK: cols 0-15 (16 tiles wide)
   ZONE LOUNGE: cols 16-29 (14 tiles wide)
   Station footprint: 3 × 4 tiles (144 × 192 px)
*/
const TILE = 48;
/* Room: 30 × 16 tiles
   WORK (cols 0-15) — 7 desks, semua dalam area:
     - 3 standalone (col 1 dan 5)
     - 4 paired vertikal face-to-face (cols 9 & 13)
     - + walkway 5×2 grid putih di kanan-bawah work
   LOUNGE (cols 16-29) — 5 desks, semua di bawah TV:
     - TV 2× lebih besar (8 col × 5 row) di pojok kanan-atas lounge
*/
const SLOTS = [
  // WORK standalone (3) — VERTIKAL LURUS di kolom paling kiri (col 1)
  { x: TILE*1,  y: TILE*1  },
  { x: TILE*1,  y: TILE*6  },
  { x: TILE*1,  y: TILE*11 },
  // WORK 4 desks block — DIPINDAH KE TENGAH (cols 6 & 10), SEJAJAR dengan
  // standalone di col 1 (rows 1 dan 6). Tidak di garis batas col 13/15.
  { x: TILE*6,  y: TILE*1 },     // Baris-1 kiri  (sejajar standalone row 1)
  { x: TILE*10, y: TILE*1 },     // Baris-1 kanan
  { x: TILE*6,  y: TILE*6 },     // Baris-2 kiri  (sejajar standalone row 6)
  { x: TILE*10, y: TILE*6 },     // Baris-2 kanan
  // LOUNGE (5)
  { x: TILE*17, y: TILE*6  },
  { x: TILE*21, y: TILE*6  },
  { x: TILE*17, y: TILE*11 },
  { x: TILE*22, y: TILE*11 },
  { x: TILE*26, y: TILE*11 },
];

/* Lapangan tenis besar hijau — horizontal, kanan-bawah WORK zone. */
const TENNIS = { x: TILE*7, y: TILE*11, w: TILE*6, h: TILE*3 };

/* Dispenser — di area atas WORK zone, antara standalone (col 1) dan pair (col 9) */
const DISPENSER = { x: TILE*5, y: TILE*1, w: TILE, h: TILE*2 };

/* Lounge furniture (lounge-relative coords, lounge starts at room col 16).
   TV menempati lounge cols 5.6-13.6, rows 0.4-5.4 → semua deco DI LUAR area itu.
   Desk lounge (lounge-relative):
     (1, 6), (5, 6), (1, 11), (6, 11), (10, 11)
*/
const LOUNGE_DECO = [
  // Top-LEFT area (away from TV which is on right-top)
  { type: 'painting',     x: TILE*1,  y: TILE*1  },
  { type: 'clock',        x: TILE*3,  y: TILE*1  },
  // Middle-strip antara pair lounge top dan bottom rows
  // Decorative retro TV — di bawah clock (top-left area lounge)
  { type: 'tv-deco',      x: TILE*2,  y: TILE*4  },
  { type: 'sofa-front',   x: TILE*8,  y: TILE*6  },  // between desks
  { type: 'coffee-table', x: TILE*11, y: TILE*7  },
  // Bottom decorations (between bottom desks)
  { type: 'cactus',       x: TILE*4,  y: TILE*15 },
  { type: 'large-plant',  x: TILE*9,  y: TILE*15-50 },  // naik 50px
  { type: 'bookshelf',    x: TILE*13, y: TILE*11 },
];

/* Work zone decorations (non-plant) — pakai kelas .lounge-item utk reuse style. */
const WORK_DECO = [
  // Rak buku di pojok kanan-atas WORK zone (col 13-14, row 1)
  { type: 'bookshelf',    x: TILE*13, y: TILE*1  },
];

/* Tanaman pot di baris bawah WORK zone — MIRIP lounge (mix cactus + dedaunan besar) */
const WORK_BOTTOM_PLANTS = [
  { type: 'cactus',      x: TILE*0,  y: TILE*14 },     // pojok kiri-bawah kaktus
  // (dedaunan besar kiri-bawah dihapus)
  { type: 'plant',       x: TILE*5,  y: TILE*14 },     // kecil antara dispenser & tennis
  { type: 'large-plant', x: TILE*13, y: TILE*13 },     // dedaunan BESAR kanan
  { type: 'cactus',      x: TILE*15, y: TILE*14 },     // pojok kanan-bawah kaktus
];

/* Chess board di lounge — kanan-bawah area kosong (lounge-rel cols 12-13, rows 9-10),
   tidak menimpa coffee-table (11-12, 7-8) atau bookshelf (13-14, 11). */
const CHESS_BOARD = { x: TILE*12 - 100, y: TILE*9, w: TILE*2, h: TILE*2 };

/* Frame foto presiden + wakil presiden Indonesia di dinding atas WORK zone.
   Pakai cols 8-11 row 0 (di antara plant top-tengah dan dispenser). */
const PRESIDENT_FRAMES = [
  { label: 'Presiden', x: TILE*8.5,  y: TILE*0.2, skin: '#a8714a' },   // kulit lebih gelap
  { label: 'Wapres',   x: TILE*10,   y: TILE*0.2, skin: '#e0b48c' },   // kulit lebih terang
];

/* Work zone plants — JANGAN dekat walkway (cols 8-12 rows 13-14).
   Variatif: kombinasi plant kecil, cactus, dan large-plant (dedaunan besar). */
const WORK_PLANTS = [
  { type: 'plant',       x: TILE*0,    y: TILE*5  },   // kiri tengah-atas (kecil)
  { type: 'large-plant', x: TILE*0-100,y: TILE*8  },   // dedaunan BESAR digeser 100px keluar ke kiri
  { type: 'cactus',      x: TILE*15,   y: TILE*5  },   // kanan, kaktus
  { type: 'plant',       x: TILE*3,    y: TILE*0  },   // top kiri (kecil)
  { type: 'cactus',      x: TILE*9-100,y: TILE*0  },   // digeser 100px ke kiri menjauhi foto presiden
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xFFFFFFFF;
  return Math.abs(h);  // bitwise AND di JS treat hasil sebagai signed int
}

function expressionIcon(expr) {
  return { sleeping: '💤', awake: '😊', hard: '💪' }[expr] || '';
}

function getDemoCount() {
  const u = new URL(location.href);
  return parseInt(u.searchParams.get('demo') || '0', 10);
}

/* Demo cache: identitas (id, animal, project) STABIL antar poll supaya slot
   tidak pindah. Properti dinamis (status, sub-agent, age) tetap berubah. */
let _demoCache = null;

function generateDemo(n) {
  const animals = ['🦊','🐢','🐰','🦉','🐱','🐶','🐭','🐸','🦝','🐼','🐧',
                    '🦦','🐹','🐨','🦘','🐯','🐺','🐮','🐷','🐵','🦁','🐔',
                    '🦆','🦅','🐝'];
  const tools = ['Read','Edit','Bash','Grep','Glob','Write','Agent','Task'];
  const subTypes = ['Explore','general-purpose','Plan','claude-code-guide',
                     'statusline-setup','code-reviewer'];
  const projects = ['D--claude','D--claude-mykonten','D--claude-titocrawler',
                     'D--claude-CESAP','D--claude-ibu','D--claude-TamanPintar',
                     'D--claude-socmed','D--claude-pixel'];
  const messages = ['lanjutkan koding','build the dashboard','review kode',
                     'analisa data','generate report','hai claude!'];

  // Init cache identitas sekali
  if (!_demoCache || _demoCache.length !== n) {
    _demoCache = [];
    for (let i = 0; i < n; i++) {
      _demoCache.push({
        id: 'demo-' + i,                        // STABIL
        short_id: ('demo'+i).slice(0,8),
        project: projects[i % projects.length], // STABIL
        animal: animals[i % animals.length],    // STABIL
        n_messages: 50 + Math.floor(Math.random()*8000),
        n_tools: Math.floor(Math.random()*1500),
        first_user_message: messages[i % messages.length],
      });
    }
  }

  const sessions = _demoCache.map((base, i) => {
    // Status/expression bervariasi tiap poll
    const r = Math.random();
    let status, age, expr;
    if (r < 0.3)      { status='active';   age=Math.floor(Math.random()*30);    expr='awake'; }
    else if (r < 0.55){ status='recent';   age=30 + Math.floor(Math.random()*270); expr='awake'; }
    else if (r < 0.8) { status='idle';     age=300 + Math.floor(Math.random()*3000); expr='sleeping'; }
    else              { status='sleeping'; age=3600 + Math.floor(Math.random()*86400); expr='sleeping'; }

    let subTypesByCount = {}, recentTypes = {};
    let nSub = 0;
    if ((status==='active' || status==='recent') && Math.random() < 0.4) {
      const k = 1 + Math.floor(Math.random()*3);
      for (let j=0; j<k; j++) {
        const t = subTypes[Math.floor(Math.random()*subTypes.length)];
        subTypesByCount[t] = (subTypesByCount[t]||0) + 1;
        if (Math.random() < 0.6) recentTypes[t] = (recentTypes[t]||0) + 1;
      }
      nSub = Object.values(subTypesByCount).reduce((a,b)=>a+b,0);
      if (Object.keys(recentTypes).length > 0) expr = 'hard';
    }

    return {
      ...base,
      n_subagents: nSub,
      subagent_types: subTypesByCount,
      recent_subagent_types: recentTypes,
      seconds_since_spawn: Object.keys(recentTypes).length > 0
                            ? Math.floor(Math.random()*200) : null,
      age_seconds: age,
      status,
      expression: expr,
      last_tool: tools[Math.floor(Math.random()*tools.length)],
    };
  });
  return {
    n_sessions: sessions.length,
    n_active: sessions.filter(s=>s.status==='active').length,
    n_recent: sessions.filter(s=>s.status==='recent').length,
    sessions,
  };
}

async function fetchSessions() {
  const demoN = getDemoCount();
  if (demoN > 0) return generateDemo(demoN);
  try {
    const r = await fetch('/api/sessions', { cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } catch (e) { console.error(e); return null; }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function ageLabel(sec) {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec/60) + 'm';
  if (sec < 86400) return Math.floor(sec/3600) + 'h';
  return Math.floor(sec/86400) + 'd';
}

function projectShort(name) {
  let p = name.replace(/^[A-Z]--/, '').replace(/^claude-?/, '');
  return p || name;
}

function renderLoungeDecorations() {
  return LOUNGE_DECO.map(it =>
    `<div class="lounge-item ${it.type}" style="left:${it.x}px; top:${it.y}px;"></div>`
  ).join('');
}

function renderWorkPlants() {
  return WORK_PLANTS.map(p =>
    `<div class="lounge-item ${p.type}" style="left:${p.x}px; top:${p.y}px;"></div>`
  ).join('');
}

function renderWorkDeco() {
  return WORK_DECO.map(it =>
    `<div class="lounge-item ${it.type}" style="left:${it.x}px; top:${it.y}px;"></div>`
  ).join('');
}

function renderWorkBottomPlants() {
  return WORK_BOTTOM_PLANTS.map(p =>
    `<div class="lounge-item ${p.type}" style="left:${p.x}px; top:${p.y}px;"></div>`
  ).join('');
}

function renderChessBoard() {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const fill = (r + c) % 2 ? '#3a2410' : '#e6d4a8';
      cells.push(`<rect x="${c*10}" y="${r*10}" width="10" height="10" fill="${fill}"/>`);
    }
  }
  return `<div class="chess-board" style="left:${CHESS_BOARD.x}px; top:${CHESS_BOARD.y}px;
            width:${CHESS_BOARD.w}px; height:${CHESS_BOARD.h}px;">
    <svg viewBox="-4 -4 88 88" preserveAspectRatio="none" style="width:100%; height:100%; display:block;">
      <!-- Frame kayu -->
      <rect x="-4" y="-4" width="88" height="88" fill="#5a3a18"/>
      <rect x="-2" y="-2" width="84" height="84" fill="#3a2410"/>
      <!-- 8x8 board -->
      ${cells.join('')}
      <!-- Beberapa bidak (putih + hitam) -->
      <circle cx="5" cy="5" r="3" fill="#1a1010"/>      <!-- bidak hitam top-left -->
      <circle cx="75" cy="5" r="3" fill="#1a1010"/>     <!-- top-right -->
      <circle cx="15" cy="15" r="3" fill="#1a1010"/>
      <circle cx="65" cy="65" r="3.5" fill="#fafafa"/>  <!-- bidak putih bottom-right -->
      <circle cx="5" cy="75" r="3" fill="#fafafa"/>     <!-- bottom-left -->
      <circle cx="25" cy="55" r="3" fill="#fafafa"/>
      <circle cx="55" cy="25" r="3" fill="#1a1010"/>
      <!-- Highlight piece (king) -->
      <rect x="35" y="35" width="6" height="6" fill="#fafafa" stroke="#1a1010" stroke-width="1"/>
    </svg>
  </div>`;
}

function renderPresidents() {
  // Setelan + dasi seragam: jas hitam, dasi merah. Bedakan hanya warna kulit + label jabatan.
  const SUIT = '#0d0d0d';
  const HAIR = '#0a0a0a';
  const TIE  = '#c8302a';
  return PRESIDENT_FRAMES.map(p => {
    return `<div class="prez-frame" style="left:${p.x}px; top:${p.y}px;">
      <div class="prez-photo">
        <svg viewBox="0 0 32 36" preserveAspectRatio="xMidYMid meet" style="width:100%; height:100%; display:block; image-rendering:pixelated;">
          <rect x="0" y="0" width="32" height="36" fill="#d4dceb"/>
          <rect x="6" y="24" width="20" height="12" fill="${SUIT}"/>
          <polygon points="14,24 16,30 18,24" fill="#fafafa"/>
          <polygon points="15,28 17,28 16,33" fill="${TIE}"/>
          <rect x="13" y="22" width="6" height="3" fill="${p.skin}"/>
          <rect x="10" y="10" width="12" height="14" fill="${p.skin}"/>
          <rect x="8"  y="14" width="2" height="3" fill="${p.skin}"/>
          <rect x="22" y="14" width="2" height="3" fill="${p.skin}"/>
          <rect x="9"  y="7"  width="14" height="6" fill="${HAIR}"/>
          <rect x="9"  y="6"  width="14" height="2" fill="${HAIR}"/>
          <rect x="8"  y="9"  width="2"  height="4" fill="${HAIR}"/>
          <rect x="22" y="9"  width="2"  height="4" fill="${HAIR}"/>
          <rect x="11" y="13" width="3" height="1" fill="${HAIR}"/>
          <rect x="18" y="13" width="3" height="1" fill="${HAIR}"/>
          <rect x="12" y="15" width="2" height="2" fill="#1a1010"/>
          <rect x="18" y="15" width="2" height="2" fill="#1a1010"/>
          <rect x="15" y="17" width="2" height="2" fill="#a87c5a"/>
          <rect x="13" y="20" width="6" height="1" fill="#7a3a2a"/>
        </svg>
      </div>
      <div class="prez-label">${p.label}</div>
    </div>`;
  }).join('');
}

function renderDispenser() {
  return `<div class="dispenser" style="left:${DISPENSER.x}px; top:${DISPENSER.y}px;
            width:${DISPENSER.w}px; height:${DISPENSER.h}px;">
    <svg viewBox="0 0 48 96" preserveAspectRatio="none"
         style="width:100%; height:100%; display:block;">
      <!-- Galon air biru di atas -->
      <rect x="12" y="4" width="24" height="32" rx="4"
            fill="#7bc6ff" stroke="#3a8bcf" stroke-width="2"
            opacity="0.85"/>
      <!-- Bubble water effect -->
      <circle cx="18" cy="14" r="2" fill="#ffffff" opacity="0.6"/>
      <circle cx="24" cy="22" r="1.5" fill="#ffffff" opacity="0.5"/>
      <circle cx="30" cy="16" r="1.5" fill="#ffffff" opacity="0.6"/>
      <!-- Tutup galon -->
      <rect x="18" y="0" width="12" height="6"
            fill="#2c5a8a" stroke="#1a3a5a" stroke-width="1"/>
      <!-- Body dispenser putih -->
      <rect x="6" y="36" width="36" height="50" rx="2"
            fill="#f0f0f0" stroke="#9090a0" stroke-width="2"/>
      <!-- Panel atas -->
      <rect x="10" y="40" width="28" height="14"
            fill="#d4d4d4" stroke="#9090a0" stroke-width="1"/>
      <!-- Keran panas (merah) + dingin (biru) -->
      <circle cx="18" cy="60" r="3" fill="#e63946"
              stroke="#8c1e2a" stroke-width="1"/>
      <circle cx="30" cy="60" r="3" fill="#4a90e2"
              stroke="#2563a8" stroke-width="1"/>
      <!-- Cup tray -->
      <rect x="10" y="74" width="28" height="6" fill="#a0a0b0"
            stroke="#6a6a7a" stroke-width="0.8"/>
      <!-- Base -->
      <rect x="6" y="84" width="36" height="4" fill="#7a7a8a"/>
    </svg>
  </div>`;
}

function renderTennis() {
  /* Lapangan tenis SVG: rumput hijau + garis putih + net hitam vertikal di tengah */
  return `<div class="tennis" style="left:${TENNIS.x}px; top:${TENNIS.y}px;
            width:${TENNIS.w}px; height:${TENNIS.h}px;">
    <svg viewBox="0 0 288 144" preserveAspectRatio="none"
         style="width:100%; height:100%; display:block;">
      <defs>
        <linearGradient id="grass-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#5fb96d"/>
          <stop offset="50%"  stop-color="#4ca85d"/>
          <stop offset="100%" stop-color="#3a8c4a"/>
        </linearGradient>
        <pattern id="grass-stripe" x="0" y="0" width="36" height="36"
                  patternUnits="userSpaceOnUse">
          <rect width="36" height="18" fill="rgba(255,255,255,0.05)"/>
        </pattern>
        <filter id="court-shadow" x="-5%" y="-5%" width="110%" height="120%">
          <feDropShadow dx="3" dy="5" stdDeviation="2" flood-opacity="0.4"/>
        </filter>
      </defs>
      <!-- Court rumput -->
      <g filter="url(#court-shadow)">
        <rect x="2" y="2" width="284" height="140" rx="2"
              fill="url(#grass-grad)"
              stroke="#2e6e3e" stroke-width="3"/>
        <rect x="2" y="2" width="284" height="140" rx="2"
              fill="url(#grass-stripe)"/>
      </g>
      <!-- Outer baseline -->
      <rect x="14" y="14" width="260" height="116"
            fill="none" stroke="#ffffff" stroke-width="2.5"/>
      <!-- Service line (horizontal di tengah, di antara service-line vertikal) -->
      <line x1="56"  y1="72" x2="232" y2="72"
            stroke="#ffffff" stroke-width="2"/>
      <!-- Service-line vertikal (kiri dan kanan) -->
      <line x1="56"  y1="14"  x2="56"  y2="130"
            stroke="#ffffff" stroke-width="2"/>
      <line x1="232" y1="14"  x2="232" y2="130"
            stroke="#ffffff" stroke-width="2"/>
      <!-- NET vertikal di tengah dengan tiang gelap -->
      <line x1="144" y1="14"  x2="144" y2="130"
            stroke="#ffffff" stroke-width="3"/>
      <!-- Net mesh pattern -->
      <rect x="141" y="14" width="6" height="116"
            fill="rgba(255,255,255,0.6)"
            stroke="#ffffff" stroke-width="0.5"/>
      <!-- Tiang net (atas + bawah) -->
      <rect x="140" y="6"   width="8" height="10" fill="#222"
            stroke="#000" stroke-width="0.5"/>
      <rect x="140" y="128" width="8" height="10" fill="#222"
            stroke="#000" stroke-width="0.5"/>
      <!-- Bola tenis (kuning kecil) di pojok -->
      <circle cx="42" cy="32" r="4" fill="#dfff5f"
              stroke="#a8c54a" stroke-width="0.5"/>
      <!-- Raket 1 (kiri net, lapangan kiri) -->
      <g transform="translate(95, 100) rotate(-30)">
        <ellipse cx="0" cy="-12" rx="11" ry="14"
                 fill="#f0e8d8" stroke="#8b6749" stroke-width="2"/>
        <ellipse cx="0" cy="-12" rx="9" ry="12" fill="#ffffff"
                 stroke="#c8b878" stroke-width="0.8"/>
        <!-- Senar grid -->
        <line x1="-7" y1="-12" x2="7" y2="-12"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-7" y1="-6" x2="7" y2="-6"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-7" y1="-18" x2="7" y2="-18"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="0" y1="-22" x2="0" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-4" y1="-22" x2="-4" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="4" y1="-22" x2="4" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <!-- Gagang -->
        <rect x="-1.5" y="2" width="3" height="18"
              fill="#5a3a1a" stroke="#3a2410" stroke-width="0.5"/>
        <rect x="-2" y="18" width="4" height="4" fill="#3a2410"/>
      </g>
      <!-- Raket 2 (kanan net, lapangan kanan) -->
      <g transform="translate(195, 50) rotate(35)">
        <ellipse cx="0" cy="-12" rx="11" ry="14"
                 fill="#f0e8d8" stroke="#8b6749" stroke-width="2"/>
        <ellipse cx="0" cy="-12" rx="9" ry="12" fill="#ffffff"
                 stroke="#c8b878" stroke-width="0.8"/>
        <line x1="-7" y1="-12" x2="7" y2="-12"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-7" y1="-6" x2="7" y2="-6"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-7" y1="-18" x2="7" y2="-18"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="0" y1="-22" x2="0" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="-4" y1="-22" x2="-4" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <line x1="4" y1="-22" x2="4" y2="-2"
              stroke="#a09078" stroke-width="0.6"/>
        <rect x="-1.5" y="2" width="3" height="18"
              fill="#5a3a1a" stroke="#3a2410" stroke-width="0.5"/>
        <rect x="-2" y="18" width="4" height="4" fill="#3a2410"/>
      </g>
    </svg>
  </div>`;
}


function render(data) {
  const desks = document.getElementById('desks');
  if (!data || !data.sessions) {
    desks.innerHTML = '<div style="padding:40px; text-align:center;">⚠️ /api/sessions failed</div>';
    return;
  }
  document.getElementById('n-total').textContent = data.n_sessions;
  document.getElementById('n-active').textContent = data.n_active;
  document.getElementById('n-recent').textContent = data.n_recent;
  document.getElementById('last-update').textContent =
    new Date().toTimeString().slice(0, 8);

  if (!staticRendered) {
    renderStaticOnce();
    staticRendered = true;
  }

  const sessions = data.sessions.slice(0, SLOTS.length);

  updateStations(sessions);
  updateSubRoamers(data.sessions);
  updateTVLog(sessions);
}

/* Render once: zona-work content, zona-lounge content, lalu compute walkable
   grid berdasarkan posisi objek. Start movement tick untuk sub-roamer. */
function renderStaticOnce() {
  const zoneWork = document.getElementById('zone-work');
  zoneWork.innerHTML =
    '<span class="zone-label">WORK</span>' +
    renderTennis() +
    renderDispenser() +
    renderWorkPlants() +
    renderWorkBottomPlants() +
    renderWorkDeco() +
    renderPresidents();
  const zoneLounge = document.getElementById('zone-lounge');
  zoneLounge.innerHTML =
    '<span class="zone-label">LOUNGE</span>' +
    renderLoungeDecorations() +
    renderChessBoard() +
    renderTVShell();
  // Compute walkable grid + start movement tick (sekali jalan)
  walkableGrid = buildWalkableGrid();
  // Tick 900ms → step discrete yang kelihatan "kaku" tile-by-tile
  setInterval(moveRoamerTick, 900);
}

/* Slot mapping persisten: session_id pernah dapat slot, kekal */
function getSlot(sessionId) {
  if (slotMap.has(sessionId)) return slotMap.get(sessionId);
  // Cari slot kosong pertama
  for (let i = 0; i < SLOTS.length; i++) {
    if (!occupiedSlots.has(i)) {
      slotMap.set(sessionId, i);
      occupiedSlots.add(i);
      return i;
    }
  }
  // Overflow: pakai hash modulo (sessions > SLOTS.length, akan tumpuk)
  const i = hashStr(sessionId) % SLOTS.length;
  slotMap.set(sessionId, i);
  return i;
}
function releaseSlot(sessionId) {
  if (slotMap.has(sessionId)) {
    occupiedSlots.delete(slotMap.get(sessionId));
    slotMap.delete(sessionId);
  }
}

/* Agent assignment UNIK: tiap session dapat 1 dari 15 character pool yang belum dipakai.
   Selama tidak lebih dari 15 session aktif, dijamin tidak ada duplikat. */
function getAgent(sessionId) {
  if (agentMap.has(sessionId)) return agentMap.get(sessionId);
  // Cari index pertama yang belum dipakai (urut by hash supaya stable picks)
  const startIdx = hashStr(sessionId) % 15;
  for (let offset = 0; offset < 15; offset++) {
    const i = (startIdx + offset) % 15;
    if (!usedAgents.has(i)) {
      agentMap.set(sessionId, i);
      usedAgents.add(i);
      return i;
    }
  }
  // Fallback: > 15 sesi aktif, beberapa harus duplikat
  return hashStr(sessionId) % 15;
}
function releaseAgent(sessionId) {
  if (agentMap.has(sessionId)) {
    usedAgents.delete(agentMap.get(sessionId));
    agentMap.delete(sessionId);
  }
}

function cssEscape(s) {
  return CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&');
}

function updateStations(sessions) {
  const desks = document.getElementById('desks');
  const currentIds = new Set();

  for (const s of sessions) {
    currentIds.add(s.id);
    const slotIdx = getSlot(s.id);
    const slot = SLOTS[slotIdx];
    let el = desks.querySelector(`.station[data-id="${cssEscape(s.id)}"]`);
    if (!el) {
      el = createStationDOM(s, slot);
      desks.appendChild(el);
    }
    updateStationAttributes(el, s, slot);
  }

  // Buang station yang session-nya hilang
  desks.querySelectorAll('.station').forEach(el => {
    if (!currentIds.has(el.dataset.id)) {
      releaseSlot(el.dataset.id);
      releaseAgent(el.dataset.id);
      el.remove();
    }
  });
}

function createStationDOM(s, slot) {
  const div = document.createElement('div');
  div.className = 'station';
  div.dataset.id = s.id;
  div.style.left = slot.x + 'px';
  div.style.top = slot.y + 'px';
  // Agent index UNIK per session (pool 15, max 15 session non-duplikat)
  const agentIdx = getAgent(s.id);
  div.innerHTML = `
    <div class="desk-front"></div>
    <div class="pc"></div>
    <div class="worker agent-${agentIdx}">
      <div class="expression-icon"></div>
    </div>
    <div class="cell-label"></div>
    <div class="tooltip"></div>
  `;
  return div;
}

function updateStationAttributes(el, s, slot) {
  const expr = s.expression || 'awake';
  const prevCount = knownSubagents[s.id] || 0;
  const isNewSpawn = s.n_subagents > prevCount;
  knownSubagents[s.id] = s.n_subagents;
  const spawnGlow = (isNewSpawn ||
    (s.seconds_since_spawn !== null && s.seconds_since_spawn < 5));

  // Build class list
  const cls = ['station', `expression-${expr}`];
  if (slot.flipped) cls.push('flipped');
  if (spawnGlow)    cls.push('spawn-glow');
  const newClass = cls.join(' ');
  if (el.className !== newClass) el.className = newClass;

  // Expression icon
  const exprIconEl = el.querySelector('.expression-icon');
  if (exprIconEl) {
    const newIcon = expressionIcon(expr);
    if (exprIconEl.textContent !== newIcon) exprIconEl.textContent = newIcon;
  }

  // Sub-badge
  const recent = s.recent_subagent_types || {};
  const totalRecent = Object.values(recent).reduce((a,b)=>a+b, 0);
  let badgeEl = el.querySelector('.sub-badge');
  if (totalRecent > 0) {
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      badgeEl.className = 'sub-badge';
      el.appendChild(badgeEl);
    }
    const txt = `+${totalRecent}`;
    if (badgeEl.textContent !== txt) badgeEl.textContent = txt;
  } else if (badgeEl) {
    badgeEl.remove();
  }

  // Cell label
  const proj = projectShort(s.project);
  const labelEl = el.querySelector('.cell-label');
  if (labelEl) {
    const newLabel = `${proj.slice(0, 14)} · ${s.short_id}`;
    if (labelEl.textContent !== newLabel) labelEl.textContent = newLabel;
  }

  // Tooltip (update setiap render — info tetap fresh)
  const tooltipEl = el.querySelector('.tooltip');
  if (tooltipEl) {
    const lastTool = s.last_tool || (s.status === 'sleeping' ? 'idle' : '');
    const msg = s.first_user_message || '';
    tooltipEl.innerHTML = `
      <div><b>${escapeHtml(proj)}</b></div>
      <div>id: ${s.short_id}</div>
      <div>msgs: ${s.n_messages} · tools: ${s.n_tools}</div>
      <div>last tool: ${escapeHtml(lastTool)}</div>
      <div>sub-agents: ${s.n_subagents}</div>
      <div>last: ${ageLabel(s.age_seconds)} ago</div>
      ${msg ? `<div style="margin-top:4px;color:var(--orange)">${escapeHtml(msg).slice(0,80)}</div>` : ''}
    `;
  }
}

/* === Walkable grid (computed sekali setelah static rendered) ===
   Sub-roamer pindah 1 tile per 600ms, hindari semua objek. */
const COLS = 30, ROWS = 16;
let walkableGrid = null;

const LOUNGE_ITEM_DIMS = {
  painting:       { w: 1, h: 2 },
  clock:          { w: 1, h: 2 },
  bookshelf:      { w: 2, h: 1 },
  'sofa-front':   { w: 2, h: 1 },
  'sofa-side':    { w: 1, h: 2 },
  'coffee-table': { w: 2, h: 2 },
  cactus:         { w: 1, h: 2 },
  'large-plant':  { w: 2, h: 3 },
  'tv-deco':      { w: 2, h: 2 },
  plant:          { w: 1, h: 2 },
};

function markObstacleTile(grid, col, row, wTile, hTile) {
  for (let c = col; c < col + wTile; c++) {
    for (let r = row; r < row + hTile; r++) {
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) {
        grid[r][c] = false;
      }
    }
  }
}

function buildWalkableGrid() {
  // Default semua walkable
  const grid = Array.from({length: ROWS}, () => Array(COLS).fill(true));

  // Top wall row 0 (decorative wall strip)
  for (let c = 0; c < COLS; c++) grid[0][c] = false;

  // Divider antara zona kerja-lounge di col 15, kecuali door (rows 7-9)
  for (let r = 0; r < ROWS; r++) {
    if (r >= 7 && r <= 9) continue;
    grid[r][15] = false;
  }

  // Stations (worker + desk + PC) — pakai full 3×4 footprint sebagai obstacle
  for (const slot of SLOTS) {
    const col = Math.round(slot.x / TILE);
    const row = Math.round(slot.y / TILE);
    markObstacleTile(grid, col, row, 3, 4);
  }

  // Tennis court
  markObstacleTile(grid,
    Math.round(TENNIS.x / TILE), Math.round(TENNIS.y / TILE),
    Math.round(TENNIS.w / TILE), Math.round(TENNIS.h / TILE));

  // Dispenser
  markObstacleTile(grid,
    Math.round(DISPENSER.x / TILE), Math.round(DISPENSER.y / TILE),
    Math.round(DISPENSER.w / TILE), Math.round(DISPENSER.h / TILE));

  // Work plants — dimensi per type
  for (const p of WORK_PLANTS) {
    const dims = LOUNGE_ITEM_DIMS[p.type] || { w: 1, h: 2 };
    markObstacleTile(grid,
      Math.round(p.x / TILE), Math.round(p.y / TILE), dims.w, dims.h);
  }
  // Work bottom plants
  for (const p of WORK_BOTTOM_PLANTS) {
    const dims = LOUNGE_ITEM_DIMS[p.type] || { w: 1, h: 2 };
    markObstacleTile(grid,
      Math.round(p.x / TILE), Math.round(p.y / TILE), dims.w, dims.h);
  }

  // Work zone deco (bookshelf di pojok kanan-atas, etc.)
  for (const it of WORK_DECO) {
    const dims = LOUNGE_ITEM_DIMS[it.type] || { w: 1, h: 1 };
    markObstacleTile(grid,
      Math.round(it.x / TILE), Math.round(it.y / TILE), dims.w, dims.h);
  }

  // President frames di wall row 0-1 (1.5 tile wide, 2 tile tall)
  for (const p of PRESIDENT_FRAMES) {
    markObstacleTile(grid,
      Math.round(p.x / TILE), Math.round(p.y / TILE), 2, 2);
  }

  // Chess board di lounge (offset col 16)
  markObstacleTile(grid,
    16 + Math.round(CHESS_BOARD.x / TILE),
    Math.round(CHESS_BOARD.y / TILE),
    Math.round(CHESS_BOARD.w / TILE),
    Math.round(CHESS_BOARD.h / TILE));

  // Lounge decorations (positions relative to lounge container, offset col 16)
  const LOUNGE_OFFSET = 16;
  for (const it of LOUNGE_DECO) {
    const dims = LOUNGE_ITEM_DIMS[it.type] || { w: 1, h: 1 };
    const col = LOUNGE_OFFSET + Math.round(it.x / TILE);
    const row = Math.round(it.y / TILE);
    markObstacleTile(grid, col, row, dims.w, dims.h);
  }

  // TV — di pojok kanan-atas lounge.
  // CSS: top: tile*0.4, right: tile*0.4, width: tile*8, height: tile*5
  // Lounge container: left=16*TILE, width=14*TILE
  // TV right edge in room: 16*TILE + 14*TILE - 0.4*TILE = 29.6*TILE
  // TV left edge in room: 29.6 - 8 = 21.6*TILE
  // TV top: 0.4*TILE, bottom: 0.4+5 = 5.4*TILE
  markObstacleTile(grid, 22, 0, 8, 6);  // round up

  return grid;
}

function findWalkableSpawn() {
  for (let i = 0; i < 50; i++) {
    const c = Math.floor(Math.random() * COLS);
    const r = Math.floor(Math.random() * ROWS);
    if (walkableGrid[r][c]) return { col: c, row: r };
  }
  return { col: 1, row: 2 };
}

/* Spawn sub-roamer DI DEKAT meja parent (expanding radius search) */
function findWalkableNear(slotX, slotY) {
  const sCol = Math.round(slotX / TILE);
  const sRow = Math.round(slotY / TILE);
  for (let radius = 1; radius <= 6; radius++) {
    // Iterasi tile di perimeter radius (ring search)
    for (let dc = -radius; dc <= radius; dc++) {
      for (let dr = -radius; dr <= radius; dr++) {
        if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
        const c = sCol + dc;
        const r = sRow + dr;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS
            && walkableGrid[r][c]) {
          return { col: c, row: r };
        }
      }
    }
  }
  return findWalkableSpawn();
}

/* 8-direction movement: cardinal + diagonal. 1 tile per tick. */
const MOVE_DIRS = [
  [-1,  0], [ 1,  0], [ 0, -1], [ 0,  1],   // ↑↓←→
  [-1, -1], [-1,  1], [ 1, -1], [ 1,  1],   // diagonal
];

function moveRoamerTick() {
  const roamers = document.querySelectorAll('.sub-roamer');
  for (const el of roamers) {
    const col = parseInt(el.dataset.col || '0', 10);
    const row = parseInt(el.dataset.row || '0', 10);
    // Shuffle direction supaya variasi
    const dirs = MOVE_DIRS.slice();
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const [dc, dr] of dirs) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS
          && walkableGrid[nr][nc]) {
        el.dataset.col = nc;
        el.dataset.row = nr;
        el.style.left = (nc * TILE) + 'px';
        el.style.top  = (nr * TILE) + 'px';
        break;
      }
    }
  }
}

function updateSubRoamers(allSessions) {
  // Pakai container global di room-inner, bukan zone-lounge,
  // supaya bisa pindah lewat dua zona
  let roamerHost = document.getElementById('roamers');
  if (!roamerHost) {
    const roomInner = document.querySelector('.room-inner');
    roamerHost = document.createElement('div');
    roamerHost.id = 'roamers';
    roamerHost.style.position = 'absolute';
    roamerHost.style.inset = '0';
    roamerHost.style.zIndex = '7';
    roamerHost.style.pointerEvents = 'none';
    roomInner.appendChild(roamerHost);
  }

  const desired = [];
  let total = 0;
  for (const s of allSessions) {
    const recent = s.recent_subagent_types || {};
    const parentSlotIdx = slotMap.get(s.id);
    const parentSlot = parentSlotIdx !== undefined ? SLOTS[parentSlotIdx] : null;
    for (const [type, cnt] of Object.entries(recent)) {
      for (let i = 0; i < cnt && total < 8; i++) {
        desired.push({
          key: `${s.id}|${type}|${i}`,
          type,
          parentId: s.id,
          parentAnimal: s.animal,
          parentChar: getAgent(s.id),       // SAMA dengan parent agent (pool unik)
          parentSlot,
        });
        total++;
      }
      if (total >= 8) break;
    }
    if (total >= 8) break;
  }
  const desiredKeys = new Set(desired.map(d => d.key));

  roamerHost.querySelectorAll('.sub-roamer').forEach(el => {
    if (!desiredKeys.has(el.dataset.key)) el.remove();
  });
  for (const d of desired) {
    const exists = roamerHost.querySelector(
      `.sub-roamer[data-key="${cssEscape(d.key)}"]`);
    if (!exists) {
      const el = document.createElement('div');
      el.className = 'sub-roamer';
      el.dataset.key = d.key;
      el.dataset.type = d.type;
      el.title = `${d.type} (sub of agent-${d.parentChar})`;
      // Sub-agent character index SAMA dengan parent (sub_X.png)
      el.classList.add(`sub-${d.parentChar}`);
      // Spawn DEKAT meja parent (bukan random teleport)
      const spawn = d.parentSlot
        ? findWalkableNear(d.parentSlot.x, d.parentSlot.y)
        : findWalkableSpawn();
      el.dataset.col = spawn.col;
      el.dataset.row = spawn.row;
      el.style.left = (spawn.col * TILE) + 'px';
      el.style.top  = (spawn.row * TILE) + 'px';
      roamerHost.appendChild(el);
    }
  }
}

/* TV frame static (sekali), screen content update setiap poll */
function renderTVShell() {
  return `
    <div class="tv">
      <div class="tv-frame">
        <div class="tv-screen" id="tv-screen"></div>
        <div class="tv-stand"></div>
      </div>
    </div>
  `;
}

function updateTVLog(sessions) {
  const screen = document.getElementById('tv-screen');
  if (!screen) return;

  const logs = sessions
    .map((s, i) => ({
      idx: i,
      age: s.age_seconds,
      proj: projectShort(s.project),
      tool: s.last_tool || 'idle',
      agent: hashStr(s.id) % 15,
      expr: s.expression || 'awake',
      status: s.status,
    }))
    .sort((a, b) => a.age - b.age);
  const visible = logs.slice(0, 13);
  const nHard  = logs.filter(l => l.expr === 'hard').length;
  const nAwake = logs.filter(l => l.expr === 'awake').length;
  const nSleep = logs.filter(l => l.expr === 'sleeping').length;

  const lines = visible.map(l => {
    const t = ageLabel(l.age).padStart(4, ' ');
    const proj = l.proj.slice(0, 10).padEnd(10, ' ');
    const tool = l.tool.slice(0, 12);
    return `<div class="log-line log-${l.expr}"><span class="log-time">${t}</span><span class="log-proj">${escapeHtml(proj)}</span><span class="log-tool">${escapeHtml(tool)}</span></div>`;
  }).join('');

  screen.innerHTML = `
    <div class="log-header">
      ◉ LIVE  ·  <span style="color:#ff6464">●${nHard}</span> <span style="color:#f5d76e">●${nAwake}</span> <span style="color:#7a7a8a">●${nSleep}</span>
    </div>
    <div class="log-cols">
      <span>AGE</span><span>PROJECT</span><span>LAST TOOL</span>
    </div>
    ${lines || '<div style="color:#5a5; font-style:italic;">no recent activity</div>'}
  `;
}

function buildTVHtml(sessions) {
  // Last activity per session, sorted by age (recent first), top 12
  const logs = sessions
    .filter(s => s.last_tool || s.status !== 'sleeping')
    .map(s => ({
      age: s.age_seconds,
      proj: projectShort(s.project).slice(0, 8),
      tool: s.last_tool || 'idle',
      animal: s.animal,
      expr: s.expression,
    }))
    .sort((a, b) => a.age - b.age)
    .slice(0, 12);

  const lines = logs.slice(0, 14).map(l => {
    const t = ageLabel(l.age);
    return `<div class="log-line">
      <span class="log-time">[${t}]</span>
      <span class="log-anim">${l.animal}</span>
      <span class="log-proj">${escapeHtml(l.proj)}</span>
      ›
      <span class="log-tool">${escapeHtml(l.tool)}</span>
    </div>`;
  }).join('');

  return `
    <div class="tv">
      <div class="tv-frame">
        <div class="tv-screen">
          <div style="color:#f5d76e; font-size:11px; margin-bottom:6px; border-bottom:1px solid #2a4a2a; padding-bottom:5px;">
            ◉ LIVE · agent activity feed
          </div>
          ${lines || '<div style="color:#5a5; font-style:italic;">no recent activity</div>'}
        </div>
        <div class="tv-stand"></div>
      </div>
    </div>
  `;
}

async function tick() {
  const data = await fetchSessions();
  if (data) render(data);
}

function startCountdown() {
  const el = document.getElementById('refresh-ctr');
  setInterval(() => {
    countdown -= 1;
    if (countdown <= 0) { tick(); countdown = REFRESH_SEC; }
    if (el) el.textContent = countdown;
  }, 1000);
}

renderCharacterStrips();
tick();
startCountdown();

function renderCharacterStrips() {
  const hero = document.getElementById('hero-strip');
  const sub = document.getElementById('sub-strip');
  if (!hero || !sub) return;
  let heroHtml = '';
  let subHtml = '';
  for (let i = 0; i < 15; i++) {
    heroHtml += `<div class="char-cell"><div class="sprite idx-${i}"></div><span class="idx">${String(i).padStart(2,'0')}</span></div>`;
    subHtml += `<div class="char-cell"><div class="sprite idx-${i}"></div><span class="idx">${String(i).padStart(2,'0')}</span></div>`;
  }
  hero.innerHTML = heroHtml;
  sub.innerHTML = subHtml;
}
