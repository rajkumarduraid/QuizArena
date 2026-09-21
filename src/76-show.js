/* ============================================================================
   Quiz Arena — the big screen

   One machine, one projector, nobody signing in. There is no room, no code, no
   players and no score: the room calls something out, the host clicks it, and
   the screen answers. Three tools share the surface:

     Pick a number  — the questions sit behind shuffled tiles
     Spin the wheel — a random name out of a list you keep
     Reveal a picture — a photo uncovered a piece at a time

   Everything is local to this browser. Nothing here touches the transport, so
   it works from a downloaded file, on a locked-down laptop, offline.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, ico, toast, modal, LS, clamp, shape, ACOLORS, reduced } = Q;

const KEY = 'qa:show:v1';
const HUES = ['#D62650', '#1B5BDB', '#B96A00', '#0B8C5E', '#6E38CE',
              '#0A7594', '#C2410C', '#A32FB0', '#4F7A0B', '#B01457'];

const TOOLS = [
  { id: 'numbers', name: 'Pick a number' },
  { id: 'wheel', name: 'Spin the wheel' },
  { id: 'reveal', name: 'Reveal a picture' }
];

const SH = {
  tool: 'numbers',
  sig: '',
  order: [],            /* tile position -> index into the question list */
  used: Object.create(null),
  at: -1,               /* question on screen, or -1 for the board */
  shown: false,         /* has the answer been given away yet */
  names: [],
  rot: 0, spinning: false, winner: -1,
  pic: -1, gone: Object.create(null)
};

/* Puzzle rounds need a room to race in, so the big screen only deals in
   questions. */
const questions = () => (Q.Build.getConfig().questions || []).filter(q => q.kind !== 'pz');
const pictures = () => questions().filter(q => q.image);

function store() {
  LS.set(KEY, { sig: SH.sig, order: SH.order, used: SH.used, names: SH.names, tool: SH.tool });
}

/* The board is shuffled once per quiz and then kept, so a stray reload in the
   middle of a session does not hand out the same question twice. */
function load() {
  const qs = questions();
  const sig = qs.map(q => q.id).join('|');
  const saved = LS.get(KEY, null);
  SH.names = (saved && Array.isArray(saved.names)) ? saved.names : [];
  if (saved && TOOLS.some(t => t.id === saved.tool)) SH.tool = saved.tool;
  if (saved && saved.sig === sig && Array.isArray(saved.order) && saved.order.length === qs.length) {
    SH.sig = sig; SH.order = saved.order.slice();
    SH.used = saved.used || Object.create(null);
    return;
  }
  reshuffle(sig, qs.length);
}
function reshuffle(sig, n) {
  SH.sig = sig;
  SH.order = [];
  for (let i = 0; i < n; i++) SH.order.push(i);
  for (let i = SH.order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = SH.order[i]; SH.order[i] = SH.order[j]; SH.order[j] = t;
  }
  SH.used = Object.create(null);
  store();
}

/* ==================================================================== shell */
function open(tool) {
  load();
  if (tool && TOOLS.some(t => t.id === tool)) SH.tool = tool;
  SH.at = -1; SH.shown = false; SH.pic = -1;
  Q.Host.showScreen('s-show');
  const cfg = Q.Build.getConfig();
  $('#show-title').textContent = cfg.title || 'Untitled quiz';
  paintTools();
  render();
}

function paintTools() {
  const host = $('#show-tools');
  host.innerHTML = TOOLS.map(t =>
    '<button data-tool="' + t.id + '"' + (t.id === SH.tool ? ' class="on"' : '') + '>' +
    esc(t.name) + '</button>').join('');
  host.querySelectorAll('[data-tool]').forEach(el => {
    el.onclick = () => {
      SH.tool = el.dataset.tool;
      SH.at = -1; SH.shown = false; SH.pic = -1; SH.winner = -1;
      store(); paintTools(); render();
    };
  });
}

function render() {
  const stage = $('#show-stage');
  if (!stage) return;
  if (SH.tool === 'wheel') { renderWheel(stage); return; }
  if (SH.tool === 'reveal') { renderReveal(stage); return; }
  renderNumbers(stage);
}

function empty(stage, msg, cta) {
  stage.innerHTML =
    '<div class="card center" style="width:min(560px,100%);margin-inline:auto;padding:40px 24px">' +
      '<p style="font-size:17px;font-weight:650">' + esc(msg) + '</p>' +
      (cta ? '<p class="dim" style="font-size:14px;margin-top:8px">' + cta + '</p>' : '') +
      '<button class="btn primary" id="show-go-build" style="margin-top:16px">Write some questions</button>' +
    '</div>';
  $('#show-go-build').onclick = () => { location.hash = '#/host'; };
}

