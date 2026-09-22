/* ============================================================================
   Quiz Arena — the big screen

   One machine, nobody signing in, nothing scored. It runs as two views:

     Control  the host's laptop. Shows the same content, plus the buttons:
              open a number, show the answer, go back, spin, start over.
     Screen   the projector. The same content and nothing else — no chrome,
              no buttons, bigger type, and the right/wrong animation.

   The control window is the only source of truth; it pushes a small view of
   itself after every action and the screen paints whatever arrives. The view
   carries indices rather than content, because both windows read the same quiz
   out of this browser's own storage — so a picture never travels and the
   messages stay tiny.

   Three ways across, because one is never enough: a window handle for the
   popup we opened ourselves (the only one that is reliable from a file://
   page), a BroadcastChannel, and a localStorage mirror.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, ico, toast, modal, LS, shape, ACOLORS, reduced } = Q;

const KEY = 'qa:show:v1';
const HUES = ['#D62650', '#1B5BDB', '#B96A00', '#0B8C5E', '#6E38CE',
              '#0A7594', '#C2410C', '#A32FB0', '#4F7A0B', '#B01457'];
const TOOLS = [
  { id: 'numbers', name: 'Pick a number' },
  { id: 'wheel', name: 'Spin the wheel' },
  { id: 'reveal', name: 'Reveal a picture' }
];
const SPIN_MS = 4400;
const PIECES = 16;

const SH = {
  role: 'control',
  tool: 'numbers',
  sig: '',
  order: [],
  used: Object.create(null),
  at: -1,
  shown: false,
  names: [],
  rot: 0, spinFrom: 0, spinning: false, winner: -1, spinAt: 0,
  pic: -1, gone: Object.create(null),
  sound: true, choices: true, just: 0, justPiece: -1,
  remote: null,
  lastKey: ''
};

const questions = () => (Q.Build.getConfig().questions || []).filter(q => q.kind !== 'pz');
const pictures = () => questions().filter(q => q.image);
const sigOf = () => questions().map(q => q.id).join('|');

/* Only the control window makes a noise. A window opened by script has had no
   gesture of its own, so its audio would stay suspended and silent — and both
   windows are on the one machine driving the one set of speakers anyway. */
function sfx(name, arg) {
  if (!SH.sound || SH.role !== 'control') return;
  const f = Q.Sound[name];
  if (f) { try { f.call(Q.Sound, arg); } catch (e) {} }
}

