/* ============================================================================
   Quiz Arena — configuration model + question builder
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, clamp, uid, toast, modal, LS, shape, ico, ACOLORS, TEAM_PALETTE, nf, mmss,
        shrinkImage, readFileAsDataURL } = Q;

const CFG_KEY = 'qa:config:v1';
const LIB_KEY = 'qa:library:v1';

/* ------------------------------------------------------------- defaults */
function blankQuestion(defTime, defPoints) {
  return {
    id: uid(8), text: '',
    options: ['', '', '', ''],
    correct: 0,
    time: clamp(defTime || 20, 5, 300),
    points: clamp(defPoints == null ? 1000 : defPoints, 0, 5000)
  };
}
function tfQuestion(defTime, defPoints) {
  const q = blankQuestion(defTime, defPoints);
  q.options = ['True', 'False'];
  return q;
}
/* A round is either a question or a puzzle. Everything downstream — the run
   sheet, the briefing, the scoreboard — reads `kind` to tell them apart, and a
   quiz saved before puzzles existed simply has no kind, which reads as a
   question. */
function blankPuzzle(defPoints) {
  return {
    id: uid(8), kind: 'pz',
    game: 'zip', level: 'medium',
    number: 1 + Math.floor(Math.random() * 400),
    time: 180,
    points: clamp(defPoints == null ? 1000 : defPoints, 0, 5000)
  };
}
const PZ_GAMES = () => (Q.Puzzles ? Q.Puzzles.GAMES : []);
const pzDef = id => PZ_GAMES().filter(g => g.id === id)[0] || { name: 'Puzzle', icon: 'puzzle', rule: '' };

function defaultTeams() {
  return [
    { id: uid(6), name: 'Red Rockets',  color: TEAM_PALETTE[0] },
    { id: uid(6), name: 'Blue Comets',  color: TEAM_PALETTE[1] }
  ];
}
function defaultConfig() {
  return {
    title: '', questions: [],
    teamsEnabled: true, teams: defaultTeams(), assign: 'choose', teamMetric: 'total',
    speedW: 0.5, fastBonus: 100, streakBonus: 50, wrongPenalty: 0,
    defTime: 20, defPoints: 1000,
    pinOn: false, pin: '', lateJoin: true, showPlayersLb: true, shuffle: false, noCopy: true,
    netMode: 'online', sound: true
  };
}

const SAMPLE = {
  title: 'Friday Trivia Showdown',
  questions: [
    { text: 'Which planet has the shortest day in our solar system?', options: ['Mercury', 'Jupiter', 'Mars', 'Venus'], correct: 1, time: 20, points: 1000 },
    { text: 'HTTP status 418 officially means…', options: ['Payment Required', "I'm a teapot", 'Gone Fishing', 'Too Many Hats'], correct: 1, time: 15, points: 1000 },
    { text: 'The Great Barrier Reef can be seen from space.', options: ['True', 'False'], correct: 0, time: 12, points: 750 },
    { text: 'Which of these languages was released first?', options: ['Python', 'Java', 'JavaScript', 'Ruby'], correct: 0, time: 20, points: 1000 },
    { text: 'How many bones are in the adult human body?', options: ['186', '206', '226', '246'], correct: 1, time: 20, points: 1000 },
    { text: 'What does the "S" in HTTPS stand for?', options: ['Simple', 'Secure', 'Static', 'Session'], correct: 1, time: 12, points: 750 }
  ]
};