/* =========================================================== pick a number */
function renderNumbers(stage) {
  const qs = questions();
  if (!qs.length) { empty(stage, 'There are no questions yet', 'The board puts one behind each number.'); return; }
  if (SH.at >= 0) { renderQuestion(stage, qs[SH.at]); return; }

  const left = SH.order.filter(qi => !SH.used[qi]).length;
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(qs.length))));
  const rows = Math.ceil(qs.length / cols);
  stage.innerHTML =
    '<div class="show-head">' +
      '<h1>Pick a number</h1>' +
      '<p>' + (left ? 'Someone call one out.' : 'Every number has been opened.') + '</p>' +
    '</div>' +
    '<div class="pick-grid big" style="--cols:' + cols + ';--rows:' + rows + '">' +
      SH.order.map((qi, k) => {
        const done = !!SH.used[qi];
        return '<button class="pick-tile' + (done ? ' done' : '') + '" type="button"' +
          (done ? ' disabled' : ' data-n="' + k + '"') +
          ' aria-label="Number ' + (k + 1) + (done ? ', already opened' : '') + '">' +
          '<span class="n">' + (k + 1) + '</span>' +
          (done ? '<span class="sub">opened</span>' : '') +
        '</button>';
      }).join('') +
    '</div>' +
    (left ? '' :
      '<div class="show-actions"><button class="btn primary" id="show-again">' +
        ico('refresh') + 'Shuffle and start over</button></div>');

  stage.querySelectorAll('[data-n]').forEach(el => {
    el.onclick = () => {
      SH.at = SH.order[Number(el.dataset.n)];
      SH.shown = false;
      SH.used[SH.at] = 1;
      store();
      render();
    };
  });
  const again = $('#show-again');
  if (again) again.onclick = startOver;
}

function renderQuestion(stage, q) {
  const tile = SH.order.indexOf(SH.at) + 1;
  const one = q.options.length <= 2 && q.options.join('').length > 40;
  stage.innerHTML =
    '<div class="show-q">' +
      '<span class="qno">Number ' + tile + '</span>' +
      (q.image ? '<img class="show-img" src="' + esc(q.image) + '" alt="">' : '') +
      '<h2 class="show-text">' + esc(q.text) + '</h2>' +
      '<div class="show-answers' + (one ? ' one-col' : '') + (SH.shown ? ' revealed' : '') + '">' +
        q.options.map((o, i) =>
          '<div class="show-ans' + (SH.shown && i === q.correct ? ' right' : '') +
            '" style="background:' + ACOLORS[i] + '">' +
            '<span class="shape">' + shape(i) + '</span><span>' + esc(o) + '</span></div>').join('') +
      '</div>' +
      '<div class="show-actions">' +
        '<button class="btn ghost" id="show-back">' + ico('arrow-left') + 'Back to the board</button>' +
        (SH.shown
          ? '<button class="btn primary" id="show-next">Next number' + ico('arrow-right') + '</button>'
          : '<button class="btn go" id="show-reveal">' + ico('eye') + 'Show the answer</button>') +
      '</div>' +
    '</div>';
  $('#show-back').onclick = () => { SH.at = -1; SH.shown = false; render(); };
  const rev = $('#show-reveal');
  if (rev) rev.onclick = () => { SH.shown = true; Q.Sound.right(); render(); };
  const nxt = $('#show-next');
  if (nxt) nxt.onclick = () => { SH.at = -1; SH.shown = false; render(); };
}

function startOver() {
  const qs = questions();
  reshuffle(qs.map(q => q.id).join('|'), qs.length);
  SH.at = -1; SH.shown = false; SH.pic = -1; SH.gone = Object.create(null);
  render();
  toast('Board shuffled', 'ok');
}

/* ========================================================== spin the wheel */
function wheelNames() {
  if (SH.names.length) return SH.names;
  const teams = (Q.Build.getConfig().teams || []).map(t => t.name).filter(Boolean);
  return teams.length ? teams : ['Add some names'];
}