/* ------------------------------------------------------------------- link */
const Link = (function () {
  let bus = null, kids = [], handler = null;
  function start(fn) {
    handler = fn;
    try { bus = Q.LocalBus('show', m => handler(m)); } catch (e) { bus = null; }
    addEventListener('message', e => {
      const m = e.data;
      if (m && m.__qashow && handler) handler(m);
    });
  }
  function send(m) {
    const msg = Object.assign({ __qashow: 1 }, m);
    if (bus) { try { bus.send(msg); } catch (e) {} }
    kids = kids.filter(w => w && !w.closed);
    kids.forEach(w => { try { w.postMessage(msg, '*'); } catch (e) {} });
    try { if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*'); } catch (e) {}
  }
  return { start: start, send: send, adopt: w => { if (w) kids.push(w); }, live: () => kids.filter(w => w && !w.closed).length };
})();

/* ------------------------------------------------------------- persistence */
function store() {
  LS.set(KEY, { sig: SH.sig, order: SH.order, used: SH.used, names: SH.names,
                tool: SH.tool, sound: SH.sound, choices: SH.choices });
}
function load() {
  const qs = questions();
  const sig = sigOf();
  const saved = LS.get(KEY, null);
  SH.names = (saved && Array.isArray(saved.names)) ? saved.names : [];
  SH.sound = !saved || saved.sound !== false;
  SH.choices = !saved || saved.choices !== false;
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

/* ------------------------------------------------ what the screen is shown */
function wheelNames() {
  if (SH.names.length) return SH.names;
  const teams = (Q.Build.getConfig().teams || []).map(t => t.name).filter(Boolean);
  return teams.length ? teams : ['Add some names'];
}

function viewNow() {
  const qs = questions();
  const pics = pictures();
  return {
    sig: SH.sig,
    tool: SH.tool,
    title: Q.Build.getConfig().title || 'Untitled quiz',
    tiles: SH.order.map((qi, k) => ({ n: k + 1, done: !!SH.used[qi] })),
    total: qs.length,
    at: SH.at,
    tileNo: SH.at >= 0 ? SH.order.indexOf(SH.at) + 1 : 0,
    shown: SH.shown,
    choices: SH.choices,
    just: SH.just, justPiece: SH.justPiece,
    wheel: { items: wheelNames(), rot: SH.rot, from: SH.spinFrom,
             winner: SH.winner, spinAt: SH.spinAt },
    pic: SH.pic, gone: Object.assign({}, SH.gone), pics: pics.length
  };
}

/* ==================================================================== open */
function open(role, tool) {
  SH.role = role === 'screen' ? 'screen' : 'control';
  load();
  if (tool && TOOLS.some(t => t.id === tool)) SH.tool = tool;
  SH.at = -1; SH.shown = false; SH.pic = -1; SH.gone = Object.create(null);

  if (SH.role === 'screen') {
    Q.Host.showScreen('s-screen');
    SH.lastKey = '';
    paintWaiting();
    Link.send({ t: 'hello' });
    return;
  }
  Q.Host.showScreen('s-show');
  Q.Sound.enabled = SH.sound;
  $('#show-title').textContent = Q.Build.getConfig().title || 'Untitled quiz';
  paintTools();
  paintSound();
  paintChoices();
  paintScreenBtn();
  render();
}

function paintSound() {
  const b = $('#show-sound');
  if (!b) return;
  b.classList.toggle('ghost', !SH.sound);
  b.innerHTML = Q.ico(SH.sound ? 'bolt' : 'signal-off') + (SH.sound ? 'Sound on' : 'Sound off');
  b.title = SH.sound ? 'Turn the sound off' : 'Turn the sound on';
}

function paintChoices() {
  const b = $('#show-choices');
  if (!b) return;
  b.classList.toggle('ghost', !SH.choices);
  b.innerHTML = Q.ico(SH.choices ? 'grid' : 'letters') +
                (SH.choices ? 'With choices' : 'Question only');
  b.title = SH.choices
    ? 'Showing the options under each question'
    : 'Showing the question on its own — the room answers out loud';
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
      SH.gone = Object.create(null);
      sfx('swish');
      store(); paintTools(); render();
    };
  });
}

/* The control paints itself and pushes the same view to the screen. */
function render() {
  const v = viewNow();
  Link.send({ t: 'state', s: v });
  paint(v, $('#show-stage'), true);
  /* the window we wrote ourselves needs no message — we hold its document */
  const st = screenStage();
  if (st) paint(v, st, false);
}

/* ================================================================ painting */
function paint(v, stage, live) {
  if (!stage) return;
  if (!v) return;
  if (v.tool === 'wheel') { paintWheel(v, stage, live); return; }
  if (v.tool === 'reveal') { paintReveal(v, stage, live); return; }
  paintNumbers(v, stage, live);
}

function emptyCard(stage, msg, cta, live) {
  stage.innerHTML =
    '<div class="card center" style="width:min(560px,100%);margin-inline:auto;padding:40px 24px">' +
      '<p style="font-size:17px;font-weight:650">' + esc(msg) + '</p>' +
      (cta ? '<p class="dim" style="font-size:14px;margin-top:8px">' + cta + '</p>' : '') +
      (live ? '<button class="btn primary" id="show-go-build" style="margin-top:16px">Write some questions</button>' : '') +
    '</div>';
  if (live) $('#show-go-build').onclick = () => { location.hash = '#/host'; };
}

function paintWaiting() {
  const stage = $('#screen-stage');
  if (!stage) return;
  stage.innerHTML =
    '<div class="show-head">' +
      '<h1>Ready</h1>' +
      '<p class="waitdots">Waiting for the control window</p>' +
    '</div>';
}