/* ---------------------------------------------------------- load & save */
function normaliseQuestion(raw, def) {
  const q = blankQuestion(def && def.defTime, def && def.defPoints);
  if (!raw || typeof raw !== 'object') return q;
  q.id = typeof raw.id === 'string' && raw.id ? raw.id : q.id;
  q.text = String(raw.text || raw.question || '').slice(0, 400);
  let opts = Array.isArray(raw.options) ? raw.options : (Array.isArray(raw.answers) ? raw.answers : []);
  opts = opts.map(o => String(o == null ? '' : (typeof o === 'object' ? o.text : o)).slice(0, 180));
  while (opts.length < 2) opts.push('');
  q.options = opts.slice(0, 6);
  const c = Number(raw.correct != null ? raw.correct : raw.answer);
  q.correct = Number.isFinite(c) ? clamp(Math.round(c), 0, q.options.length - 1) : 0;
  const t = Number(raw.time != null ? raw.time : raw.seconds);
  q.time = Number.isFinite(t) ? clamp(Math.round(t), 5, 300) : q.time;
  const p = Number(raw.points);
  q.points = Number.isFinite(p) ? clamp(Math.round(p), 0, 5000) : q.points;
  if (typeof raw.image === 'string' && /^data:image\//.test(raw.image)) q.image = raw.image;
  return q;
}
function normalisePuzzle(raw, def) {
  const p = blankPuzzle(def && def.defPoints);
  if (typeof raw.id === 'string' && raw.id) p.id = raw.id;
  const ids = PZ_GAMES().map(g => g.id);
  p.game = ids.indexOf(raw.game) >= 0 ? raw.game : (ids[0] || 'zip');
  p.level = ['easy', 'medium', 'hard'].indexOf(raw.level) >= 0 ? raw.level : 'medium';
  p.number = clamp(Math.round(Number(raw.number)) || 1, 1, 9999);
  p.time = clamp(Math.round(Number(raw.time)) || 180, 30, 900);
  const pts = Number(raw.points);
  p.points = Number.isFinite(pts) ? clamp(Math.round(pts), 0, 5000) : p.points;
  return p;
}
const normaliseRound = (raw, def) =>
  (raw && raw.kind === 'pz') ? normalisePuzzle(raw, def) : normaliseQuestion(raw, def);

function normaliseConfig(raw) {
  const d = defaultConfig();
  if (!raw || typeof raw !== 'object') return d;
  const c = Object.assign(d, {
    title: String(raw.title || '').slice(0, 100),
    teamsEnabled: raw.teamsEnabled !== false,
    assign: raw.assign === 'auto' ? 'auto' : 'choose',
    teamMetric: raw.teamMetric === 'avg' ? 'avg' : 'total',
    speedW: [0, 0.25, 0.5, 0.8].indexOf(Number(raw.speedW)) >= 0 ? Number(raw.speedW) : 0.5,
    fastBonus: clamp(Number(raw.fastBonus) || 0, 0, 2000),
    streakBonus: clamp(Number(raw.streakBonus) || 0, 0, 1000),
    wrongPenalty: clamp(Number(raw.wrongPenalty) || 0, 0, 2000),
    defTime: clamp(Number(raw.defTime) || 20, 5, 300),
    defPoints: clamp(Number(raw.defPoints) == null ? 1000 : Number(raw.defPoints), 0, 5000),
    pinOn: !!raw.pinOn, pin: String(raw.pin || '').replace(/\D/g, '').slice(0, 8),
    lateJoin: raw.lateJoin !== false,
    showPlayersLb: raw.showPlayersLb !== false,
    shuffle: !!raw.shuffle,
    noCopy: raw.noCopy !== false,
    netMode: raw.netMode === 'local' ? 'local' : 'online',
    sound: raw.sound !== false
  });
  c.questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 100).map(r => normaliseRound(r, c));
  if (Array.isArray(raw.teams) && raw.teams.length) {
    c.teams = raw.teams.slice(0, 8).map((t, i) => ({
      id: (t && typeof t.id === 'string' && t.id) || uid(6),
      name: String((t && t.name) || ('Team ' + (i + 1))).slice(0, 24),
      color: /^#[0-9a-f]{6}$/i.test(t && t.color) ? t.color : TEAM_PALETTE[i % TEAM_PALETTE.length]
    }));
  }
  return c;
}

let cfg = normaliseConfig(LS.get(CFG_KEY, null));
let openQ = null;          /* id of the expanded question card */
let saveTimer = 0;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => LS.set(CFG_KEY, cfg), 250);
}
function getConfig() { return cfg; }
function setConfig(next) { cfg = normaliseConfig(next); LS.set(CFG_KEY, cfg); renderAll(); }

/* -------------------------------------------------------------- library */
function library() { return LS.get(LIB_KEY, []); }
function saveToLibrary(name) {
  const lib = library();
  const entry = {
    id: uid(8), savedAt: Date.now(),
    name: (name || cfg.title || 'Untitled quiz').slice(0, 80),
    config: JSON.parse(JSON.stringify(cfg))
  };
  lib.unshift(entry);
  LS.set(LIB_KEY, lib.slice(0, 40));
  return entry;
}