function renderWheel(stage) {
  const items = wheelNames();
  stage.innerHTML =
    '<div class="show-head"><h1>Spin the wheel</h1>' +
      '<p>' + items.length + ' on the wheel &mdash; whoever it lands on is up.</p></div>' +
    '<div class="wheel-wrap">' +
      '<div class="wheel-hold">' +
        '<div class="wheel-pin"></div>' +
        '<svg id="wheel-svg" viewBox="-104 -104 208 208" style="transform:rotate(' + SH.rot + 'deg)">' +
          wheelFace(items) + '</svg>' +
        '<div class="wheel-hub"></div>' +
      '</div>' +
      '<div class="wheel-out' + (SH.winner >= 0 ? ' on' : '') + '">' +
        (SH.winner >= 0 ? esc(items[SH.winner]) : '') + '</div>' +
      '<div class="show-actions">' +
        '<button class="btn go xl" id="wheel-spin"' + (items.length < 2 ? ' disabled' : '') + '>Spin</button>' +
        '<button class="btn ghost" id="wheel-edit">' + ico('sliders') + 'Edit the names</button>' +
      '</div>' +
    '</div>';
  $('#wheel-spin').onclick = spin;
  $('#wheel-edit').onclick = editNames;
}

function wheelFace(items) {
  const n = items.length, R = 100;
  const size = n <= 6 ? 11 : n <= 10 ? 8.5 : n <= 16 ? 6.5 : 5;
  let out = '<circle cx="0" cy="0" r="102" fill="#fff"/>';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = (R * Math.cos(a0)).toFixed(2), y0 = (R * Math.sin(a0)).toFixed(2);
    const x1 = (R * Math.cos(a1)).toFixed(2), y1 = (R * Math.sin(a1)).toFixed(2);
    const big = (a1 - a0) > Math.PI ? 1 : 0;
    out += '<path d="M0,0 L' + x0 + ',' + y0 + ' A' + R + ',' + R + ' 0 ' + big + ' 1 ' + x1 + ',' + y1 +
           ' Z" fill="' + HUES[i % HUES.length] + '" stroke="#fff" stroke-width="0.8"/>';
    const am = (a0 + a1) / 2;
    const lx = (R * 0.63 * Math.cos(am)), ly = (R * 0.63 * Math.sin(am));
    const label = String(items[i]).slice(0, 18);
    /* Text laid along the radius reads upside down on the left half of the
       wheel, so flip those by half a turn. Anchored in the middle, a flip
       leaves the label exactly where it was and simply the right way up. */
    let deg = ((am * 180 / Math.PI) % 360 + 360) % 360;
    if (deg > 90 && deg < 270) deg -= 180;
    out += '<text x="' + lx.toFixed(2) + '" y="' + ly.toFixed(2) + '" fill="#fff" font-size="' + size +
           '" font-weight="700" text-anchor="middle" dominant-baseline="central" ' +
           'transform="rotate(' + deg.toFixed(2) + ' ' + lx.toFixed(2) + ' ' + ly.toFixed(2) + ')">' +
           esc(label) + '</text>';
  }
  return out;
}

/* The winner is drawn first and the wheel is then turned to put it under the
   pin — which is the only way to be sure the pointer and the announcement can
   never disagree. */
function spin() {
  const items = wheelNames();
  if (items.length < 2 || SH.spinning) return;
  const n = items.length;
  const k = Math.floor(Math.random() * n);
  let target = -(k + 0.5) * 360 / n;
  const turns = 4 + Math.floor(Math.random() * 3);
  while (target < SH.rot + turns * 360) target += 360;
  SH.rot = target;
  SH.winner = -1;

  const el = $('#wheel-svg');
  const out = $('.wheel-out');
  out.textContent = '';
  out.classList.remove('on');
  if (reduced()) {
    el.style.transition = 'none';
    el.style.transform = 'rotate(' + SH.rot + 'deg)';
    land(k, items);
    return;
  }
  SH.spinning = true;
  $('#wheel-spin').disabled = true;
  el.style.transition = 'transform 4.4s cubic-bezier(.16,.74,.18,1)';
  el.style.transform = 'rotate(' + SH.rot + 'deg)';
  setTimeout(() => { SH.spinning = false; $('#wheel-spin').disabled = false; land(k, items); }, 4500);
}
function land(k, items) {
  SH.winner = k;
  const out = $('.wheel-out');
  if (out) { out.textContent = items[k]; out.classList.add('on'); }
  Q.Sound.right();
  if (!reduced()) Q.Confetti.fire(1400);
}

function editNames() {
  modal(
    '<h2 style="font-size:22px">Who is on the wheel?</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">One per line. Names, teams, topics, forfeits &mdash; ' +
    'whatever you want it to land on.</p>' +
    '<textarea class="inp" id="wn" rows="9" style="margin-top:13px;font-family:var(--mono);font-size:14px" ' +
    'placeholder="Priya&#10;Ranjith&#10;Anita"></textarea>' +
    '<div class="row" style="justify-content:space-between;margin-top:14px">' +
      '<button class="btn ghost sm" id="wn-teams">Use my team names</button>' +
      '<span><button class="btn ghost" data-close>Cancel</button>' +
      '<button class="btn primary" id="wn-save">Save</button></span></div>',
    (box, close) => {
      $('#wn', box).value = SH.names.join('\n');
      $('#wn-teams', box).onclick = () => {
        $('#wn', box).value = (Q.Build.getConfig().teams || []).map(t => t.name).join('\n');
      };
      $('#wn-save', box).onclick = () => {
        SH.names = $('#wn', box).value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 24);
        SH.winner = -1; SH.rot = 0;
        store(); close(); render();
      };
    });
}