/* ---------------------------------------------------------- pick a number */
function paintNumbers(v, stage, live) {
  if (!v.total) { emptyCard(stage, 'There are no questions yet', 'The board puts one behind each number.', live); return; }
  if (v.at >= 0) { paintQuestion(v, stage, live); return; }

  const left = v.tiles.filter(t => !t.done).length;
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(v.total))));
  const rows = Math.ceil(v.total / cols);
  stage.innerHTML =
    '<div class="show-head">' +
      '<h1>Pick a number</h1>' +
      '<p>' + (left ? 'Someone call one out.' : 'Every number has been opened.') + '</p>' +
    '</div>' +
    '<div class="pick-grid big" style="--cols:' + cols + ';--rows:' + rows + '">' +
      v.tiles.map((t, i) =>
        '<button class="pick-tile' + (t.done ? ' done' : '') +
          (t.done && v.just === t.n ? ' just-done' : '') + '" type="button"' +
          ' style="--i:' + i + '"' +
          (live && !t.done ? ' data-n="' + (t.n - 1) + '"' : ' disabled') +
          ' aria-label="Number ' + t.n + (t.done ? ', already opened' : '') + '">' +
          '<span class="n">' + t.n + '</span>' +
          (t.done ? '<span class="sub">opened</span>' : '') +
        '</button>').join('') +
    '</div>' +
    (live && !left
      ? '<div class="show-actions"><button class="btn primary" id="show-again">' +
        ico('refresh') + 'Shuffle and start over</button></div>'
      : '');
  if (!live) return;
  stage.querySelectorAll('[data-n]').forEach(el => {
    el.onclick = () => {
      SH.at = SH.order[Number(el.dataset.n)];
      SH.shown = false; SH.just = 0;
      SH.used[SH.at] = 1;
      sfx('pick');
      setTimeout(() => sfx('swish'), 330);
      store(); render();
    };
  });
  const again = $('#show-again');
  if (again) again.onclick = startOver;
}

/* Splitting on spaces lets the line arrive a word at a time, which reads on a
   wall the way a person says it rather than appearing all at once. */
function wordsOf(text) {
  const parts = String(text || '').split(/\s+/).filter(Boolean);
  return parts.map((w, i) => '<span class="w" style="--i:' + i + '">' + esc(w) + '</span>').join(' ');
}

function paintQuestion(v, stage, live) {
  const q = questions()[v.at];
  if (!q) { emptyCard(stage, 'That question is no longer here', '', live); return; }
  const fresh = !v.shown;
  const words = String(q.text || '').split(/\s+/).filter(Boolean).length;
  /* the options wait for the question to finish arriving */
  const after = Math.min(1500, 640 + words * 55 + 240);
  const one = q.options.length <= 2 && q.options.join('').length > 40;

  const answers = v.choices
    ? '<div class="show-answers' + (one ? ' one-col' : '') + (v.shown ? ' revealed' : '') +
        '" style="--start:' + after + 'ms">' +
        q.options.map((o, i) => {
          const right = i === q.correct;
          return '<div class="show-ans' + (v.shown ? (right ? ' right' : ' wrong') : '') +
            '" style="background:' + ACOLORS[i] + ';--c:' + ACOLORS[i] +
              ';--d:' + (i * 90) + 'ms">' +
            '<span class="shape">' + shape(i) + '</span>' +
            '<span class="txt">' + esc(o) + '</span>' +
            (v.shown ? '<span class="ansmark">' + ico(right ? 'check' : 'cross') + '</span>' : '') +
          '</div>';
        }).join('') +
      '</div>'
    /* no options on the wall: the room answers out loud and the answer lands
       on its own when the host calls for it */
    : (v.shown
        ? '<div class="answer-solo"><span class="lab">Answer</span>' +
          '<b class="val">' + esc(q.options[q.correct]) + '</b>' +
          '<span class="ansmark">' + ico('check') + '</span></div>'
        : '');

  stage.innerHTML =
    '<div class="show-q' + (fresh ? ' fresh' : '') + (v.choices ? '' : ' solo') + '">' +
      (fresh
        ? '<div class="q-open" aria-hidden="true"><span class="ring"></span>' +
          '<span class="ring two"></span><span class="big-n">' + v.tileNo + '</span></div>'
        : '') +
      '<span class="qno">Number ' + v.tileNo + '</span>' +
      (q.image ? '<img class="show-img" src="' + esc(q.image) + '" alt="">' : '') +
      '<h2 class="show-text">' + (fresh ? wordsOf(q.text) : esc(q.text)) + '</h2>' +
      answers +
      (live
        ? '<div class="show-actions">' +
            '<button class="btn ghost" id="show-back">' + ico('arrow-left') + 'Back to the board</button>' +
            (v.shown
              ? '<button class="btn primary" id="show-next">Next number' + ico('arrow-right') + '</button>'
              : '<button class="btn go" id="show-reveal">' + ico('eye') + 'Show the answer</button>') +
          '</div>'
        : '') +
    '</div>';
  if (!live) return;
  $('#show-back').onclick = backToBoard;
  const rev = $('#show-reveal');
  if (rev) rev.onclick = revealAnswer;
  const nxt = $('#show-next');
  if (nxt) nxt.onclick = backToBoard;
}