/* ==================================================================== UI */
function stepTo(tab) {
  const order = ['questions', 'teams', 'rules', 'go'];
  const idx = order.indexOf(tab);
  $$('.step').forEach(s => {
    const i = order.indexOf(s.dataset.tab);
    s.classList.toggle('now', i === idx);
    s.classList.toggle('done', i < idx);
  });
  $$('.tabpane').forEach(p => p.classList.toggle('hide', p.dataset.pane !== tab));
  if (tab === 'go') renderGo();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------------------------------------------------- questions UI */
function questionSummary(q) {
  if (q.kind === 'pz') return { bad: false, filled: 0, puzzle: true };
  const filled = q.options.filter(o => o.trim()).length;
  const bad = !q.text.trim() || filled < 2 || !q.options[q.correct] || !q.options[q.correct].trim();
  return { bad, filled };
}

function renderQuestions() {
  const host = $('#qlist');
  if (!host) return;
  if (!cfg.questions.length) {
    host.innerHTML = '<div class="card center" style="border-style:dashed">' +
      '<p style="font-size:15px;font-weight:650">No questions yet</p>' +
      '<p class="dim" style="font-size:13.5px;margin-top:6px">Add your first one below, or load the sample quiz to see the shape of things.</p></div>';
    renderSummary(); return;
  }
  host.innerHTML = cfg.questions.map((q, i) => {
    if (q.kind === 'pz') return puzzleCard(q, i, q.id === openQ);
    const st = questionSummary(q);
    const open = q.id === openQ;
    return '<article class="qcard' + (open ? ' open' : '') + '" data-q="' + q.id + '">' +
      '<div class="qhead" data-act="toggle" role="button" tabindex="0" aria-expanded="' + open + '">' +
        '<span class="qnum">' + (i + 1) + '</span>' +
        '<span class="qtitle' + (q.text.trim() ? '' : ' empty') + '">' + (q.text.trim() ? esc(q.text) : 'Untitled question') + '</span>' +
        '<span class="qmeta">' +
          (st.bad ? '<span class="pill warn" title="Needs a question, at least two options, and a correct answer">Incomplete</span>' : '') +
          (q.image ? '<span class="pill" title="Has a picture">' + ico('file') + '</span>' : '') +
          '<span class="pill">' + q.time + 's</span>' +
          '<span class="pill">' + nf(q.points) + ' pts</span>' +
          '<button class="btn-ico" data-act="up" title="Move up" aria-label="Move up">' + ico('chevron-up') + '</button>' +
          '<button class="btn-ico" data-act="down" title="Move down" aria-label="Move down">' + ico('chevron-down') + '</button>' +
          '<button class="btn-ico" data-act="dup" title="Duplicate" aria-label="Duplicate">' + ico('copy') + '</button>' +
          '<button class="btn-ico danger" data-act="del" title="Delete" aria-label="Delete">' + ico('cross') + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="qbody">' +
        '<div class="field"><label>Question</label>' +
          '<textarea class="inp" data-f="text" rows="2" maxlength="400" placeholder="What do you want to ask?">' + esc(q.text) + '</textarea></div>' +
        '<div class="field"><label>Answer options &mdash; tap the tick to mark the correct one</label>' +
          '<div class="opt-rows">' +
            q.options.map((o, j) =>
              '<div class="opt-row" data-o="' + j + '">' +
                '<span class="opt-shape" style="background:' + ACOLORS[j] + '">' + shape(j) + '</span>' +
                '<input class="inp" data-f="opt" value="' + esc(o) + '" maxlength="180" placeholder="Option ' + (j + 1) + '">' +
                '<button class="opt-correct" data-act="correct" aria-pressed="' + (q.correct === j) + '" title="Mark as the correct answer">' + ico('check') + '</button>' +
                (q.options.length > 2 ? '<button class="btn-ico danger" data-act="delopt" title="Remove option">' + ico('cross') + '</button>' : '') +
              '</div>').join('') +
          '</div>' +
          (q.options.length < 6 ? '<button class="btn ghost sm" data-act="addopt" style="margin-top:9px;align-self:flex-start">' + ico('plus') + 'Add option</button>' : '') +
        '</div>' +
        '<div class="field"><label>Picture (optional)</label>' + imageBlock(q) + '</div>' +
        '<div class="grid2">' +
          '<div class="field"><label>Seconds to answer</label><input class="inp" type="number" data-f="time" min="5" max="300" value="' + q.time + '"></div>' +
          '<div class="field"><label>Points at stake</label><input class="inp" type="number" data-f="points" min="0" max="5000" step="50" value="' + q.points + '"></div>' +
        '</div>' +
      '</div>' +
    '</article>';
  }).join('');
  renderSummary();
}

function renderSummary() {
  const n = cfg.questions.length;
  const pz = cfg.questions.filter(q => q.kind === 'pz').length;
  const t = cfg.questions.reduce((a, q) => a + q.time, 0);
  const sq = $('#sum-q'), st = $('#sum-t'), sl = $('#sum-q-label');
  if (sq) sq.textContent = n;
  /* once a puzzle is in the list these are rounds, not questions */
  if (sl) sl.textContent = pz ? 'Rounds' : 'Questions';
  if (st) st.textContent = mmss(t);
  const bad = cfg.questions.filter(q => questionSummary(q).bad).length;
  const w = $('#sum-warn');
  if (w) {
    w.innerHTML = !n
      ? '<span class="pill warn">Add at least one question</span>'
      : (bad ? '<span class="pill warn">' + bad + ' question' + (bad > 1 ? 's need' : ' needs') + ' finishing</span>'
             : '<span class="pill ok">' +
               (pz ? (n - pz) + ' question' + (n - pz === 1 ? '' : 's') + ' &middot; ' +
                     pz + ' puzzle' + (pz === 1 ? '' : 's')
                   : 'All questions look complete') + '</span>');
  }
}

function qById(id) { return cfg.questions.find(q => q.id === id); }

/* ------------------------------------------------------------ pictures */
function imageBlock(q) {
  if (!q.image) {
    return '<button type="button" class="qimg-drop" data-act="addimg">' + ico('upload') +
      '<span>Add a picture' +
      '<small>Click to choose, or drop a file on this question, or paste one</small></span></button>';
  }
  return '<div class="qimg-wrap">' +
    '<img src="' + esc(q.image) + '" alt="">' +
    '<div class="qimg-meta">' +
      '<span class="sz">' + Math.round(q.image.length / 1024) + ' KB · shown above the answers</span>' +
      '<div class="row" style="gap:7px">' +
        '<button type="button" class="btn ghost xs" data-act="addimg">' + ico('refresh') + 'Replace</button>' +
        '<button type="button" class="btn ghost xs danger" data-act="rmimg">' + ico('cross') + 'Remove</button>' +
      '</div>' +
    '</div></div>';
}

function setBusy(card, on) {
  const slot = card && $('.qimg-drop, .qimg-wrap', card);
  if (slot && on) {
    slot.outerHTML = '<span class="qimg-busy">' + ico('refresh') + 'Shrinking the picture…</span>';
  }
}

/* Whatever comes in — file, drop, paste — funnels through here. */
function attachImage(q, src, card) {
  setBusy(card, true);
  return shrinkImage(src).then(out => {
    q.image = out;
    if (!LS.set(CFG_KEY, cfg)) {
      delete q.image;
      renderQuestions();
      toast('No room left in this browser for another picture. Remove one first, or export the quiz.', 'bad', 6000);
      return;
    }
    renderQuestions();
    toast('Picture added', 'ok');
  }).catch(err => {
    renderQuestions();
    toast(err && err.message ? err.message : 'That picture could not be used', 'bad', 5000);
  });
}

function pickImageFor(qid) {
  const input = $('#img-input');
  if (!input) return;
  input.value = '';
  input.dataset.q = qid;
  input.click();
}

function wireImages() {
  const list = $('#qlist');
  const input = $('#img-input');

  input.onchange = () => {
    const file = input.files && input.files[0];
    const q = qById(input.dataset.q);
    if (!file || !q) return;
    readFileAsDataURL(file)
      .then(src => attachImage(q, src, $('.qcard[data-q="' + q.id + '"]')))
      .catch(e => toast(e.message, 'bad'));
  };

  /* drop a file straight onto the question it belongs to */
  list.addEventListener('dragover', e => {
    const card = e.target.closest('.qcard');
    if (!card || !e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
    e.preventDefault();
    card.classList.add('dragover');
  });
  list.addEventListener('dragleave', e => {
    const card = e.target.closest('.qcard');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('dragover');
  });
  list.addEventListener('drop', e => {
    const card = e.target.closest('.qcard');
    if (!card) return;
    card.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    const q = qById(card.dataset.q);
    if (!q) return;
    if (!/^image\//.test(file.type)) { toast('That is not an image file', 'bad'); return; }
    if (openQ !== q.id) { openQ = q.id; renderQuestions(); }
    readFileAsDataURL(file)
      .then(src => attachImage(q, src, $('.qcard[data-q="' + q.id + '"]')))
      .catch(err => toast(err.message, 'bad'));
  });

  /* paste a screenshot into whichever question is open */
  document.addEventListener('paste', e => {
    if (!$('#s-build').classList.contains('on') || !openQ) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) {
        const file = items[i].getAsFile();
        const q = qById(openQ);
        if (!file || !q) return;
        e.preventDefault();
        readFileAsDataURL(file)
          .then(src => attachImage(q, src, $('.qcard[data-q="' + q.id + '"]')))
          .catch(err => toast(err.message, 'bad'));
        return;
      }
    }
  });
}


/* A puzzle round in the list. Same shell as a question so ordering, duplicating
   and deleting need no special case — only the body differs. */
function puzzleCard(q, i, open) {
  const g = pzDef(q.game);
  const chips = (name, opts, cur) =>
    '<div class="pz-levels" style="flex-wrap:wrap">' + opts.map(o =>
      '<button type="button" data-act="' + name + '" data-v="' + o.v + '"' +
      (o.v === cur ? ' class="on"' : '') + '>' + esc(o.label) + '</button>').join('') + '</div>';

  return '<article class="qcard pzcard' + (open ? ' open' : '') + '" data-q="' + q.id + '">' +
    '<div class="qhead" data-act="toggle" role="button" tabindex="0" aria-expanded="' + open + '">' +
      '<span class="qnum">' + (i + 1) + '</span>' +
      '<span class="qtitle">' + esc(g.name) + '</span>' +
      '<span class="qmeta">' +
        '<span class="pill accent">' + ico('puzzle') + 'Puzzle</span>' +
        '<span class="pill">' + esc(q.level) + ' &middot; #' + q.number + '</span>' +
        '<span class="pill">' + q.time + 's</span>' +
        '<span class="pill">' + nf(q.points) + ' pts</span>' +
        '<button class="btn-ico" data-act="up" title="Move up" aria-label="Move up">' + ico('chevron-up') + '</button>' +
        '<button class="btn-ico" data-act="down" title="Move down" aria-label="Move down">' + ico('chevron-down') + '</button>' +
        '<button class="btn-ico" data-act="dup" title="Duplicate" aria-label="Duplicate">' + ico('copy') + '</button>' +
        '<button class="btn-ico danger" data-act="del" title="Delete" aria-label="Delete">' + ico('cross') + '</button>' +
      '</span>' +
    '</div>' +
    '<div class="qbody">' +
      '<div class="field"><label>Which puzzle</label>' +
        chips('pickgame', PZ_GAMES().map(x => ({ v: x.id, label: x.name })), q.game) + '</div>' +
      '<div class="field"><label>Difficulty</label>' +
        chips('picklevel', ['easy', 'medium', 'hard'].map(l =>
          ({ v: l, label: l.charAt(0).toUpperCase() + l.slice(1) })), q.level) + '</div>' +
      '<p class="faint" style="font-size:13px;line-height:1.55">' + g.rule + '</p>' +
      '<div class="grid2">' +
        '<div class="field"><label>Board number</label>' +
          '<div class="row" style="gap:8px">' +
            '<input class="inp" type="number" data-f="number" min="1" max="9999" value="' + q.number + '" style="min-width:0">' +
            '<button type="button" class="btn ghost sm" data-act="newboard" title="Pick another board">' + ico('refresh') + '</button>' +
          '</div>' +
          '<p class="faint" style="font-size:12px;margin-top:5px">Every device builds this same board.</p></div>' +
        '<div class="field"><label>Seconds to solve</label>' +
          '<input class="inp" type="number" data-f="time" min="30" max="900" step="15" value="' + q.time + '"></div>' +
        '<div class="field"><label>Points at stake</label>' +
          '<input class="inp" type="number" data-f="points" min="0" max="5000" step="50" value="' + q.points + '"></div>' +
      '</div>' +
      '<p class="faint" style="font-size:12.5px;line-height:1.55">The round ends when the time runs out or everyone ' +
        'has solved it. Points scale with how close each player was to the quickest solve.</p>' +
    '</div>' +
  '</article>';
}

function wireQuestions() {
  const host = $('#qlist');
  host.addEventListener('click', e => {
    const card = e.target.closest('.qcard'); if (!card) return;
    const q = qById(card.dataset.q); if (!q) return;
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act;
    const i = cfg.questions.indexOf(q);

    if (act === 'toggle') { openQ = (openQ === q.id ? null : q.id); renderQuestions(); return; }
    e.stopPropagation();
    if (act === 'up' && i > 0) { cfg.questions.splice(i - 1, 0, cfg.questions.splice(i, 1)[0]); }
    else if (act === 'down' && i < cfg.questions.length - 1) { cfg.questions.splice(i + 1, 0, cfg.questions.splice(i, 1)[0]); }
    else if (act === 'dup') { const c = JSON.parse(JSON.stringify(q)); c.id = uid(8); cfg.questions.splice(i + 1, 0, c); openQ = c.id; }
    else if (act === 'del') { cfg.questions.splice(i, 1); if (openQ === q.id) openQ = null; }
    else if (act === 'correct') { q.correct = Number(btn.closest('.opt-row').dataset.o); }
    else if (act === 'delopt') {
      const j = Number(btn.closest('.opt-row').dataset.o);
      if (q.options.length > 2) {
        q.options.splice(j, 1);
        if (q.correct === j) q.correct = 0; else if (q.correct > j) q.correct--;
      }
    }
    else if (act === 'addopt') { if (q.options.length < 6) q.options.push(''); }
    else if (act === 'addimg') { pickImageFor(q.id); return; }
    else if (act === 'rmimg') { delete q.image; }
    else if (act === 'pickgame') { q.game = btn.dataset.v; }
    else if (act === 'picklevel') { q.level = btn.dataset.v; }
    else if (act === 'newboard') { q.number = 1 + Math.floor(Math.random() * 900); }
    else return;
    save(); renderQuestions();
  });

  host.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('qhead')) { e.preventDefault(); e.target.click(); }
  });

  /* Live edits patch the model without re-rendering, so focus is never lost. */
  host.addEventListener('input', e => {
    const card = e.target.closest('.qcard'); if (!card) return;
    const q = qById(card.dataset.q); if (!q) return;
    const f = e.target.dataset.f;
    if (f === 'text') { q.text = e.target.value; const t = $('.qtitle', card); t.textContent = q.text.trim() || 'Untitled question'; t.classList.toggle('empty', !q.text.trim()); }
    else if (f === 'opt') { q.options[Number(e.target.closest('.opt-row').dataset.o)] = e.target.value; }
    else if (f === 'time') {
      q.time = q.kind === 'pz' ? clamp(Number(e.target.value) || 180, 30, 900)
                               : clamp(Number(e.target.value) || 20, 5, 300);
    }
    else if (f === 'points') { q.points = clamp(Number(e.target.value) || 0, 0, 5000); }
    else if (f === 'number') { q.number = clamp(Math.round(Number(e.target.value)) || 1, 1, 9999); }
    else return;
    save(); renderSummary();
  });
  host.addEventListener('change', e => {
    if (['time', 'points', 'number'].indexOf(e.target.dataset.f) >= 0) renderQuestions();
  });
}