/* ======================================================= reveal a picture */
function renderReveal(stage) {
  const pics = pictures();
  if (!pics.length) {
    empty(stage, 'No question has a picture yet',
      'Add one in the builder and it can be uncovered a piece at a time.');
    return;
  }
  if (SH.pic < 0 || SH.pic >= pics.length) { SH.pic = 0; SH.gone = Object.create(null); SH.shown = false; }
  const q = pics[SH.pic];
  const N = 4, M = 4, total = N * M;
  const goneN = Object.keys(SH.gone).length;

  stage.innerHTML =
    '<div class="show-head"><h1>What is this?</h1>' +
      '<p>' + (goneN >= total ? 'All uncovered.' : (total - goneN) + ' pieces still covering it') + '</p></div>' +
    '<div class="reveal-hold">' +
      '<img src="' + esc(q.image) + '" alt="">' +
      '<div class="reveal-tiles" style="grid-template-columns:repeat(' + N + ',1fr);grid-template-rows:repeat(' + M + ',1fr)">' +
        Array.apply(null, new Array(total)).map((_, i) =>
          '<i data-p="' + i + '"' + (SH.gone[i] ? ' class="gone"' : '') + '>' + (i + 1) + '</i>').join('') +
      '</div>' +
    '</div>' +
    (SH.shown ? '<h2 class="show-text" style="font-size:clamp(20px,3vw,36px)">' + esc(q.text) +
                ' &mdash; <span style="color:var(--ok)">' + esc(q.options[q.correct]) + '</span></h2>' : '') +
    '<div class="show-actions">' +
      '<button class="btn primary" id="rv-one"' + (goneN >= total ? ' disabled' : '') + '>' +
        ico('sparkle') + 'Uncover a piece</button>' +
      '<button class="btn ghost" id="rv-all">Uncover it all</button>' +
      '<button class="btn go" id="rv-say">' + ico('eye') + 'Show the answer</button>' +
      (pics.length > 1 ? '<button class="btn ghost" id="rv-next">Another picture' + ico('arrow-right') + '</button>' : '') +
    '</div>';

  stage.querySelectorAll('[data-p]').forEach(el => {
    el.onclick = () => { SH.gone[el.dataset.p] = 1; render(); };
  });
  $('#rv-one').onclick = () => {
    const left = [];
    for (let i = 0; i < total; i++) if (!SH.gone[i]) left.push(i);
    if (!left.length) return;
    SH.gone[left[Math.floor(Math.random() * left.length)]] = 1;
    render();
  };
  $('#rv-all').onclick = () => {
    for (let i = 0; i < total; i++) SH.gone[i] = 1;
    render();
  };
  $('#rv-say').onclick = () => {
    for (let i = 0; i < total; i++) SH.gone[i] = 1;
    SH.shown = true;
    Q.Sound.right();
    render();
  };
  const nx = $('#rv-next');
  if (nx) nx.onclick = () => {
    SH.pic = (SH.pic + 1) % pics.length;
    SH.gone = Object.create(null); SH.shown = false;
    render();
  };
}

/* =================================================================== boot */
function init() {
  const home = $('#show-home');
  if (!home) return;
  home.onclick = () => { location.hash = '#/'; };
  $('#show-edit').onclick = () => { location.hash = '#/host'; };
  $('#show-reset').onclick = startOver;
  $('#show-full').onclick = () => {
    const d = document;
    if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); return; }
    const el = d.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('This browser would not go full screen', 'warn'));
    else toast('This browser has no full screen', 'warn');
  };

  /* A presenter has one hand on a clicker, so the keys that matter are the big
     ones: space to give the answer, escape to get back to the board. */
  addEventListener('keydown', e => {
    if (!$('#s-show').classList.contains('on')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape' && SH.at >= 0) { SH.at = -1; SH.shown = false; render(); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter') {
      if (SH.tool === 'wheel') { spin(); e.preventDefault(); }
      else if (SH.at >= 0 && !SH.shown) { SH.shown = true; Q.Sound.right(); render(); e.preventDefault(); }
      else if (SH.at >= 0) { SH.at = -1; SH.shown = false; render(); e.preventDefault(); }
    }
  });
}

Q.Show = { init: init, open: open, state: SH };
})();