/* The roll runs under the cards being ruled out; the sting lands with the
   answer, which the CSS holds back by the same beat. */
function revealAnswer() {
  if (SH.at < 0 || SH.shown) return;
  SH.shown = true;
  sfx('roll', 420);
  setTimeout(() => sfx('sting'), 430);
  render();
}
function backToBoard() {
  SH.just = SH.at >= 0 ? SH.order.indexOf(SH.at) + 1 : 0;
  SH.at = -1; SH.shown = false;
  sfx('swish');
  render();
}

function startOver() {
  reshuffle(sigOf(), questions().length);
  SH.at = -1; SH.shown = false; SH.pic = -1; SH.gone = Object.create(null);
  sfx('swish');
  render();
  toast('Board shuffled', 'ok');
}

/* -------------------------------------------------------- spin the wheel */
function paintWheel(v, stage, live) {
  const items = v.wheel.items;
  stage.innerHTML =
    '<div class="show-head"><h1>Spin the wheel</h1>' +
      '<p>' + items.length + ' on the wheel &mdash; whoever it lands on is up.</p></div>' +
    '<div class="wheel-wrap">' +
      '<div class="wheel-hold">' +
        '<div class="wheel-pin"></div>' +
        '<svg id="wheel-svg" viewBox="-104 -104 208 208">' + wheelFace(items) + '</svg>' +
        '<div class="wheel-hub"></div>' +
      '</div>' +
      '<div class="wheel-out' + (v.wheel.winner >= 0 ? ' on' : '') + '">' +
        (v.wheel.winner >= 0 ? esc(items[v.wheel.winner]) : '') + '</div>' +
      (live
        ? '<div class="show-actions">' +
            '<button class="btn go xl" id="wheel-spin"' + (items.length < 2 ? ' disabled' : '') + '>Spin</button>' +
            '<button class="btn ghost" id="wheel-edit">' + ico('sliders') + 'Edit the names</button>' +
          '</div>'
        : '') +
    '</div>';

  /* The wheel is turned frame by frame rather than handed to a CSS transition,
     for two reasons: both windows run the same easing from the same timestamp
     so they stay in step even if one repaints late, and the ticking can be
     fired exactly as a sector crosses the pin instead of being guessed at. */
  const svg = $('#wheel-svg', stage);
  if (svg) {
    const elapsed = v.wheel.spinAt ? Date.now() - v.wheel.spinAt : SPIN_MS;
    if (v.wheel.spinAt && elapsed < SPIN_MS && !reduced()) {
      turnWheel(svg, v.wheel.from, v.wheel.rot, v.wheel.spinAt, items.length, live);
    } else {
      svg.style.transform = 'rotate(' + v.wheel.rot + 'deg)';
    }
    if (v.wheel.winner >= 0) {
      svg.classList.add('won');
      svg.querySelectorAll('[data-k="' + v.wheel.winner + '"]')
         .forEach(el => el.classList.add('hit'));
    }
  }
  if (!live) return;
  $('#wheel-spin').onclick = spin;
  $('#wheel-edit').onclick = editNames;
}

/* easeOutQuint — a heavy wheel let go of */
const ease = t => 1 - Math.pow(1 - t, 5);

function turnWheel(el, from, to, startedAt, n, withSound) {
  const seg = 360 / n;
  let lastSeg = Math.floor(from / seg), lastTick = 0;
  (function frame() {
    if (!el.isConnected) return;
    const t = Math.min(1, (Date.now() - startedAt) / SPIN_MS);
    const a = from + (to - from) * ease(t);
    el.style.transform = 'rotate(' + a + 'deg)';
    const cur = Math.floor(a / seg);
    if (cur !== lastSeg) {
      lastSeg = cur;
      /* at full speed the sectors fly past faster than a click can be heard,
         so thin them out; the rhythm opens up on its own as the wheel slows */
      const t2 = Date.now();
      if (withSound && t2 - lastTick > 55) { lastTick = t2; sfx('tock'); }
    }
    if (t < 1) requestAnimationFrame(frame);
  })();
}