/* -------------------------------------------------------------- teams UI */
function renderTeams() {
  const box = $('#team-rows'); if (!box) return;
  box.innerHTML = cfg.teams.map((t, i) =>
    '<div class="team-row" data-t="' + t.id + '">' +
      '<input class="inp" type="color" data-f="color" value="' + esc(t.color) + '" style="width:52px;flex:none" aria-label="Team colour">' +
      '<input class="inp" data-f="name" value="' + esc(t.name) + '" maxlength="24" placeholder="Team name">' +
      (cfg.teams.length > 2 ? '<button class="btn-ico danger" data-act="delteam" title="Remove team">' + ico('cross') + '</button>' : '') +
    '</div>').join('');
  $('#teams-card').classList.toggle('hide', !cfg.teamsEnabled);
  const on = $('#teams-on'); if (on) on.checked = cfg.teamsEnabled;
  const m = $('#team-metric'); if (m) m.value = cfg.teamMetric;
  const r = document.querySelector('input[name=assign][value="' + cfg.assign + '"]'); if (r) r.checked = true;
}
function wireTeams() {
  const box = $('#team-rows');
  box.addEventListener('input', e => {
    const row = e.target.closest('.team-row'); if (!row) return;
    const t = cfg.teams.find(x => x.id === row.dataset.t); if (!t) return;
    if (e.target.dataset.f === 'name') t.name = e.target.value;
    if (e.target.dataset.f === 'color') t.color = e.target.value;
    save();
  });
  box.addEventListener('click', e => {
    const btn = e.target.closest('[data-act=delteam]'); if (!btn) return;
    const row = e.target.closest('.team-row');
    if (cfg.teams.length <= 2) return;
    cfg.teams = cfg.teams.filter(x => x.id !== row.dataset.t);
    save(); renderTeams();
  });
  $('#btn-add-team').onclick = () => {
    if (cfg.teams.length >= 8) { toast('Eight teams is the maximum', 'bad'); return; }
    cfg.teams.push({ id: uid(6), name: 'Team ' + (cfg.teams.length + 1), color: TEAM_PALETTE[cfg.teams.length % TEAM_PALETTE.length] });
    save(); renderTeams();
  };
  $('#teams-on').onchange = e => { cfg.teamsEnabled = e.target.checked; save(); renderTeams(); };
  $('#team-metric').onchange = e => { cfg.teamMetric = e.target.value; save(); };
  $$('input[name=assign]').forEach(r => r.onchange = () => { cfg.assign = r.value; save(); });
}

