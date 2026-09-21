/* ============================================================================
   Quiz Arena — playing the puzzles

   One board surface serves all four games. Each game contributes three things:
   a fresh state, a way to paint itself, and what a drag across the grid means.
   Everything else — the clock, best times, the level switch, the race strip —
   is shared, so a fifth game would only add those three.

   The grid is a CSS grid whose gaps are the rules; an SVG sits over it on a
   viewBox measured in CELLS, so a stroke at 3.5 is dead centre of the fourth
   cell whatever size the board is drawn at.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, ico, toast, modal, LS, clamp, now, Confetti, Sound, reduced } = Q;
const PZ = Q.Puzzles;

const BEST_KEY = 'qa:pzbest:v1';
const SEEN_KEY = 'qa:pzseen:v1';
const HUES = ['--p0', '--p1', '--p2', '--p3', '--p4', '--p5', '--p6', '--p7', '--p8', '--p9'];
const HUE_HEX = ['#D62650', '#1B5BDB', '#B96A00', '#0B8C5E', '#6E38CE',
                 '#0A7594', '#C2410C', '#A32FB0', '#4F7A0B', '#B01457'];

/* a pale wash of the same hue, mixed here rather than in CSS so the page does
   not depend on color-mix being available */
function wash(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return '#' + [mix(n >> 16 & 255), mix(n >> 8 & 255), mix(n & 255)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

const S = {
  game: 'zip', level: 'medium', number: 1,
  p: null, st: null,
  startedAt: 0, elapsed: 0, timer: 0, running: false, done: false,
  drag: null, race: null, raceEndsAt: 0
};

const clock = ms => {
  const t = Math.max(0, ms) / 1000;
  return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
};
const clockMs = ms => clock(ms) + '.' + String(Math.floor(Math.max(0, ms) % 1000 / 100));

/* ------------------------------------------------------------ best times */
function bests() { return LS.get(BEST_KEY, {}); }
function bestOf(game, level) { return bests()[game + ':' + level] || null; }
function recordBest(game, level, ms) {
  const all = bests(), k = game + ':' + level;
  if (all[k] != null && all[k] <= ms) return false;
  all[k] = ms; LS.set(BEST_KEY, all);
  return true;
}
function seen() { return LS.get(SEEN_KEY, {}); }
function markSeen(game, level, number) {
  const all = seen();
  all[game + ':' + level] = number;
  LS.set(SEEN_KEY, all);
}

/* ==================================================================== hub */
function renderHub() {
  const host = $('#pz-tiles');
  if (!host) return;
  host.innerHTML = PZ.GAMES.map(g => {
    const b = bestOf(g.id, 'medium');
    return '<button class="pz-tile" data-game="' + g.id + '">' +
      '<span class="badge">' + ico(g.icon) + '</span>' +
      '<h3>' + esc(g.name) + '</h3>' +
      '<p>' + g.rule + '</p>' +
      '<span class="best">' + (b ? 'Your best on medium · ' + clockMs(b) : 'No time on the board yet') + '</span>' +
    '</button>';
  }).join('');
  host.querySelectorAll('[data-game]').forEach(el => {
    el.onclick = () => {
      const g = el.dataset.game;
      const n = (seen()[g + ':medium'] || 0) + 1;
      location.hash = '#/puzzle/' + g + '/medium/' + n;
    };
  });
}

/* ================================================================== board */
const gameDef = id => PZ.GAMES.filter(g => g.id === id)[0];

function open(game, level, number) {
  if (!gameDef(game)) game = 'zip';
  if (PZ.LEVELS.indexOf(level) < 0) level = 'medium';
  number = clamp(parseInt(number, 10) || 1, 1, 9999);

  S.game = game; S.level = level; S.number = number;
  S.p = PZ.make(game, level, number);
  S.done = false;
  stopClock();
  S.elapsed = 0; S.startedAt = 0; S.running = false;
  if (!S.race) S.raceEndsAt = 0;
  S.st = S.p ? freshState(S.p) : null;
  if (!S.race) markSeen(game, level, number);

  Q.Host.showScreen('s-puzzle');
  const def = gameDef(game);
  $('#pzb-name').textContent = def.name;
  $('#pzb-num').textContent = level.charAt(0).toUpperCase() + level.slice(1) + ' · #' + number;
  $('#pz-rule').innerHTML = def.rule + hint(game);
  $('#pz-finish').innerHTML = '';
  $('#pz-note').innerHTML = '';
  $('#pz-undo').hidden = game === 'sudoku';

  const best = bestOf(game, level);
  const bp = $('#pz-best');
  bp.hidden = !best;
  if (best) bp.textContent = 'Best ' + clockMs(best);

  renderLevels();
  paintClock();
  paint();
}

function hint(game) {
  const how = {
    zip: ' <b>Drag</b> from 1 to draw the line, or tap the next square. Drag back over it to undo.',
    wend: ' <b>Drag</b> across touching letters to trace a word. Tap a finished word to send it back.',
    patches: ' <b>Drag</b> out from a number to grow its patch. Drag back, or tap a square, to give it up.',
    sudoku: ' Tap a square, then a number &mdash; or use your keyboard.'
  };
  return '<br>' + (how[game] || '');
}

function renderLevels() {
  const host = $('#pz-levels');
  host.innerHTML = PZ.LEVELS.map(l =>
    '<button data-lv="' + l + '"' + (l === S.level ? ' class="on"' : '') + '>' +
    l.charAt(0).toUpperCase() + l.slice(1) + '</button>').join('');
  host.querySelectorAll('[data-lv]').forEach(el => {
    el.onclick = () => {
      if (S.race) { toast('The host picked this level for the race', 'warn'); return; }
      const n = (seen()[S.game + ':' + el.dataset.lv] || 0) + 1;
      location.hash = '#/puzzle/' + S.game + '/' + el.dataset.lv + '/' + n;
    };
  });
}

/* ----------------------------------------------------------------- clock */
/* On a timed race the clock counts the room down; on your own, and once you
   have solved it, it shows the time you took. */
function paintClock() {
  const el = $('#pz-clock');
  if (!el || !el.lastChild) return;
  if (S.raceEndsAt && !S.done) {
    const left = Math.max(0, S.raceEndsAt - now());
    el.lastChild.textContent = clock(left);
    el.classList.toggle('low', left < 15000);
  } else {
    el.classList.remove('low');
    el.lastChild.textContent = clock(elapsed());
  }
}
function elapsed() { return S.running ? S.elapsed + (now() - S.startedAt) : S.elapsed; }
function startClock() {
  if (S.running || S.done) return;
  S.running = true; S.startedAt = now();
  S.timer = setInterval(paintClock, 200);
}
function stopClock() {
  if (S.running) { S.elapsed += now() - S.startedAt; S.running = false; }
  clearInterval(S.timer); S.timer = 0;
}

/* ------------------------------------------------------------ fresh state */
function freshState(p) {
  if (p.game === 'zip') return { path: [] };
  if (p.game === 'wend') return { words: [], live: [] };
  if (p.game === 'patches') return { claim: p.seeds.map(s => [s.cell]), live: -1 };
  return { grid: p.givens.slice(), sel: -1 };
}

/* ================================================================ painting */
function paint() {
  const p = S.p, board = $('#pz-board');
  if (!p) {
    board.innerHTML = '<div class="pz-cells" style="place-items:center;grid-template-columns:1fr">' +
      '<div class="empty-state" style="padding:30px">This board could not be built. Try the next one.</div></div>';
    return;
  }
  const cells = new Array(p.w * p.h);
  for (let i = 0; i < cells.length; i++) cells[i] = { cls: '', html: '', style: '' };
  let svg = '';
  let extra = '';

  if (p.game === 'zip') { svg = paintZip(cells); }
  else if (p.game === 'wend') { svg = paintWend(cells); extra = wendBank(); }
  else if (p.game === 'patches') { svg = paintPatches(cells); }
  else { svg = paintSudoku(cells); extra = sudokuPad(); }

  board.style.setProperty('--n', p.w);
  board.innerHTML =
    '<div class="pz-cells" style="grid-template-columns:repeat(' + p.w + ',minmax(0,1fr));' +
      'grid-template-rows:repeat(' + p.h + ',minmax(0,1fr))">' +
      cells.map((c, i) => '<div class="pz-cell ' + c.cls + '" data-i="' + i + '"' +
        (c.style ? ' style="' + c.style + '"' : '') + '>' + c.html + '</div>').join('') +
    '</div>' +
    '<svg class="pz-svg" viewBox="0 0 ' + p.w + ' ' + p.h + '" preserveAspectRatio="none">' + svg + '</svg>';
  $('#pz-extra').innerHTML = extra;
  if (p.game === 'sudoku') wirePad();
  if (p.game === 'wend') wireBank();
}

/* ---- Zip ---- */
function paintZip(cells) {
  const p = S.p, st = S.st;
  const on = {}; st.path.forEach(c => { on[c] = 1; });
  p.stops.forEach((c, k) => {
    cells[c].html = '<span class="zip-stop">' + (k + 1) + '</span>';
  });
  for (let i = 0; i < cells.length; i++) {
    if (on[i]) cells[i].cls += ' zip-on';
  }
  if (!st.path.length) cells[p.stops[0]].cls += ' zip-first';

  let svg = '';
  /* walls first, so the drawn line runs under them and the barrier reads as
     something the line had to respect */
  p.walls.forEach(k => {
    const ab = k.split(':').map(Number), a = Math.min(ab[0], ab[1]), b = Math.max(ab[0], ab[1]);
    const ar = (a / p.w) | 0, ac = a % p.w;
    if (b === a + 1) svg += line(ac + 1, ar, ac + 1, ar + 1, 'var(--ink)', 0.15);
    else svg += line(ac, ar + 1, ac + 1, ar + 1, 'var(--ink)', 0.15);
  });
  if (st.path.length > 1) {
    const pts = st.path.map(c => ((c % p.w) + 0.5) + ',' + (((c / p.w) | 0) + 0.5)).join(' ');
    svg = '<polyline points="' + pts + '" fill="none" stroke="var(--brand-2)" stroke-width="0.3" ' +
      'stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>' + svg;
  }
  return svg;
}
function line(x1, y1, x2, y2, col, w) {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
    '" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"/>';
}

/* ---- Wend ---- */
function paintWend(cells) {
  const p = S.p, st = S.st;
  p.letters.forEach((ch, i) => { cells[i].html = esc(ch); });
  p.blocked.forEach(i => { cells[i].cls += ' wend-block'; cells[i].html = ''; });

  let svg = '';
  st.words.forEach((wd, k) => {
    const hex = HUE_HEX[k % HUE_HEX.length];
    wd.cells.forEach(c => { cells[c].cls += ' wend-done'; cells[c].style = 'background:' + hex; });
    svg += ribbon(wd.cells, hex, 0.62, 0.24);
  });
  st.live.forEach(c => { cells[c].cls += ' wend-live'; });
  if (st.live.length > 1) svg += ribbon(st.live, '#4B2FE3', 0.5, 0.3);
  return svg;
}
function ribbon(list, col, w, op) {
  const p = S.p;
  const pts = list.map(c => ((c % p.w) + 0.5) + ',' + (((c / p.w) | 0) + 0.5)).join(' ');
  return '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="' + w +
    '" stroke-linecap="round" stroke-linejoin="round" opacity="' + op + '"/>';
}
function wendBank() {
  const p = S.p, st = S.st;
  /* Each found word claims one slot of its length and is then spent — two
     six-letter answers must fill two slots, not print the first one twice. */
  const pool = st.words.map((wd, k) => ({ wd: wd, k: k, spent: false }));
  return '<div class="wend-bank">' + p.lengths.map(L => {
    const hit = pool.filter(x => !x.spent && x.wd.cells.length === L)[0];
    if (!hit) return slot(L, null, 0);
    hit.spent = true;
    return slot(L, hit.wd, hit.k);
  }).join('') + '</div>';
}
function slot(L, wd, k) {
  if (!wd) {
    return '<span class="wend-slot">' + new Array(L + 1).join('<i></i>') + '</span>';
  }
  const hex = HUE_HEX[k % HUE_HEX.length];
  return '<button class="wend-slot filled" data-drop="' + k + '" style="color:' + hex +
    ';background:' + wash(hex, 0.88) + '" title="Send this word back"><b>' + esc(wd.word) + '</b></button>';
}
function wireBank() {
  $$('#pz-extra [data-drop]').forEach(el => {
    el.onclick = () => {
      S.st.words.splice(Number(el.dataset.drop), 1);
      note('');
      paint();
    };
  });
}

/* ---- Patches ---- */
function paintPatches(cells) {
  const p = S.p, st = S.st;
  const owner = ownerMap();
  for (let i = 0; i < cells.length; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const hex = HUE_HEX[o % HUE_HEX.length];
    cells[i].style = 'background:' + wash(hex, st.live === o ? 0.72 : 0.82);
  }
  p.seeds.forEach((s, k) => {
    const hex = HUE_HEX[k % HUE_HEX.length];
    const full = st.claim[k].length === s.n;
    cells[s.cell].html = '<span class="patch-seed" style="background:' + hex +
      (full ? '' : ';opacity:.86') + '">' + s.n + '</span>';
    cells[s.cell].style = 'background:' + wash(hex, st.live === k ? 0.66 : 0.78);
  });
  if (st.live >= 0) cells[st.claim[st.live][st.claim[st.live].length - 1]].cls += ' patch-live';

  /* outline each patch where it meets something else, so a grown patch reads
     as one shape rather than a run of tinted squares */
  let svg = '';
  for (let i = 0; i < cells.length; i++) {
    const o = owner[i];
    if (o < 0) continue;
    const hex = HUE_HEX[o % HUE_HEX.length];
    const r = (i / p.w) | 0, c = i % p.w;
    if (r === 0 || owner[i - p.w] !== o) svg += line(c, r, c + 1, r, hex, 0.062);
    if (r === p.h - 1 || owner[i + p.w] !== o) svg += line(c, r + 1, c + 1, r + 1, hex, 0.062);
    if (c === 0 || owner[i - 1] !== o) svg += line(c, r, c, r + 1, hex, 0.062);
    if (c === p.w - 1 || owner[i + 1] !== o) svg += line(c + 1, r, c + 1, r + 1, hex, 0.062);
  }
  return svg;
}
function ownerMap() {
  const n = S.p.w * S.p.h, owner = new Array(n).fill(-1);
  S.st.claim.forEach((cs, k) => cs.forEach(c => { owner[c] = k; }));
  return owner;
}

/* ---- Mini Sudoku ---- */
function paintSudoku(cells) {
  const p = S.p, st = S.st;
  const bad = sudokuClashes(st.grid);
  for (let i = 0; i < 36; i++) {
    const v = st.grid[i];
    cells[i].html = v ? String(v) : '';
    if (p.givens[i]) cells[i].cls += ' sud-given';
    else if (v) cells[i].cls += ' sud-mine';
    if (st.sel === i) cells[i].cls += ' sud-sel';
    else if (st.sel >= 0 && peers(st.sel, i)) cells[i].cls += ' sud-peer';
    if (bad[i]) cells[i].cls += ' sud-clash';
  }
  /* the bold box rules, drawn over the light grid so a box reads as a unit */
  let svg = '';
  svg += line(3, 0, 3, 6, 'var(--ink-2)', 0.035);
  for (let r = 2; r < 6; r += 2) svg += line(0, r, 6, r, 'var(--ink-2)', 0.035);
  return svg;
}
const sudBox = i => ((((i / 6) | 0) / 2) | 0) * 2 + (((i % 6) / 3) | 0);
const peers = (a, b) => a !== b && ((a / 6 | 0) === (b / 6 | 0) || a % 6 === b % 6 || sudBox(a) === sudBox(b));
function sudokuClashes(g) {
  const bad = new Array(36).fill(false);
  for (let i = 0; i < 36; i++) {
    if (!g[i]) continue;
    for (let j = 0; j < 36; j++) if (g[j] === g[i] && peers(i, j)) { bad[i] = true; break; }
  }
  return bad;
}
function sudokuPad() {
  const used = new Array(7).fill(0);
  S.st.grid.forEach(v => { if (v) used[v]++; });
  return '<div class="sud-pad">' +
    [1, 2, 3, 4, 5, 6].map(v =>
      '<button data-num="' + v + '"' + (used[v] >= 6 ? ' class="spent"' : '') + '>' + v + '</button>').join('') +
    '<button class="clear" data-num="0">Clear</button></div>';
}
function wirePad() {
  $$('#pz-extra [data-num]').forEach(el => {
    el.onclick = () => setDigit(Number(el.dataset.num));
  });
}
function setDigit(v) {
  const st = S.st;
  if (st.sel < 0 || S.p.givens[st.sel] || S.done) return;
  startClock();
  st.grid[st.sel] = v;
  paint(); settle();
}

/* ============================================================ interaction */
function cellAt(ev) {
  const p = S.p, board = $('#pz-board');
  if (!p || !board) return -1;
  const r = board.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * p.w);
  const y = Math.floor((ev.clientY - r.top) / r.height * p.h);
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return -1;
  return y * p.w + x;
}
const adjacent = (a, b) => {
  const p = S.p;
  return (a % p.w === b % p.w && Math.abs(a - b) === p.w) ||
         ((a / p.w | 0) === (b / p.w | 0) && Math.abs(a - b) === 1);
};

function down(ev) {
  if (!S.p || S.done) return;
  const c = cellAt(ev);
  if (c < 0) return;
  ev.preventDefault();
  const board = $('#pz-board');
  if (board.setPointerCapture) { try { board.setPointerCapture(ev.pointerId); } catch (e) {} }
  S.drag = { last: -1 };
  startClock();
  if (S.p.game === 'zip') zipDown(c);
  else if (S.p.game === 'wend') wendDown(c);
  else if (S.p.game === 'patches') patchDown(c);
  else sudokuDown(c);
  S.drag.last = c;
}
function move(ev) {
  if (!S.drag || !S.p || S.done) return;
  const c = cellAt(ev);
  if (c < 0 || c === S.drag.last) return;
  S.drag.last = c;
  if (S.p.game === 'zip') zipTo(c);
  else if (S.p.game === 'wend') wendTo(c);
  else if (S.p.game === 'patches') patchTo(c);
}
function up() {
  if (!S.drag) return;
  S.drag = null;
  if (!S.p || S.done) return;
  if (S.p.game === 'wend') wendCommit();
  else if (S.p.game === 'patches') { S.st.live = -1; paint(); }
}

/* ---- Zip ---- */
function zipDown(c) {
  const st = S.st, p = S.p;
  const at = st.path.indexOf(c);
  if (at >= 0) { st.path.length = at + 1; paint(); return; }
  if (!st.path.length) {
    if (c === p.stops[0]) { st.path.push(c); paint(); }
    else note('Start on the square marked 1.', 'bad');
    return;
  }
  zipTo(c);
}
function zipTo(c) {
  const st = S.st, p = S.p;
  const at = st.path.indexOf(c);
  if (at >= 0) { if (at !== st.path.length - 1) { st.path.length = at + 1; paint(); } return; }
  const tail = st.path[st.path.length - 1];
  if (tail == null || !adjacent(tail, c)) return;
  if (p.walls.indexOf(PZ.edgeKey(tail, c)) >= 0) { note('A wall blocks that side.', 'bad'); return; }
  const k = p.stops.indexOf(c);
  if (k >= 0) {
    const hitSoFar = st.path.filter(x => p.stops.indexOf(x) >= 0).length;
    if (k !== hitSoFar) { note('Number ' + (hitSoFar + 1) + ' comes next.', 'bad'); return; }
  }
  st.path.push(c);
  note('');
  paint(); settle();
}

/* ---- Wend ---- */
function usedCells() {
  const on = {};
  S.p.blocked.forEach(c => { on[c] = 1; });
  S.st.words.forEach(w => w.cells.forEach(c => { on[c] = 1; }));
  return on;
}
function wendDown(c) {
  const st = S.st;
  const owner = st.words.filter(w => w.cells.indexOf(c) >= 0)[0];
  if (owner) { st.words.splice(st.words.indexOf(owner), 1); note(''); paint(); return; }
  if (usedCells()[c]) return;
  st.live = [c];
  paint();
}
function wendTo(c) {
  const st = S.st;
  if (!st.live.length) { wendDown(c); return; }
  const at = st.live.indexOf(c);
  if (at >= 0) { if (at !== st.live.length - 1) { st.live.length = at + 1; paint(); } return; }
  const tail = st.live[st.live.length - 1];
  if (!adjacent(tail, c) || usedCells()[c]) return;
  st.live.push(c);
  paint();
}
function wendCommit() {
  const st = S.st, p = S.p;
  const cells = st.live;
  st.live = [];
  if (cells.length < 2) { paint(); return; }
  const left = p.lengths.slice();
  st.words.forEach(w => { const i = left.indexOf(w.cells.length); if (i >= 0) left.splice(i, 1); });
  if (left.indexOf(cells.length) < 0) {
    note('No ' + cells.length + '-letter word is left to find.', 'bad');
    Sound.wrong(); paint(); return;
  }
  const word = PZ.wendWord(p, cells);
  if (!PZ.isWord(word)) {
    note('“' + word + '” is not a word I know.', 'bad');
    Sound.wrong(); paint(); return;
  }
  st.words.push({ cells: cells, word: word.toUpperCase() });
  note(word.toUpperCase() + ' — nice.', 'good');
  Sound.right();
  paint(); settle();
}

/* ---- Patches ---- */
function patchDown(c) {
  const st = S.st, p = S.p;
  const seedAt = p.seeds.map(s => s.cell).indexOf(c);
  if (seedAt >= 0) { st.live = seedAt; paint(); return; }
  const owner = ownerMap()[c];
  if (owner >= 0) {
    /* tapping a claimed square gives back everything from there on */
    const at = st.claim[owner].indexOf(c);
    st.claim[owner].length = at;
    st.live = owner;
    note(''); paint(); return;
  }
  st.live = -1;
  paint();
}
function patchTo(c) {
  const st = S.st, p = S.p;
  if (st.live < 0) return;
  const mine = st.claim[st.live];
  if (mine.length > 1 && c === mine[mine.length - 2]) { mine.pop(); paint(); return; }
  if (mine.indexOf(c) >= 0) return;
  if (ownerMap()[c] >= 0) return;
  if (mine.length >= p.seeds[st.live].n) { note('That patch is already ' + p.seeds[st.live].n + ' squares.', 'bad'); return; }
  if (!mine.some(x => adjacent(x, c))) return;
  mine.push(c);
  note('');
  paint(); settle();
}

/* ---- Sudoku ---- */
function sudokuDown(c) {
  const st = S.st;
  st.sel = S.p.givens[c] ? -1 : c;
  paint();
}

/* ================================================================= finish */
function note(msg, kind) {
  const el = $('#pz-note');
  if (!el) return;
  el.className = 'pz-note' + (kind ? ' ' + kind : '');
  el.innerHTML = msg ? (kind === 'bad' ? ico('alert') : kind === 'good' ? ico('check-circle') : '') +
    '<span>' + esc(msg) + '</span>' : '';
}

function settle() {
  if (S.done || !S.p) return;
  const state = S.p.game === 'zip' ? S.st.path
              : S.p.game === 'wend' ? S.st.words.map(w => w.cells)
              : S.p.game === 'patches' ? ownerMap()
              : S.st.grid;
  if (!PZ.check(S.p, state)) return;
  finish();
}

function finish() {
  stopClock();
  S.done = true;
  const ms = elapsed();
  const improved = recordBest(S.game, S.level, ms);
  note('');
  Sound.win();
  if (!reduced()) Confetti.fire(2200);

  $('#pz-finish').innerHTML =
    '<div class="pz-done"><span class="em">' + ico('check') + '</span>' +
      '<div style="flex:1;min-width:0"><b>Solved</b>' +
      '<div class="dim" style="font-size:13px">' +
        (improved ? 'A new best on ' + S.level + '.' : 'Your best is ' + clockMs(bestOf(S.game, S.level)) + '.') +
      '</div></div>' +
      '<span class="t">' + clockMs(ms) + '</span>' +
    '</div>';
  const bp = $('#pz-best');
  bp.hidden = false;
  bp.textContent = 'Best ' + clockMs(bestOf(S.game, S.level));
  if (S.race && S.race.onSolved) {
    S.race.onSolved(ms);
    note('Sent to the host — hold tight for the rest of the room.', 'good');
  }
}

/* ------------------------------------------------------------------ undo */
function undo() {
  if (S.done || !S.st) return;
  const g = S.p.game;
  if (g === 'zip' && S.st.path.length) S.st.path.pop();
  else if (g === 'wend') {
    if (S.st.live.length) S.st.live.pop();
    else if (S.st.words.length) S.st.words.pop();
  } else if (g === 'patches') {
    for (let k = S.st.claim.length - 1; k >= 0; k--) {
      if (S.st.claim[k].length > 1) { S.st.claim[k].pop(); break; }
    }
  }
  note('');
  paint();
}

function reset() {
  if (!S.p) return;
  S.st = freshState(S.p);
  S.done = false;
  /* clearing the board in a race must not clear the clock — the host is timing
     from when the round opened, and starting again does not buy time back */
  if (!S.race) {
    stopClock();
    S.elapsed = 0; S.startedAt = 0;
  }
  $('#pz-finish').innerHTML = '';
  note('');
  paintClock();
  paint();
}

/* =================================================================== race */
/* A race is the same board opened from a host's room instead of the hub. This
   screen knows nothing about rooms: it is handed a board to build, a snapshot
   to draw the standings from, and one callback to fire when it is solved. The
   host does the official timing — the clock here is the player's own. */
function startRace(opts) {
  S.race = opts;
  $('#s-puzzle').classList.add('racing');
  open(opts.game, opts.level, opts.number);
  S.raceEndsAt = opts.endsIn ? now() + opts.endsIn : 0;
  startClock();                      /* everyone started when the host said go */
  paintClock();                      /* show the deadline now, not a tick later */
  raceSnapshot(opts.snap, opts.meId, opts.endsIn);
}

function stopRace() {
  S.race = null;
  S.raceEndsAt = 0;
  stopClock();
  $('#s-puzzle').classList.remove('racing');
  $('#pz-race').innerHTML = '';
}

function raceSnapshot(snap, meId, endsIn) {
  const host = $('#pz-race');
  if (!host || !snap || !snap.pz) return;
  /* re-anchor to the host's countdown so a slow device does not drift */
  if (endsIn) S.raceEndsAt = now() + endsIn;
  const done = (snap.pz.board || []).length;
  const room = (snap.players || []).filter(p => p.connected).length;
  host.innerHTML =
    '<div class="pz-race">' +
      '<div class="hd">' + ico('bolt') +
        '<span>' + done + ' of ' + room + ' solved</span></div>' +
      Q.Views.pzBoardHTML(snap, meId) +
    '</div>';
}

/* =================================================================== boot */
function init() {
  const board = $('#pz-board');
  if (!board) return;
  board.addEventListener('pointerdown', down);
  board.addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  $('#pz-home').onclick = () => { location.hash = '#/'; };
  $('#pzb-back').onclick = () => {
    if (S.race) { Q.Host.showScreen('s-play'); return; }
    location.hash = '#/puzzles';
  };
  $('#pz-how').onclick = howPuzzles;
  $('#pz-reset').onclick = reset;
  $('#pz-undo').onclick = undo;
  $('#pz-prev').onclick = () => {
    if (S.race) { toast('The host chooses the board in a race', 'warn'); return; }
    location.hash = '#/puzzle/' + S.game + '/' + S.level + '/' + Math.max(1, S.number - 1);
  };
  $('#pz-next').onclick = () => {
    if (S.race) { toast('The host chooses the board in a race', 'warn'); return; }
    location.hash = '#/puzzle/' + S.game + '/' + S.level + '/' + (S.number + 1);
  };

  addEventListener('keydown', e => {
    if (!$('#s-puzzle').classList.contains('on')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-6]$/.test(e.key) && S.p && S.p.game === 'sudoku') { setDigit(Number(e.key)); e.preventDefault(); }
    else if ((e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') && S.p && S.p.game === 'sudoku') {
      setDigit(0); e.preventDefault();
    } else if (e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
  });
}

function howPuzzles() {
  modal(
    '<h2 style="font-size:23px">The four puzzles</h2>' +
    '<div class="col" style="gap:13px;margin-top:14px">' +
    PZ.GAMES.map(g =>
      '<div class="row" style="align-items:flex-start;gap:11px">' +
        '<span class="badge" style="width:34px;height:34px;border-radius:11px;display:grid;place-items:center;' +
          'background:var(--brand-soft);color:var(--brand);flex:none">' + ico(g.icon) + '</span>' +
        '<div><b style="font-size:14.5px">' + esc(g.name) + '</b>' +
        '<p class="dim" style="font-size:13px;line-height:1.55;margin-top:3px">' + g.rule + '</p></div>' +
      '</div>').join('') +
    '</div>' +
    '<div class="card tight" style="margin-top:15px"><b style="font-size:13.5px">Boards are made, not stored</b>' +
      '<p class="dim" style="font-size:13px;margin-top:6px;line-height:1.6">Every board is generated from its number, ' +
      'so puzzle 42 is the same board on every device &mdash; which is how a race works without sending a grid ' +
      'to anybody. Zip and Mini Sudoku are checked to have exactly one answer before you see them. Wend and ' +
      'Patches accept any arrangement that fits the rules, so a second way through still counts.</p></div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" data-close>Got it</button></div>');
}

Q.PuzzleUI = {
  init: init, open: open, renderHub: renderHub,
  startRace: startRace, stopRace: stopRace, raceSnapshot: raceSnapshot,
  reset: reset, state: S
};
})();