function wheelFace(items) {
  const n = items.length, R = 100;
  const size = n <= 6 ? 11 : n <= 10 ? 8.5 : n <= 16 ? 6.5 : 5;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const x0 = (R * Math.cos(a0)).toFixed(2), y0 = (R * Math.sin(a0)).toFixed(2);
    const x1 = (R * Math.cos(a1)).toFixed(2), y1 = (R * Math.sin(a1)).toFixed(2);
    const big = (a1 - a0) > Math.PI ? 1 : 0;
    out += '<path data-k="' + i + '" d="M0,0 L' + x0 + ',' + y0 + ' A' + R + ',' + R + ' 0 ' + big +
           ' 1 ' + x1 + ',' + y1 + ' Z" fill="' + HUES[i % HUES.length] + '" stroke="#fff" stroke-width="0.8"/>';
    const am = (a0 + a1) / 2;
    const lx = (R * 0.63 * Math.cos(am)), ly = (R * 0.63 * Math.sin(am));
    /* Text laid along the radius reads upside down on the left half, so flip
       those by half a turn — anchored in the middle, it stays put. */
    let deg = ((am * 180 / Math.PI) % 360 + 360) % 360;
    if (deg > 90 && deg < 270) deg -= 180;
    out += '<text data-k="' + i + '" x="' + lx.toFixed(2) + '" y="' + ly.toFixed(2) + '" fill="#fff" font-size="' + size +
           '" font-weight="700" text-anchor="middle" dominant-baseline="central" ' +
           'transform="rotate(' + deg.toFixed(2) + ' ' + lx.toFixed(2) + ' ' + ly.toFixed(2) + ')">' +
           esc(String(items[i]).slice(0, 18)) + '</text>';
  }
  /* The rim goes on top rather than under: a disc behind the sectors would
     mean dimming one fades it toward white, which on a dark stage reads as
     lighter rather than further away. */
  out += '<circle cx="0" cy="0" r="100.6" fill="none" stroke="#fff" stroke-width="3.2"/>';
  return out;
}

/* The winner is drawn first and the wheel then turned to put it under the pin,
   which is the only way the pointer and the announcement cannot disagree. */
function spin() {
  const items = wheelNames();
  if (items.length < 2 || SH.spinning) return;
  const n = items.length;
  const k = Math.floor(Math.random() * n);
  let target = -(k + 0.5) * 360 / n;
  const turns = 4 + Math.floor(Math.random() * 3);
  while (target < SH.rot + turns * 360) target += 360;
  SH.spinFrom = SH.rot;
  SH.rot = target;
  SH.winner = -1;
  SH.spinAt = reduced() ? 0 : Date.now();
  sfx('swish');
  render();
  if (reduced()) { land(k); return; }
  SH.spinning = true;
  const btn = $('#wheel-spin');
  if (btn) btn.disabled = true;
  setTimeout(() => { SH.spinning = false; land(k); }, SPIN_MS + 100);
}
function land(k) {
  SH.winner = k;
  SH.spinAt = 0;
  render();
  sfx('sting');
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
        SH.winner = -1; SH.rot = 0; SH.spinFrom = 0; SH.spinAt = 0;
        store(); close(); render();
      };
    });
}