/* -------------------------------------------------------------- rules UI */
function scorePreview() {
  const base = cfg.defPoints || 1000, w = cfg.speedW;
  const inst = Math.round(base * (1 - w + w * 1));
  const half = Math.round(base * (1 - w + w * 0.5));
  const last = Math.round(base * (1 - w));
  return 'On a ' + nf(base) + '-point question: answering instantly scores ' + nf(inst) +
    ', halfway through ' + nf(half) + ', and right on the buzzer ' + nf(last) + '. ' +
    (cfg.fastBonus ? 'The single fastest correct player also picks up ' + nf(cfg.fastBonus) + '. ' : '') +
    (cfg.streakBonus ? 'A run of correct answers adds ' + nf(cfg.streakBonus) + ' per extra one, up to five.' : '');
}
function renderRules() {
  const set = (id, v) => { const e = $(id); if (e) e.value = v; };
  set('#rule-speed', String(cfg.speedW));
  set('#rule-fastbonus', cfg.fastBonus);
  set('#rule-streak', cfg.streakBonus);
  set('#rule-wrong', cfg.wrongPenalty);
  set('#def-time', cfg.defTime);
  set('#def-points', cfg.defPoints);
  set('#host-pin', cfg.pin);
  const c = (id, v) => { const e = $(id); if (e) e.checked = v; };
  c('#pin-on', cfg.pinOn); c('#late-join', cfg.lateJoin);
  c('#show-players-lb', cfg.showPlayersLb); c('#shuffle-q', cfg.shuffle);
  c('#no-copy', cfg.noCopy);
  c('#sound-on', cfg.sound);
  $('#pin-field').classList.toggle('hide', !cfg.pinOn);
  const nm = document.querySelector('input[name=netmode][value="' + cfg.netMode + '"]'); if (nm) nm.checked = true;
  const p = $('#score-preview'); if (p) p.textContent = scorePreview();
  Q.Sound.enabled = cfg.sound;
}
function wireRules() {
  const num = (id, key, lo, hi) => {
    const e = $(id); if (!e) return;
    e.oninput = () => { cfg[key] = clamp(Number(e.value) || 0, lo, hi); save(); const p = $('#score-preview'); if (p) p.textContent = scorePreview(); };
  };
  num('#rule-fastbonus', 'fastBonus', 0, 2000);
  num('#rule-streak', 'streakBonus', 0, 1000);
  num('#rule-wrong', 'wrongPenalty', 0, 2000);
  num('#def-time', 'defTime', 5, 300);
  num('#def-points', 'defPoints', 0, 5000);
  $('#rule-speed').onchange = e => { cfg.speedW = Number(e.target.value); save(); $('#score-preview').textContent = scorePreview(); };
  $('#pin-on').onchange = e => { cfg.pinOn = e.target.checked; $('#pin-field').classList.toggle('hide', !cfg.pinOn); save(); };
  $('#host-pin').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); cfg.pin = e.target.value; save(); };
  $('#late-join').onchange = e => { cfg.lateJoin = e.target.checked; save(); };
  $('#show-players-lb').onchange = e => { cfg.showPlayersLb = e.target.checked; save(); };
  $('#shuffle-q').onchange = e => { cfg.shuffle = e.target.checked; save(); };
  $('#no-copy').onchange = e => { cfg.noCopy = e.target.checked; save(); };
  $('#sound-on').onchange = e => { cfg.sound = e.target.checked; Q.Sound.enabled = cfg.sound; save(); };
  $$('input[name=netmode]').forEach(r => r.onchange = () => { cfg.netMode = r.value; save(); });
}

/* ------------------------------------------------------------------ "go" */
function problems() {
  const out = [];
  if (!cfg.questions.length) out.push('Add at least one question.');
  const bad = cfg.questions.map((q, i) => questionSummary(q).bad ? (i + 1) : 0).filter(Boolean);
  if (bad.length) out.push('Question' + (bad.length > 1 ? 's ' : ' ') + bad.join(', ') + ' need a question, two or more filled options, and a correct answer.');
  if (cfg.teamsEnabled && cfg.teams.some(t => !t.name.trim())) out.push('Every team needs a name.');
  if (cfg.pinOn && cfg.pin.length < 4) out.push('A host PIN needs at least 4 digits.');
  return out;
}
function renderGo() {
  const n = cfg.questions.length;
  const t = cfg.questions.reduce((a, q) => a + q.time, 0);
  $('#go-summary').innerHTML =
    '<b>' + esc(cfg.title || 'Untitled quiz') + '</b> &mdash; ' + n + ' question' + (n === 1 ? '' : 's') +
    ', about ' + mmss(t) + ' of answering time' +
    (cfg.teamsEnabled ? ', ' + cfg.teams.length + ' teams' : ', individual play') +
    (cfg.netMode === 'online' ? ', open to any device.' : ', this device only.');
  const probs = problems();
  $('#go-problems').innerHTML = probs.length
    ? '<div class="card tight" style="border-color:rgba(255,197,61,.4);background:rgba(255,197,61,.1);text-align:left">' +
      '<b style="font-size:13.5px">Before you start</b><ul style="margin:8px 0 0;padding-left:20px;font-size:13.5px;line-height:1.7;color:var(--ink-dim)">' +
      probs.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div>'
    : '<span class="pill ok">Everything checks out</span>';
  $('#btn-open-room-2').disabled = probs.length > 0;
}