/* ------------------------------------------------------ reveal a picture */
function paintReveal(v, stage, live) {
  const pics = pictures();
  if (!pics.length) {
    emptyCard(stage, 'No question has a picture yet',
      'Add one in the builder and it can be uncovered a piece at a time.', live);
    return;
  }
  const idx = (v.pic >= 0 && v.pic < pics.length) ? v.pic : 0;
  const q = pics[idx];
  const goneN = Object.keys(v.gone || {}).length;
  stage.innerHTML =
    '<div class="show-head"><h1>What is this?</h1>' +
      '<p>' + (goneN >= PIECES ? 'All uncovered.' : (PIECES - goneN) + ' pieces still covering it') + '</p></div>' +
    '<div class="reveal-hold">' +
      '<img src="' + esc(q.image) + '" alt="">' +
      '<div class="reveal-tiles" style="grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr)">' +
        Array.apply(null, new Array(PIECES)).map((_, i) =>
          '<i' + (live ? ' data-p="' + i + '"' : '') +
          (v.gone && v.gone[i] ? (v.justPiece === i ? ' class="gone lift"' : ' class="gone"') : '') +
          '>' + (i + 1) + '</i>').join('') +
      '</div>' +
    '</div>' +
    (v.shown ? '<h2 class="show-text" style="font-size:clamp(20px,3vw,36px)">' + esc(q.text) +
               ' &mdash; <span style="color:var(--ok)">' + esc(q.options[q.correct]) + '</span></h2>' : '') +
    (live
      ? '<div class="show-actions">' +
          '<button class="btn primary" id="rv-one"' + (goneN >= PIECES ? ' disabled' : '') + '>' +
            ico('sparkle') + 'Uncover a piece</button>' +
          '<button class="btn ghost" id="rv-all">Uncover it all</button>' +
          '<button class="btn go" id="rv-say">' + ico('eye') + 'Show the answer</button>' +
          (pics.length > 1 ? '<button class="btn ghost" id="rv-next">Another picture' + ico('arrow-right') + '</button>' : '') +
        '</div>'
      : '');
  if (!live) return;
  SH.pic = idx;
  stage.querySelectorAll('[data-p]').forEach(el => {
    el.onclick = () => {
      SH.gone[el.dataset.p] = 1; SH.justPiece = Number(el.dataset.p);
      sfx('lift'); render();
    };
  });
  $('#rv-one').onclick = () => {
    const left = [];
    for (let i = 0; i < PIECES; i++) if (!SH.gone[i]) left.push(i);
    if (!left.length) return;
    const one = left[Math.floor(Math.random() * left.length)];
    SH.gone[one] = 1; SH.justPiece = one;
    sfx('lift');
    render();
  };
  $('#rv-all').onclick = () => {
    for (let i = 0; i < PIECES; i++) SH.gone[i] = 1;
    SH.justPiece = -1;
    sfx('swish'); render();
  };
  $('#rv-say').onclick = () => {
    for (let i = 0; i < PIECES; i++) SH.gone[i] = 1;
    SH.shown = true;
    sfx('roll', 380);
    setTimeout(() => sfx('sting'), 390);
    render();
  };
  const nx = $('#rv-next');
  if (nx) nx.onclick = () => {
    SH.pic = (SH.pic + 1) % pics.length;
    SH.gone = Object.create(null); SH.shown = false; SH.justPiece = -1;
    sfx('swish');
    render();
  };
}

/* ======================================================= the second window

   The audience window is *written*, not navigated to.

   Pointing a new window at this page's own address is the obvious move and it
   is the one that breaks: inside a sandboxed frame, a downloaded file opened
   from some viewers, or anywhere the page is served from a blob, that address
   either refuses to load a second time or loads into a context that cannot run
   it — and the host is left staring at a black rectangle with no way to tell
   what went wrong.

   So we open a blank window instead, which is always same-origin with us, and
   build its document out of the styles this page already carries. Nothing is
   fetched, nothing is parsed twice, and there is no address to fail. It also
   means the screen needs no messaging at all: it is a document we hold a
   reference to, so render() writes straight into it.

   The postMessage link stays for the other way in — a second window someone
   opened by hand at #/screen — which still works where the address does. */
let scr = null;          /* the window we wrote */
let scrStage = null;     /* its stage element */

/* Live only while the window is open and still holds the document we wrote.
   A host who closes the screen and clicks again gets a fresh one. */
function screenStage() {
  try {
    if (!scr || scr.closed) return null;
    if (!scrStage || !scrStage.isConnected) return null;
    return scrStage;
  } catch (e) { return null; }
}

function screenHTML() {
  /* every <style> this page carries, in order — they are all inline, so the
     copy is complete and offline by construction */
  let css = '';
  $$('style').forEach(s => { css += '<style>' + s.textContent + '</style>'; });
  const sprite = $('#qa-sprite');
  return '<!doctype html><html lang="en" style="background:#101128">' +
    '<head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(Q.Build.getConfig().title || 'Quiz Arena') + ' — screen</title>' +
    css +
    /* the app's own body rule paints daylight; the stage is a dark room */
    '<style>html,body{margin:0;background:#101128}body{overflow:hidden}' +
    '#s-screen{height:100dvh}</style>' +
    '</head><body>' +
    (sprite ? sprite.outerHTML : '') +
    '<section class="screen on" id="s-screen">' +
      '<div class="show-stage screen-stage" id="screen-stage"></div>' +
    '</section></body></html>';
}