/* ------------------------------------------------------------ import/etc */
function doImport() {
  modal(
    '<h2 style="font-size:22px">Import a quiz</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">Paste JSON exported from Quiz Arena, or any array of <span class="mono">{text, options, correct}</span> objects.</p>' +
    '<textarea class="inp mono" id="imp-json" rows="10" style="margin-top:14px;font-size:12.5px" placeholder=\'{"title":"My quiz","questions":[{"text":"2 + 2?","options":["3","4"],"correct":1,"time":15,"points":1000}]}\'></textarea>' +
    '<p id="imp-err" style="color:var(--bad);font-size:13px;min-height:18px;margin-top:8px"></p>' +
    '<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost" data-close>Cancel</button>' +
    '<button class="btn primary" id="imp-go">Import</button></div>',
    (box, close) => {
      $('#imp-go', box).onclick = () => {
        let data;
        try { data = JSON.parse($('#imp-json', box).value); }
        catch (e) { $('#imp-err', box).textContent = 'That is not valid JSON.'; return; }
        if (Array.isArray(data)) data = { title: cfg.title, questions: data };
        if (!data || !Array.isArray(data.questions) || !data.questions.length) {
          $('#imp-err', box).textContent = 'No questions found in there.'; return;
        }
        const merged = Object.assign({}, cfg, { title: data.title || cfg.title, questions: data.questions });
        if (data.teams) merged.teams = data.teams;
        setConfig(merged);
        close();
        toast('Imported ' + cfg.questions.length + ' questions', 'ok');
      };
    });
}
/* Resolves true when the file actually reached the viewer, so callers only
   claim success when there was some. */
function download(name, text, mime) {
  const viaLink = () => {
    const url = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
    return true;
  };
  /* Sandboxed hosts block link-driven saves and hand the file over through
     their own confirmation instead. Anywhere else this branch is skipped. */
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return Promise.resolve(viaLink());
  return c.use('downloads').then(d => {
    if (!d) return viaLink();
    return d.save({ filename: name, data: text }).then(() => true, err => {
      const code = err && err.code;
      if (code === 'declined' || code === 'rate_limited') return false;
      if (code === 'rejected_extension' || code === 'extension_not_enabled') {
        toast('This viewer will not save ' + name.split('.').pop().toUpperCase() +
              ' files. The JSON export works here.', 'bad', 5000);
        return false;
      }
      return viaLink();
    });
  }, viaLink);
}