function openScreen() {
  const cur = screenStage();
  if (cur) { try { scr.focus(); } catch (e) {} render(); toast('The screen is already open', 'ok'); return; }

  let w = null;
  try { w = window.open('', 'qa-screen', 'width=1280,height=800'); } catch (e) { w = null; }
  if (!w) { blockedNote(); return; }

  let stage = null;
  try {
    w.document.open();
    w.document.write(screenHTML());
    w.document.close();
    stage = w.document.getElementById('screen-stage');
  } catch (e) { stage = null; }

  /* A window we cannot write into is no use to anyone — say so rather than
     leaving a blank one on the projector. */
  if (!stage) {
    try { w.close(); } catch (e) {}
    blockedNote(true);
    return;
  }

  scr = w; scrStage = stage;
  /* a presenter's window wants to be full screen, and a double-click is the
     one gesture that needs no chrome to discover */
  try {
    w.document.addEventListener('dblclick', () => {
      const d = w.document, el = d.documentElement;
      if (d.fullscreenElement) { if (d.exitFullscreen) d.exitFullscreen(); }
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
  } catch (e) {}

  render();
  paintScreenBtn();
  toast('Screen opened — drag it to the projector, double-click for full screen', 'ok');
}

function blockedNote(wrote) {
  const url = location.href.replace(/#.*$/, '') + '#/screen';
  modal('<h2 style="font-size:21px">' +
    (wrote ? 'That window would not take the screen' : 'The pop-up was blocked') + '</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:8px;line-height:1.6">' +
    (wrote
      ? 'The browser opened a window but would not let this page draw into it. Open '
      : 'Allow pop-ups for this page, or open ') +
    'this address in a second window instead and drag it to the projector:</p>' +
    '<p class="mono" style="margin-top:10px;font-size:13px;word-break:break-all;background:var(--sunken);' +
    'padding:10px;border-radius:10px">' + esc(url) + '</p>' +
    '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-close>Got it</button></div>');
}

/* The button says which of the two states the host is in, because a window on
   a projector is often behind this one and cannot be checked at a glance. */
function paintScreenBtn() {
  const b = $('#show-screen');
  if (!b) return;
  const on = !!screenStage();
  b.classList.toggle('ghost', on);
  b.innerHTML = ico(on ? 'check' : 'laptop') + (on ? 'Screen is open' : 'Open the screen');
  b.title = on ? 'The audience window is open — click to bring it forward' : 'Open the audience window';
}

/* =================================================================== boot */
function init() {
  Link.start(m => {
    if (!m) return;
    if (m.t === 'hello' && SH.role === 'control') { render(); return; }
    if (m.t === 'state' && SH.role === 'screen') {
      /* the quiz itself changed under us — reload so both windows agree */
      if (m.s && m.s.sig && SH.sig && m.s.sig !== SH.sig) { location.reload(); return; }
      SH.remote = m.s;
      paint(m.s, $('#screen-stage'), false);
    }
  });

  const home = $('#show-home');
  if (!home) return;
  home.onclick = () => { location.hash = '#/'; };
  $('#show-edit').onclick = () => { location.hash = '#/host'; };
  $('#show-reset').onclick = startOver;
  $('#show-screen').onclick = openScreen;
  /* the projector window is usually behind this one, so the only moment we can
     notice it was closed is when the host looks back at the control */
  addEventListener('focus', () => { if (SH.role === 'control') paintScreenBtn(); });
  $('#show-choices').onclick = () => {
    SH.choices = !SH.choices;
    sfx('swish');
    store(); paintChoices(); render();
  };
  $('#show-sound').onclick = () => {
    SH.sound = !SH.sound;
    Q.Sound.enabled = SH.sound;
    if (SH.sound) { Q.Sound.unlock(); sfx('pick'); }
    store(); paintSound();
  };
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
    if (SH.role !== 'control' || !$('#s-show').classList.contains('on')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape' && SH.at >= 0) { backToBoard(); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter') {
      if (SH.tool === 'wheel') { spin(); e.preventDefault(); }
      else if (SH.at >= 0 && !SH.shown) { revealAnswer(); e.preventDefault(); }
      else if (SH.at >= 0) { backToBoard(); e.preventDefault(); }
    }
  });
}

Q.Show = { init: init, open: open, state: SH };
})();