function doExport() {
  const out = {
    app: 'Quiz Arena', version: 1, title: cfg.title || 'Untitled quiz',
    teams: cfg.teamsEnabled ? cfg.teams : undefined,
    questions: cfg.questions.map(q => {
      const out = { text: q.text, options: q.options, correct: q.correct, time: q.time, points: q.points };
      if (q.image) out.image = q.image;       /* the quiz is not complete without it */
      return out;
    })
  };
  const slug = (cfg.title || 'quiz').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quiz';
  download(slug + '.json', JSON.stringify(out, null, 2)).then(ok => { if (ok) toast('Quiz exported', 'ok'); });
}
function doLibrary() {
  const lib = library();
  modal(
    '<div class="spread"><h2 style="font-size:22px">My quizzes</h2>' +
    '<button class="btn primary sm" id="lib-save">' + ico('plus') + 'Save current</button></div>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">Stored in this browser only &mdash; export to JSON if you want a copy you can move around.</p>' +
    '<div class="col" id="lib-list" style="margin-top:16px">' +
      (lib.length ? lib.map(e =>
        '<div class="team-row" data-id="' + e.id + '">' +
          '<div style="flex:1;min-width:0">' +
            '<b style="font-size:14px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.name) + '</b>' +
            '<span class="faint" style="font-size:12px">' + (e.config.questions || []).length + ' questions · ' +
              new Date(e.savedAt).toLocaleDateString() + '</span>' +
          '</div>' +
          '<button class="btn ghost xs" data-act="load">Load</button>' +
          '<button class="btn-ico danger" data-act="del" title="Delete">' + ico('cross') + '</button>' +
        '</div>').join('')
        : '<p class="empty-state">Nothing saved yet.</p>') +
    '</div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn ghost" data-close>Close</button></div>',
    (box, close) => {
      $('#lib-save', box).onclick = () => { saveToLibrary(); close(); toast('Saved to your quiz library', 'ok'); };
      $('#lib-list', box).addEventListener('click', e => {
        const row = e.target.closest('[data-id]'); if (!row) return;
        const act = e.target.closest('[data-act]'); if (!act) return;
        const id = row.dataset.id;
        if (act.dataset.act === 'load') {
          const entry = library().find(x => x.id === id);
          if (entry) { setConfig(entry.config); close(); toast('Loaded “' + entry.name + '”', 'ok'); }
        } else {
          LS.set(LIB_KEY, library().filter(x => x.id !== id));
          row.remove();
        }
      });
    });
}

/* ------------------------------------------------------------------ wire */
function renderAll() {
  const t = $('#quiz-title'); if (t) t.value = cfg.title;
  renderQuestions(); renderTeams(); renderRules();
}

function initBuilder() {
  $('#quiz-title').oninput = e => { cfg.title = e.target.value; save(); };
  $('#btn-add-q').onclick = () => {
    const q = blankQuestion(cfg.defTime, cfg.defPoints);
    cfg.questions.push(q); openQ = q.id; save(); renderQuestions();
    const card = $('.qcard[data-q="' + q.id + '"]');
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ta = $('textarea', card); if (ta) ta.focus(); }
  };
  $('#btn-add-pz').onclick = () => {
    const p = blankPuzzle(cfg.defPoints);
    cfg.questions.push(p);
    openQ = p.id;
    save(); renderQuestions(); stepTo('questions');
    $('.qcard[data-q="' + p.id + '"]').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  $('#btn-add-tf').onclick = () => {
    const q = tfQuestion(cfg.defTime, cfg.defPoints);
    cfg.questions.push(q); openQ = q.id; save(); renderQuestions();
    const card = $('.qcard[data-q="' + q.id + '"]');
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ta = $('textarea', card); if (ta) ta.focus(); }
  };
  $('#btn-sample').onclick = () => {
    if (cfg.questions.length && !confirm('Replace the current ' + cfg.questions.length + ' question(s) with the sample quiz?')) return;
    setConfig(Object.assign({}, cfg, { title: SAMPLE.title, questions: SAMPLE.questions }));
    toast('Sample quiz loaded', 'ok');
  };
  $('#btn-clear-q').onclick = () => {
    if (!cfg.questions.length) return;
    if (!confirm('Delete all ' + cfg.questions.length + ' questions?')) return;
    cfg.questions = []; openQ = null; save(); renderQuestions();
  };
  $$('.step').forEach(s => s.onclick = () => stepTo(s.dataset.tab));
  $('#btn-import').onclick = doImport;
  $('#btn-export').onclick = doExport;
  $('#btn-library').onclick = doLibrary;

  wireQuestions(); wireImages(); wireTeams(); wireRules();
  renderAll();
}

window.QA.Build = { init: initBuilder, getConfig, renderAll, stepTo, problems, download };
})();
