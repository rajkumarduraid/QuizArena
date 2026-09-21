/* ============================================================================
   Quiz Arena — host engine
   The host owns the truth: it times every answer against its own clock,
   scores them, and pushes a public snapshot to every connected device.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, clamp, roomCode, secs, mmss, nf, now, toast, modal, Sound, Confetti,
        LocalBus, PeerHost, RelayBus, Net, findRelay, shape, ico, countUp, codeLetters } = Q;
const V = Q.Views;

const HEARTBEAT_GRACE = 9000;   /* silence before a player counts as offline */
const TICK_MS = 200;

let G = null;              /* live game, or null */
let tickTimer = 0;
let bcastTimer = 0;
let lastStageKey = '';
let ringEl = null;

/* ------------------------------------------------------------------ setup */
function newGame(cfg) {
  const order = cfg.questions.map((q, i) => i);
  if (cfg.shuffle) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
  }
  return {
    cfg: JSON.parse(JSON.stringify(cfg)),
    code: roomCode(),
    phase: 'lobby',
    order, qi: -1,
    players: Object.create(null),
    cur: null,
    history: [],
    events: [],
    lock: false,
    net: null,
    startedAt: 0,
    endedAt: 0
  };
}
function curQ() {
  if (!G || G.qi < 0 || G.qi >= G.order.length) return null;
  return G.cfg.questions[G.order[G.qi]];
}
function playersArr() { return Object.keys(G.players).map(k => G.players[k]); }
function connectedArr() { return playersArr().filter(p => p.connected); }
function refreshPresence() {
  const t = now();
  playersArr().forEach(p => { p.connected = (t - p.lastSeen) < HEARTBEAT_GRACE; });
}

/* -------------------------------------------------------------- snapshot */
function teamStats() {
  if (!G.cfg.teamsEnabled) return [];
  return G.cfg.teams.map(t => {
    const mem = playersArr().filter(p => p.team === t.id);
    const total = mem.reduce((a, p) => a + p.score, 0);
    return {
      id: t.id, name: t.name, color: t.color,
      members: mem.length,
      total,
      avg: mem.length ? Math.round(total / mem.length) : 0,
      correct: mem.reduce((a, p) => a + p.correct, 0)
    };
  });
}
function gameStats() {
  let n = 0, sum = 0, right = 0, answered = 0, best = null;
  playersArr().forEach(p => {
    p.answers.forEach(a => {
      if (a.ms == null) return;
      n++; sum += a.ms; answered++;
      if (a.right) {
        right++;
        if (!best || a.ms < best.ms) best = { name: p.name, ms: a.ms, qn: a.qn };
      }
    });
  });
  return {
    avgMs: n ? Math.round(sum / n) : null,
    accuracy: answered ? Math.round(right / answered * 100) : null,
    best
  };
}
function publicPlayer(p) {
  const times = p.answers.filter(a => a.ms != null).map(a => a.ms);
  const rightTimes = p.answers.filter(a => a.right).map(a => a.ms);
  return {
    id: p.id, name: p.name, team: p.team, avatar: p.avatar || 0, score: p.score, correct: p.correct,
    streak: p.streak, connected: p.connected,
    answered: times.length,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    bestMs: rightTimes.length ? Math.min.apply(null, rightTimes) : null,
    fastWins: p.fastWins,
    lastMs: p.lastMs, lastGain: p.lastGain, lastRight: p.lastRight,
    hasAnswered: !!(G.cur && G.cur.answers[p.id])
  };
}
/* What a player should be told before committing: how long this will take,
   what each question is worth, and exactly how the points are decided. */
function briefing() {
  const qs = G.order.map(i => G.cfg.questions[i]);
  const times = qs.map(x => x.time), points = qs.map(x => x.points);
  return {
    questions: qs.length,
    seconds: times.reduce((a, b) => a + b, 0),
    timeMin: Math.min.apply(null, times), timeMax: Math.max.apply(null, times),
    pointsMin: Math.min.apply(null, points), pointsMax: Math.max.apply(null, points),
    pointsTotal: points.reduce((a, b) => a + b, 0),
    speedW: G.cfg.speedW,
    fastBonus: G.cfg.fastBonus,
    streakBonus: G.cfg.streakBonus,
    wrongPenalty: G.cfg.wrongPenalty,
    lateJoin: G.cfg.lateJoin,
    shuffle: G.cfg.shuffle,
    noCopy: G.cfg.noCopy,
    puzzles: qs.filter(x => x.kind === 'pz').length
  };
}

function snapshot() {
  const q = curQ();
  const showQ = G.phase === 'question' || G.phase === 'reveal';
  const h = G.history.length ? G.history[G.history.length - 1] : null;
  return {
    v: 1,
    code: G.code,
    phase: G.phase,
    title: G.cfg.title || 'Quiz',
    total: G.order.length,
    qi: G.qi,
    q: showQ && q ? { text: q.text, options: q.options, time: q.time, points: q.points,
                      hasImage: !!q.image } : null,
    endsIn: G.phase === 'question' && G.cur ? Math.max(0, G.cur.endsAt - now()) : 0,
    answeredNow: G.cur ? Object.keys(G.cur.answers).length : 0,
    reveal: (G.phase === 'reveal' && h) ? h : null,
    lastRound: h,
    teamsEnabled: G.cfg.teamsEnabled,
    teams: G.cfg.teams,
    teamMetric: G.cfg.teamMetric,
    teamStats: teamStats(),
    players: playersArr().map(publicPlayer),
    lock: G.lock,
    lateJoin: G.cfg.lateJoin,
    showPlayersLb: G.cfg.showPlayersLb,
    noCopy: G.cfg.noCopy,
    pz: G.pz ? { game: G.pz.game, level: G.pz.level, number: G.pz.number,
                 board: pzBoard(), scored: !!G.pz.scored, planned: !!G.pz.planned,
                 points: G.pz.points,
                 endsIn: G.pz.endsAt ? Math.max(0, G.pz.endsAt - now()) : 0 } : null,
    assign: G.cfg.assign,
    brief: briefing(),
    events: G.events.slice(-12).map(e => Object.assign({}, e, {
      right: (G.phase === 'question' && e.qn === G.qi + 1) ? null : e.right
    })),
    stats: gameStats()
  };
}

/* -------------------------------------------------------------- transport */
function bcast(immediate) {
  if (!G || !G.net) return;
  if (immediate) {
    clearTimeout(bcastTimer); bcastTimer = 0;
    G.net.send({ t: 'st', s: snapshot() });
    return;
  }
  if (bcastTimer) return;
  bcastTimer = setTimeout(() => { bcastTimer = 0; if (G && G.net) G.net.send({ t: 'st', s: snapshot() }); }, 180);
}

let warnedOffline = false;
let netFailed = false;
let relayInUse = false;
function setNet(state, text) {
  netFailed = state === 'error' || state === 'retry';
  if (state === 'error' && !warnedOffline && G && G.cfg.netMode === 'online') {
    warnedOffline = true;
    toast(relayInUse
      ? 'Lost contact with the quiz server. Check it is still running.'
      : 'Could not open the room to the internet. Players on this computer can still join in other tabs.', 'bad', 6000);
  }
  if (state === 'online') warnedOffline = false;
  if (G && G.phase === 'lobby') renderLobbyWarn();
  const cls = state === 'online' ? 'ok' : (state === 'local' ? 'accent' : (state === 'error' || state === 'taken' ? 'bad' : 'warn'));
  const parts =
    state === 'online' ? ['globe',     text || 'Open to any device'] :
    state === 'local'  ? ['laptop',    'This device only'] :
    state === 'taken'  ? ['alert',     'Code clash — reopening'] :
    state === 'error'  ? ['alert',     text || 'Offline'] :
                         ['hourglass', text || 'Connecting…'];
  ['#lobby-net', '#stage-net'].forEach(sel => {
    const el = $(sel); if (!el) return;
    el.className = 'pill ' + cls;
    el.innerHTML = ico(parts[0]) + '<span></span>';
    el.lastChild.textContent = parts[1];
  });
}

function openTransport() {
  const net = Net({ onMessage: onPlayerMessage });
  const code = G.code;
  G.net = net;
  net.add(LocalBus(code, net.accept));
  if (G.cfg.netMode !== 'online') { setNet('local', ''); return; }

  setNet('connecting', 'Publishing room…');
  /* A relay on this origin beats peer-to-peer everywhere it exists: it needs
     nothing but plain HTTP, so firewalls that kill WebRTC leave it alone. */
  findRelay().then(hasRelay => {
    if (!G || G.code !== code || G.net !== net) return;      /* room moved on */
    if (hasRelay) {
      relayInUse = true;
      net.add(RelayBus(code, net.accept, (state, text) =>
        setNet(state === 'online' ? 'online' : state, state === 'online' ? 'Open to any device' : text)));
      return;
    }
    relayInUse = false;
    net.add(PeerHost(code, net.accept, (state, text) => {
      if (state === 'taken') {
        /* Extremely rare, but a duplicate code would silently steal players. */
        setNet('taken', text);
        toast('That code was taken — switching to a new one', 'bad');
        restartWithNewCode();
        return;
      }
      setNet(state === 'online' ? 'online' : state, text);
    }));
  });
}
function restartWithNewCode() {
  const cfg = G.cfg, players = G.players;
  closeTransport();
  G.code = roomCode();
  G.players = players;
  openTransport();
  renderLobby();
}
function closeTransport() {
  if (G && G.net) { try { G.net.close(); } catch (e) {} G.net = null; }
}

/* ---------------------------------------------------- inbound from players */
function onPlayerMessage(m) {
  if (!G || !m || m.code !== G.code) return;

  if (m.t === 'hello') {
    handleJoin(m);
    return;
  }
  if (m.t === 'watch') { bcast(true); return; }
  if (m.t === 'hb') {
    const p = G.players[m.pid];
    if (p) { p.lastSeen = now(); if (!p.connected) { p.connected = true; bcast(); } }
    else if (m.name) handleJoin(m);          /* host restarted, player still here */
    return;
  }
  if (m.t === 'bye') {
    const p = G.players[m.pid];
    if (p) { p.connected = false; p.lastSeen = 0; bcast(); renderCurrent(); }
    return;
  }
  if (m.t === 'ans') { handleAnswer(m); return; }
  if (m.t === 'pzdone') {
    if (!G.pz || G.phase !== 'puzzle') return;
    const p = G.players[m.pid];
    if (!p || G.pz.times[m.pid] != null) return;
    G.pz.times[m.pid] = Math.max(1, now() - G.pz.at);
    Sound.tick();
    bcast(true); renderCurrent();
    return;
  }
  if (m.t === 'sync') { bcast(true); return; }
  if (m.t === 'needimg') {
    if (m.qi === G.qi) sendQuestionImage(m.pid);
    return;
  }
}

function smallestTeam() {
  const counts = G.cfg.teams.map(t => ({ id: t.id, n: playersArr().filter(p => p.team === t.id).length }));
  counts.sort((a, b) => a.n - b.n);
  return counts.length ? counts[0].id : null;
}

function handleJoin(m) {
  const name = String(m.name || '').trim().slice(0, 18) || 'Player';
  const existing = G.players[m.pid];

  if (!existing) {
    if (G.lock) { reply(m.pid, { t: 'deny', reason: 'The host has locked this room.' }); return; }
    if (G.phase !== 'lobby' && !G.cfg.lateJoin) { reply(m.pid, { t: 'deny', reason: 'This game has already started.' }); return; }
    if (G.phase === 'final') { reply(m.pid, { t: 'deny', reason: 'This game has finished.' }); return; }
    if (playersArr().length >= 60) { reply(m.pid, { t: 'deny', reason: 'This room is full.' }); return; }
    const taken = playersArr().some(p => p.name.toLowerCase() === name.toLowerCase());
    if (taken) { reply(m.pid, { t: 'deny', reason: 'Someone is already called “' + name + '”. Pick another name.' }); return; }
  }

  let team = null;
  if (G.cfg.teamsEnabled) {
    const wanted = G.cfg.teams.find(t => t.id === m.team);
    team = G.cfg.assign === 'auto' ? (existing ? existing.team : smallestTeam())
                                   : (wanted ? wanted.id : (existing ? existing.team : smallestTeam()));
  }

  const avatar = Number.isInteger(m.avatar) ? ((m.avatar % 30) + 30) % 30 : 0;
  const p = existing || {
    id: m.pid, name, team, avatar,
    score: 0, correct: 0, streak: 0, fastWins: 0,
    answers: [], lastMs: null, lastGain: null, lastRight: null,
    joinedAt: now()
  };
  p.name = name;
  if (Number.isInteger(m.avatar)) p.avatar = avatar;
  if (!existing || (G.cfg.assign === 'choose' && G.phase === 'lobby')) p.team = team;
  p.connected = true;
  p.lastSeen = now();
  G.players[p.id] = p;

  reply(p.id, { t: 'welcome', pid: p.id, name: p.name, team: p.team });
  bcast(true);
  renderCurrent();
  if (!existing) Sound.tick();
}
function reply(pid, msg) {
  if (G && G.net) G.net.send(Object.assign({ to: pid, code: G.code }, msg));
}

function handleAnswer(m) {
  if (!G.cur || G.phase !== 'question') return;
  const p = G.players[m.pid];
  if (!p) return;
  p.lastSeen = now();
  const q = curQ();
  if (!q || m.qid !== G.qi) return;                 /* stale answer, ignore */
  if (G.cur.answers[p.id]) return;                  /* already locked in     */
  const choice = Number(m.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;

  const ms = clamp(now() - G.cur.startedAt, 0, q.time * 1000);
  G.cur.answers[p.id] = { choice, ms };
  G.events.push({ name: p.name, team: p.team, avatar: p.avatar || 0, ms, right: choice === q.correct, qn: G.qi + 1 });
  if (G.events.length > 60) G.events.splice(0, G.events.length - 60);

  reply(p.id, { t: 'locked', qid: G.qi, ms });
  bcast();
  renderCurrent();
}

/* ----------------------------------------------------------- phase moves */
function goLobby() { G.phase = 'lobby'; bcast(true); renderLobby(); }

function askQuestion() {
  G.qi++;
  const q = curQ();
  if (!q) { finish(); return; }
  if (q.kind === 'pz') {
    startPuzzle(q.game, q.level, q.number, { planned: true, seconds: q.time, points: q.points });
    return;
  }
  G.phase = 'question';
  G.cur = { qid: q.id, startedAt: now(), endsAt: now() + q.time * 1000, answers: Object.create(null), allInAt: 0, warned: 0 };
  playersArr().forEach(p => { p.lastGain = null; p.lastMs = null; p.lastRight = null; });
  Sound.start();
  bcast(true);
  sendQuestionImage();
  lastStageKey = '';
  showScreen('s-stage');
  renderStage();
}

/* A picture is far larger than everything else in a snapshot, so it is sent
   once when the question opens and cached by each device. Anyone who joins
   late, reconnects, or simply misses the message asks for it by round. */
function sendQuestionImage(toPid) {
  const q = curQ();
  if (!q || !q.image || !G.net) return;
  G.net.send(toPid
    ? { t: 'img', to: toPid, code: G.code, qi: G.qi, src: q.image }
    : { t: 'img', code: G.code, qi: G.qi, src: q.image });
}

function reveal() {
  if (G.phase !== 'question' || !G.cur) return;
  const q = curQ();
  const ans = G.cur.answers;
  const w = G.cfg.speedW;

  let fastest = null;
  Object.keys(ans).forEach(pid => {
    const a = ans[pid];
    if (a.choice === q.correct && (!fastest || a.ms < fastest.ms)) fastest = { pid, ms: a.ms };
  });

  const dist = q.options.map(() => 0);
  Object.keys(ans).forEach(pid => { dist[ans[pid].choice]++; });

  refreshPresence();
  playersArr().forEach(p => {
    const a = ans[p.id];
    const right = !!(a && a.choice === q.correct);
    let gain = 0;
    if (right) {
      const sf = clamp(1 - (a.ms / (q.time * 1000)), 0, 1);
      gain = Math.round(q.points * (1 - w + w * sf));
      p.streak++;
      if (G.cfg.streakBonus && p.streak >= 2) gain += G.cfg.streakBonus * Math.min(p.streak - 1, 5);
      if (fastest && fastest.pid === p.id) { gain += G.cfg.fastBonus; p.fastWins++; }
      p.correct++;
    } else {
      p.streak = 0;
      if (a) gain = -G.cfg.wrongPenalty;
    }
    p.score = Math.max(0, p.score + gain);
    p.lastGain = a ? gain : null;
    p.lastMs = a ? a.ms : null;
    p.lastRight = a ? right : null;
    if (a || p.connected) p.answers.push({ qid: q.id, qn: G.qi + 1, choice: a ? a.choice : null, ms: a ? a.ms : null, right, gain });
  });

  const correctOnes = Object.keys(ans)
    .filter(pid => ans[pid].choice === q.correct)
    .map(pid => ({ id: pid, name: G.players[pid].name, team: G.players[pid].team,
                   avatar: G.players[pid].avatar || 0, ms: ans[pid].ms }))
    .sort((a, b) => a.ms - b.ms);

  G.history.push({
    qid: q.id, qn: G.qi + 1, text: q.text, correct: q.correct, options: q.options.slice(),
    dist, answered: Object.keys(ans).length, eligible: connectedArr().length,
    correctCount: correctOnes.length,
    fastest: fastest ? {
      id: fastest.pid, name: G.players[fastest.pid].name,
      team: G.players[fastest.pid].team, avatar: G.players[fastest.pid].avatar || 0,
      ms: fastest.ms, gain: G.players[fastest.pid].lastGain
    } : null,
    top: correctOnes.slice(0, 5),
    slowest: correctOnes.length ? correctOnes[correctOnes.length - 1] : null,
    avgMs: correctOnes.length ? Math.round(correctOnes.reduce((a, c) => a + c.ms, 0) / correctOnes.length) : null
  });

  G.phase = 'reveal';
  G.cur.revealedAt = now();
  if (correctOnes.length) Sound.right(); else Sound.times();
  bcast(true);
  lastStageKey = '';
  renderStage();
}

function showScores() { G.phase = 'scores'; bcast(true); lastStageKey = ''; renderStage(); }

/* ------------------------------------------------------------ puzzle round */
/* A puzzle break drops into the room between questions. Only the game, level
   and number travel — every device builds the identical board from those three
   numbers, so nothing the size of a grid ever goes over the wire.

   The clock that counts is the host's: from the moment the round is announced
   to the moment a "solved" lands here. A player's own timer is for them; this
   one is the same measurement for everybody and cannot be typed in from a
   phone. */
function pzBoard() {
  if (!G.pz) return [];
  return Object.keys(G.pz.times)
    .map(pid => {
      const p = G.players[pid];
      return { pid: pid, ms: G.pz.times[pid], gain: G.pz.gains[pid],
               name: p ? p.name : 'Player', avatar: p ? p.avatar : 0, team: p ? p.team : null };
    })
    .sort((a, b) => a.ms - b.ms);
}

function startPuzzle(game, level, number, opts) {
  if (!G || G.phase === 'final') return;
  opts = opts || {};
  /* an unplanned break remembers where it interrupted, so it can go back */
  if (!opts.planned) G.pzFrom = G.phase === 'puzzle' ? (G.pzFrom || 'lobby') : G.phase;
  G.pz = {
    game: game, level: level, number: number,
    at: now(),
    endsAt: opts.seconds ? now() + opts.seconds * 1000 : 0,
    seconds: opts.seconds || 0,
    points: opts.points == null ? (G.cfg.defPoints || 1000) : opts.points,
    planned: !!opts.planned,
    times: {}, gains: {}, allInAt: 0, warned: 0, scored: false
  };
  G.phase = 'puzzle';
  playersArr().forEach(p => { p.lastGain = null; p.lastMs = null; p.lastRight = null; });
  Sound.start();
  bcast(true);
  lastStageKey = '';
  showScreen('s-stage');
  renderStage();
}

/* Scoring and showing the result is the same whether the puzzle was planned
   into the quiz or dropped in as a break; only where it goes afterwards
   differs. */
function endPuzzle() {
  if (!G || !G.pz) return;
  scorePuzzle();
  G.phase = 'pzresult';
  bcast(true);
  lastStageKey = '';
  showScreen('s-stage');
  renderStage();
}

function afterPuzzle() {
  if (!G || !G.pz) return;
  const planned = G.pz.planned, back = G.pzFrom;
  G.pz = null; G.pzFrom = null;
  if (planned) { showScores(); return; }
  G.phase = back === 'question' ? 'scores' : (back || 'lobby');
  bcast(true);
  lastStageKey = '';
  if (G.phase === 'lobby') showScreen('s-lobby');
  renderCurrent();
}

/* Points scale with how close you were to the quickest solve, using the same
   speed weighting the quiz already runs on. Accuracy counters are left alone:
   a puzzle is not a question, and it should not move anyone's hit rate. */
function scorePuzzle() {
  if (!G.pz || G.pz.scored) return;
  G.pz.scored = true;
  const board = pzBoard();
  playersArr().forEach(p => { p.lastGain = null; p.lastMs = null; p.lastRight = null; });
  if (!board.length) return;
  const best = board[0].ms || 1;
  const w = G.cfg.speedW, base = G.pz.points == null ? (G.cfg.defPoints || 1000) : G.pz.points;
  board.forEach((row, i) => {
    const p = G.players[row.pid];
    if (!p) return;
    const frac = clamp(best / Math.max(1, row.ms), 0, 1);
    let gain = Math.round(base * (1 - w + w * frac));
    if (i === 0) gain += G.cfg.fastBonus || 0;
    G.pz.gains[row.pid] = gain;
    p.score += gain;
    p.lastGain = gain;
    p.lastMs = row.ms;
    p.lastRight = true;
    G.events.push({ kind: 'ans', name: p.name, avatar: p.avatar, team: p.team,
                    ms: row.ms, right: true, qn: G.qi + 1, at: now() });
  });
  G.events = G.events.slice(-40);
}

function nextStep() {
  if (G.phase === 'question') { reveal(); return; }
  if (G.phase === 'reveal') { showScores(); return; }
  if (G.phase === 'scores') {
    if (G.qi >= G.order.length - 1) finish(); else askQuestion();
    return;
  }
}

function finish() {
  G.phase = 'final';
  G.endedAt = now();
  G.cur = null;
  bcast(true);
  Sound.win();
  Confetti.fire(2600);
  showScreen('s-final');
  renderFinal();
}

function endEarly() {
  if (!confirm('End the game now and show final results?')) return;
  if (G.phase === 'question') reveal();
  finish();
}

/* ------------------------------------------------------------------ clock */
function tick() {
  if (!G) return;
  const before = connectedArr().length;
  refreshPresence();
  if (connectedArr().length !== before) { bcast(); renderCurrent(); }

  if (G.phase === 'question' && G.cur) {
    const q = curQ();
    const left = G.cur.endsAt - now();
    if (ringEl) V.setRing(ringEl, clamp(left / (q.time * 1000), 0, 1), left / 1000);
    const cnt = $('#answered-n');
    if (cnt) cnt.textContent = Object.keys(G.cur.answers).length;

    const sLeft = Math.ceil(left / 1000);
    if (sLeft <= 5 && sLeft > 0 && G.cur.warned !== sLeft) { G.cur.warned = sLeft; Sound.urgent(); }

    const conn = connectedArr();
    const el = $('#answered-of');
    if (el) el.textContent = conn.length;
    if (conn.length && conn.every(x => G.cur.answers[x.id])) {
      if (!G.cur.allInAt) G.cur.allInAt = now();
    } else G.cur.allInAt = 0;

    if (left <= 0) { reveal(); return; }
    if (G.cur.allInAt && now() - G.cur.allInAt > 700) { reveal(); return; }
  }

  if (G.phase === 'puzzle' && G.pz) {
    const conn = connectedArr();
    if (conn.length && conn.every(x => G.pz.times[x.id] != null)) {
      if (!G.pz.allInAt) G.pz.allInAt = now();
    } else G.pz.allInAt = 0;

    if (G.pz.endsAt) {
      const left = G.pz.endsAt - now();
      const el = $('#pz-left');
      if (el) el.textContent = mmss(Math.max(0, Math.ceil(left / 1000)));
      const sLeft = Math.ceil(left / 1000);
      if (sLeft <= 5 && sLeft > 0 && G.pz.warned !== sLeft) { G.pz.warned = sLeft; Sound.urgent(); }
      if (left <= 0) { endPuzzle(); return; }
    }
    /* nobody left to wait for */
    if (G.pz.allInAt && now() - G.pz.allInAt > 900) { endPuzzle(); return; }
  }
}

/* ==========================================================================
   Rendering
   ======================================================================== */
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (!G) return;
  if (G.phase === 'puzzle') renderStage();
  else if (G.phase === 'lobby') renderLobby();
  else if (G.phase === 'final') renderFinal();
  else renderStage();
}

/* ---------------------------------------------------------------- lobby */
const isServed = () => /^https?:$/.test(location.protocol);
function joinURL() {
  const base = isServed() ? location.origin + location.pathname : location.href.split('#')[0];
  return base + '#/join/' + G.code;
}
function renderQR() {
  const box = $('#qr-holder');
  if (!box) return;
  const usable = isServed() && G.cfg.netMode === 'online';
  if (!usable || typeof window.qrcode !== 'function') { box.hidden = true; return; }
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(joinURL());
    qr.make();
    box.innerHTML = qr.createImgTag(4, 0, 'Join QR code');
    box.hidden = false;
  } catch (e) { box.hidden = true; }
}

/* Two failures look identical from the lobby — a page opened straight off
   disk, and a page that cannot reach the signalling service — and both end
   with players typing a valid code into nothing. Name whichever applies. */
function renderLobbyWarn() {
  const box = $('#lobby-warn');
  if (!box || !G) return;
  const out = [];

  if (!isServed()) {
    out.push('<div class="notice stop"><span class="ic">' + ico('file') + '</span><div>' +
      '<b>This page is open as a file on your computer</b>' +
      '<p>Copying the file to a shared folder does not connect anyone: each person opens their own separate copy, ' +
      'and a join link from here would only point at a path on <em>your</em> hard drive, so it is switched off. ' +
      'To play across devices, put this page on a web address — GitHub Pages, or any static host — ' +
      'and share <em>that</em> link. Extra tabs and windows on this computer still work as they are.</p>' +
      '</div></div>');
  }
  if (G.cfg.netMode === 'local') {
    out.push('<div class="notice"><span class="ic">' + ico('laptop') + '</span><div>' +
      '<b>This room is set to “This device only”</b>' +
      '<p>Only other tabs and windows on this computer can join. ' +
      'Switch to “Any device” under <em>Rules &amp; access</em> to let phones and laptops in.</p>' +
      '</div></div>');
  } else if (netFailed && relayInUse) {
    out.push('<div class="notice stop"><span class="ic">' + ico('signal-off') + '</span><div>' +
      '<b>Lost contact with the quiz server</b>' +
      '<p>The page loaded, but the server carrying the game has stopped answering. ' +
      'Check the terminal window running it is still open, then reopen the room.</p>' +
      '</div></div>');
  } else if (netFailed) {
    out.push('<div class="notice stop"><span class="ic">' + ico('alert') + '</span><div>' +
      '<b>Could not reach the service that links devices together</b>' +
      '<p>Players on other devices will type a valid code and be told no room answered. ' +
      'This is a firewall or workplace network blocking peer-to-peer traffic — common at work and at school. ' +
      '<b style="display:inline">The fix is to run the quiz from the bundled server</b> ' +
      '(<span class="mono">node server.js</span>), which carries the game over ordinary web requests that ' +
      'firewalls allow. See the README for the two-line setup; a phone hotspot also works for a quick test.</p>' +
      '</div></div>');
  }
  box.innerHTML = out.join('');
}

function renderLobby() {
  if (!G) return;
  const codeEl = $('#room-code');
  if (codeEl.dataset.code !== G.code) { codeEl.dataset.code = G.code; codeEl.innerHTML = codeLetters(G.code); }
  const ec = $('#lobby-empty-code'); if (ec) ec.textContent = G.code;
  const served = isServed();
  $('#join-url').textContent = served ? joinURL() : '';
  $('#copy-link').disabled = !served;
  $('#copy-link').title = served ? '' : 'Only available when the page is open from a web address';
  renderQR();
  renderLobbyWarn();

  const snap = snapshot();
  const ps = playersArr();
  $('#player-count').textContent = ps.length;
  $('#lobby-empty').classList.toggle('hide', ps.length > 0);
  $('#lobby-hint').textContent = ps.length
    ? ps.length + ' in, start whenever you like'
    : 'Waiting for the first player…';
  $('#lobby-players').innerHTML = ps
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(p => '<span class="p-chip' + (p.connected ? '' : ' off') + '" data-p="' + p.id + '">' +
      Q.avatarSVG(p.avatar || 0, 'av-sm') + esc(p.name) + (G.cfg.teamsEnabled ? V.teamChip(snap, p.team) : '') +
      '<button class="x" data-act="kick" title="Remove ' + esc(p.name) + '">' + ico('cross') + '</button></span>').join('');

  $('#lobby-teams-card').classList.toggle('hide', !G.cfg.teamsEnabled);
  if (G.cfg.teamsEnabled) {
    $('#lobby-team-sizes').innerHTML = teamStats().map(t =>
      '<div class="team-bar" style="color:' + esc(t.color) + '">' +
        '<div class="lbl"><span style="color:var(--ink)">' + esc(t.name) + '</span>' +
        '<span style="color:var(--ink)" class="mono">' + t.members + '</span></div>' +
        '<div class="track"><div class="fill" style="width:' + (ps.length ? Math.round(t.members / Math.max(1, ps.length) * 100) : 0) +
          '%;background:' + esc(t.color) + '"></div></div></div>').join('');
  }

  $('#runsheet').innerHTML = G.order.map((oi, i) => {
    const q = G.cfg.questions[oi];
    if (q.kind === 'pz') {
      const g = (Q.Puzzles.GAMES.filter(x => x.id === q.game)[0] || { name: 'Puzzle' });
      return '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td style="white-space:normal;max-width:420px">' +
          '<span style="color:var(--brand);display:inline-flex;vertical-align:-3px;margin-right:5px">' +
            ico('puzzle') + '</span>' + esc(g.name) + ' &middot; #' + q.number + '</td>' +
        '<td><span class="pill accent">' + esc(q.level) + '</span></td>' +
        '<td class="num">' + q.time + 's</td><td class="num">' + nf(q.points) + '</td></tr>';
    }
    return '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td style="white-space:normal;max-width:420px">' +
        (q.image ? '<span style="color:var(--brand);display:inline-flex;vertical-align:-3px;margin-right:5px">' + ico('file') + '</span>' : '') +
        esc(q.text) + '</td>' +
      '<td><span style="color:' + Q.AHEX[q.correct] + ';display:inline-flex;vertical-align:-2px">' +
        shape(q.correct) + '</span> ' + esc(q.options[q.correct]) + '</td>' +
      '<td class="num">' + q.time + 's</td><td class="num">' + nf(q.points) + '</td></tr>';
  }).join('');

  $('#btn-start').disabled = ps.length === 0;
  $('#btn-start').innerHTML = ps.length ? ico('play') + 'Start game' : 'Waiting for players…';
  $('#room-lock').checked = G.lock;
}

/* Pick the board. The room only ever needs the game, the level and the number
   — everyone rebuilds the same grid from those. */
function askPuzzle() {
  const PZ = Q.Puzzles;
  const seen = Q.LS.get('qa:pzroom:v1', {});
  modal(
    '<h2 style="font-size:22px">Set a puzzle for the room</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">Everyone gets the same board on their own device. ' +
    'The clock runs from the moment you set it, and the scoreboard ranks whoever cracks it.</p>' +
    '<div class="col" style="gap:13px;margin-top:15px">' +
      '<div class="field"><label>Puzzle</label><div class="pz-levels" id="pk-game" style="flex-wrap:wrap">' +
        PZ.GAMES.map((g, i) => '<button data-g="' + g.id + '"' + (i === 0 ? ' class="on"' : '') + '>' +
          esc(g.name) + '</button>').join('') + '</div></div>' +
      '<div class="field"><label>Difficulty</label><div class="pz-levels" id="pk-level">' +
        PZ.LEVELS.map(l => '<button data-l="' + l + '"' + (l === 'medium' ? ' class="on"' : '') + '>' +
          l.charAt(0).toUpperCase() + l.slice(1) + '</button>').join('') + '</div></div>' +
      '<p class="faint" id="pk-rule" style="font-size:13px;line-height:1.55"></p>' +
    '</div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:16px">' +
      '<button class="btn ghost" data-close>Cancel</button>' +
      '<button class="btn primary" id="pk-go">Set it going</button></div>',
    (box, close) => {
      let game = PZ.GAMES[0].id, level = 'medium';
      const rule = () => {
        const g = PZ.GAMES.filter(x => x.id === game)[0];
        $('#pk-rule', box).textContent = g ? g.rule : '';
      };
      const wire = (sel, attr, set) => $$(sel + ' button', box).forEach(el => {
        el.onclick = () => {
          $$(sel + ' button', box).forEach(x => x.classList.remove('on'));
          el.classList.add('on');
          set(el.dataset[attr]);
          rule();
        };
      });
      wire('#pk-game', 'g', v => { game = v; });
      wire('#pk-level', 'l', v => { level = v; });
      rule();
      $('#pk-go', box).onclick = () => {
        const k = game + ':' + level;
        const n = (seen[k] || 0) + 1;
        seen[k] = n; Q.LS.set('qa:pzroom:v1', seen);
        close();
        startPuzzle(game, level, n);
      };
    });
}

/* ---------------------------------------------------------------- stage */
function stageControls() {
  const box = $('#stage-controls');
  const p = G.phase;
  let html = '';
  if (p === 'question') {
    html = '<button class="btn ghost sm" data-c="skip">' + ico('skip') + 'Skip</button>' +
           '<button class="btn primary" data-c="reveal">' + ico('eye') + 'Reveal answer</button>';
  } else if (p === 'reveal') {
    html = '<button class="btn primary" data-c="scores">Scoreboard' + ico('arrow-right') + '</button>';
  } else if (p === 'scores') {
    html = G.qi >= G.order.length - 1
      ? '<button class="btn go" data-c="finish">' + ico('flag') + 'Final results</button>'
      : '<button class="btn go" data-c="next">Next question' + ico('arrow-right') + '</button>';
  } else if (p === 'puzzle') {
    html = '<button class="btn primary" data-c="pzend">' + ico('flag') + 'End puzzle &amp; score it</button>';
  } else if (p === 'pzresult') {
    html = G.pz && G.pz.planned
      ? '<button class="btn primary" data-c="pznext">Scoreboard' + ico('arrow-right') + '</button>'
      : '<button class="btn primary" data-c="pznext">Back to the room' + ico('arrow-right') + '</button>';
  }
  if (p === 'reveal' || p === 'scores') {
    html += '<button class="btn ghost sm" data-c="puzzle">' + ico('puzzle') + 'Puzzle break</button>';
  }
  html += '<button class="btn ghost sm" data-c="dash" title="Open the dashboard in another window">' + ico('chart') + '</button>' +
          '<button class="btn danger sm" data-c="end">End</button>';
  box.innerHTML = html;
}

function renderStage() {
  if (!G) return;
  const onPuzzle = G.phase === 'puzzle' || G.phase === 'pzresult';
  $('#stage-progress').textContent = onPuzzle
    ? (G.pz && G.pz.planned ? 'Puzzle · round ' + (G.qi + 1) + ' / ' + G.order.length : 'Puzzle break')
    : 'Question ' + (G.qi + 1) + ' / ' + G.order.length;
  $('#stage-code').textContent = 'Code ' + G.code;
  stageControls();

  const snap = snapshot();
  const key = G.phase + ':' + G.qi;
  const main = $('#stage-main');

  if (G.phase === 'question') {
    if (lastStageKey !== key) {
      lastStageKey = key;
      main.innerHTML =
        '<div class="stage-top">' +
          '<div class="timer">' + V.ringHTML('stage-ring') +
            '<div><div class="answered-count"><span id="answered-n">0</span> <span class="dim" style="font-size:.55em">of ' +
              connectedArr().length + ' answered</span></div>' +
            '<p class="faint" style="font-size:12.5px;margin-top:2px">Reveals automatically when everyone is in.</p></div>' +
          '</div>' +
          '<span class="pill accent">' + nf(curQ().points) + ' points at stake</span>' +
        '</div>' +
        (curQ().image ? '<img class="qmedia" src="' + esc(curQ().image) + '" alt="">' : '') +
        '<div class="qtext">' + esc(curQ().text) + '</div>' +
        V.answersHTML(snap, { deal: true }) +
        '<div class="card tight"><h3 style="font-size:14px;margin-bottom:9px">Answers landing</h3><div id="stage-ticker">' +
          V.tickerHTML(snap) + '</div></div>';
      ringEl = $('#stage-ring');
    } else {
      const t = $('#stage-ticker'); if (t) t.innerHTML = V.tickerHTML(snap);
    }
    return;
  }

  ringEl = null;
  lastStageKey = key;

  if (G.phase === 'puzzle' || G.phase === 'pzresult') {
    const g = (Q.Puzzles.GAMES.filter(x => x.id === G.pz.game)[0] || {});
    const over = G.phase === 'pzresult';
    const solved = (snap.pz.board || []).length;
    main.innerHTML =
      '<div class="stage-top">' +
        '<div><h2 style="font-size:clamp(22px,3.4vw,34px)">' + esc(g.name || 'Puzzle') + '</h2>' +
        '<p class="dim" style="font-size:14px;margin-top:4px">' + (g.rule || '') + '</p></div>' +
        (over || !G.pz.endsAt ? '' :
          '<div class="answered-count" style="text-align:right"><span id="pz-left">' +
            mmss(Math.ceil(Math.max(0, G.pz.endsAt - now()) / 1000)) + '</span>' +
            '<span class="dim" style="font-size:.55em"> left</span></div>') +
        '<span class="pill accent">' + esc(G.pz.level) + ' &middot; #' + G.pz.number +
          ' &middot; ' + nf(G.pz.points) + ' pts</span>' +
      '</div>' +
      '<div class="card" style="margin-top:14px">' +
        '<h3 style="font-size:16px;margin-bottom:12px">' +
          (over ? 'How the room did' : 'Cracked it &mdash; ' + solved + ' so far') + '</h3>' +
        V.pzBoardHTML(snap) + '</div>' +
      '<p class="dim" style="font-size:13px;margin-top:12px">' +
        (over
          ? 'Points are on the scoreboard. Anyone who did not finish scores nothing for this round.'
          : 'Everyone is solving the same board on their own device. It ends when the time runs out, ' +
            'when everybody is done, or whenever you say so.') + '</p>';
    return;
  }

  if (G.phase === 'reveal') {
    const h = snap.reveal;
    main.innerHTML =
      (curQ() && curQ().image ? '<img class="qmedia" src="' + esc(curQ().image) + '" alt="" style="max-height:min(24vh,210px);margin-bottom:12px">' : '') +
      '<div class="qtext" style="font-size:clamp(19px,3vw,32px);padding:18px 22px">' + esc(h.text) + '</div>' +
      V.answersHTML(snap, { reveal: true }) +
      V.fastestHTML(snap) +
      '<div class="dash-grid">' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">How the room answered</h3>' +
          V.distHTML(snap) +
          '<p class="dim" style="font-size:13px;margin-top:12px">' + h.correctCount + ' of ' + h.answered +
            ' answers correct' + (h.avgMs != null ? ' · average correct time ' + secs(h.avgMs) : '') +
            (h.answered < h.eligible ? ' · ' + (h.eligible - h.answered) + ' did not answer' : '') + '</p>' +
        '</div>' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Quickest correct answers</h3>' +
          (V.speedListHTML(snap) || '<p class="empty-state">Nobody got this one right.</p>') + '</div>' +
      '</div>';
    return;
  }

  if (G.phase === 'scores') {
    const before = snapshotBoard(main);

    main.innerHTML =
      V.tilesHTML(snap) +
      '<div class="dash-grid">' +
        '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Leaderboard</h3>' + V.leaderboardHTML(snap, null, 10) + '</div>' +
        (snap.teamsEnabled
          ? '<div class="card"><h3 style="font-size:17px;margin-bottom:14px">Team race</h3>' + V.teamBarsHTML(snap) + '</div>'
          : '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Answers this round</h3>' + V.tickerHTML(snap) + '</div>') +
      '</div>' +
      (snap.teamsEnabled
        ? '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Answers this round</h3>' + V.tickerHTML(snap) + '</div>'
        : '');
    animateBoard(main, before);
    return;
  }
}

/* Replaying the round is the point of the scoreboard: totals climb from where
   they were, and rows physically overtake one another. Positions have to be
   read before the markup is replaced — the old nodes are gone afterwards, but
   each row carries a stable id so the new one can start where the old one was. */
function snapshotBoard(root) {
  const scores = {}, tops = {};
  root.querySelectorAll('[data-score]').forEach(el => { scores[el.dataset.score] = Number(el.dataset.v || 0); });
  root.querySelectorAll('[data-lb]').forEach(el => { tops[el.getAttribute('data-lb')] = el.getBoundingClientRect().top; });
  return { scores, tops, had: !!root.querySelector('.lb') };
}
function animateBoard(root, before) {
  root.querySelectorAll('[data-score]').forEach(el => {
    const to = Number(el.dataset.v || 0);
    const from = before.scores[el.dataset.score];
    if (before.had && from != null && from !== to) { el.dataset.v = from; countUp(el, to, 900); }
  });
  if (!before.had || Q.reduced()) return;
  root.querySelectorAll('[data-lb]').forEach(el => {
    const was = before.tops[el.getAttribute('data-lb')];
    if (was == null) return;
    const delta = was - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) return;
    el.classList.add('moving');
    el.animate([{ transform: 'translateY(' + delta + 'px)' }, { transform: 'none' }],
      { duration: 640, easing: 'cubic-bezier(.22,.8,.28,1)' }).onfinish = () => el.classList.remove('moving');
  });
}

/* ---------------------------------------------------------------- final */
function renderFinal() {
  if (!G) return;
  const snap = snapshot();
  const ps = snap.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const champTeam = snap.teamsEnabled
    ? snap.teamStats.slice().sort((a, b) => b[snap.teamMetric === 'avg' ? 'avg' : 'total'] - a[snap.teamMetric === 'avg' ? 'avg' : 'total'])[0]
    : null;

  const allTimes = [];
  G.history.forEach(h => { if (h.fastest) allTimes.push(Object.assign({ qn: h.qn }, h.fastest)); });
  const speedKing = ps.slice().filter(p => p.bestMs != null).sort((a, b) => a.bestMs - b.bestMs)[0];

  $('#final-main').innerHTML =
    '<div class="center" style="margin-bottom:6px">' +
      '<h1 style="font-size:clamp(30px,5.5vw,52px)">' + esc(snap.title) + '</h1>' +
      '<p class="dim" style="margin-top:8px">' + snap.total + ' questions · ' + ps.length + ' players' +
        (champTeam ? ' · ' + snap.teamStats.length + ' teams' : '') + '</p>' +
    '</div>' +
    V.podiumHTML(snap) +
    (champTeam && champTeam.members
      ? '<div class="fastest" style="background:linear-gradient(102deg,' + esc(champTeam.color) + '1a,#fff 62%);border-color:' + esc(champTeam.color) + '66;margin-bottom:16px">' +
        '<span class="bolt" style="animation:none;background:' + esc(champTeam.color) + ';box-shadow:none">' + ico('trophy') +
        '</span><div><p class="lab" style="color:' + esc(champTeam.color) + '">Winning team</p>' +
        '<div class="who">' + esc(champTeam.name) + '</div></div>' +
        '<div class="secs" style="color:' + esc(champTeam.color) + '">' + nf(champTeam.total) + '<small>POINTS · ' + nf(champTeam.avg) + ' AVG</small></div></div>'
      : '') +
    (speedKing
      ? '<div class="fastest" style="margin-bottom:16px"><span class="bolt">' + ico('stopwatch') + '</span>' +
        Q.avatarSVG(speedKing.avatar || 0, 'av-md') + '<div>' +
        '<p class="lab">Fastest single answer of the game</p>' +
        '<div class="who">' + esc(speedKing.name) + '</div>' +
        '<div style="margin-top:6px">' + (snap.teamsEnabled ? V.teamChip(snap, speedKing.team) : '') +
        ' <span class="pill warn">' + ico('bolt') + speedKing.fastWins + ' round' + (speedKing.fastWins === 1 ? '' : 's') + ' won on speed</span></div></div>' +
        '<div class="secs">' + secs(speedKing.bestMs) + '<small>PERSONAL BEST</small></div></div>'
      : '') +
    '<div class="dash-grid" style="margin-bottom:18px">' +
      (snap.teamsEnabled ? '<div class="card"><h3 style="font-size:17px;margin-bottom:14px">Final team standings</h3>' + V.teamBarsHTML(snap) + '</div>' : '') +
      '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Fastest correct answer, round by round</h3>' +
        (allTimes.length
          ? '<div class="speed-list">' + allTimes.map(f =>
              '<div class="speed-row"><span class="rank-badge">' + f.qn + '</span>' +
              Q.avatarSVG(f.avatar || 0, 'av-sm') +
              '<span class="nm">' + esc(f.name) + '</span>' +
              (snap.teamsEnabled ? V.teamChip(snap, f.team) : '') +
              '<span class="tm">' + secs(f.ms) + '</span></div>').join('') + '</div>'
          : '<p class="empty-state">No correct answers were recorded.</p>') +
      '</div>' +
    '</div>' +
    '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Every player</h3>' + V.finalTableHTML(snap) + '</div>';
}

/* ----------------------------------------------------------- export data */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCSV() {
  const snap = snapshot();
  const ps = snap.players.slice().sort((a, b) => b.score - a.score);
  const teams = {}; (snap.teams || []).forEach(t => teams[t.id] = t.name);
  const head = ['Rank', 'Player', 'Team', 'Score', 'Correct', 'Answered', 'Accuracy %', 'Avg seconds', 'Fastest seconds', 'Fastest-answer wins'];
  const rows = ps.map((p, i) => [
    i + 1, p.name, teams[p.team] || '', p.score, p.correct, p.answered,
    p.answered ? Math.round(p.correct / p.answered * 100) : '',
    p.avgMs != null ? (p.avgMs / 1000).toFixed(2) : '',
    p.bestMs != null ? (p.bestMs / 1000).toFixed(2) : '',
    p.fastWins
  ]);
  const perQ = [[], ['Question', 'Correct answer', 'Answered', 'Correct', 'Fastest player', 'Fastest seconds']]
    .concat(G.history.map(h => [
      h.text, h.options[h.correct], h.answered, h.correctCount,
      h.fastest ? h.fastest.name : '', h.fastest ? (h.fastest.ms / 1000).toFixed(2) : ''
    ]));
  const csv = [head].concat(rows).concat(perQ).map(r => r.map(csvCell).join(',')).join('\r\n');
  Q.Build.download('quiz-results-' + G.code + '.csv', csv, 'text/csv');
}
function exportJSON() {
  const snap = snapshot();
  Q.Build.download('quiz-results-' + G.code + '.json', JSON.stringify({
    app: 'Quiz Arena', code: G.code, title: snap.title,
    playedAt: new Date(G.startedAt || now()).toISOString(),
    teams: snap.teamStats, players: snap.players, rounds: G.history
  }, null, 2));
}

/* ------------------------------------------------------------------ wire */
function openDashboardWindow() {
  const url = location.href.split('#')[0] + '#/dash/' + G.code;
  const w = window.open(url, 'qa-dash-' + G.code, 'width=1280,height=860');
  if (!w) toast('Your browser blocked the pop-up — allow pop-ups, or open the dashboard link manually', 'bad', 5000);
}

function startRoom() {
  const cfg = Q.Build.getConfig();
  const probs = Q.Build.problems();
  if (probs.length) { Q.Build.stepTo('go'); toast(probs[0], 'bad', 4000); return; }
  if (G) { closeTransport(); }
  G = newGame(cfg);
  warnedOffline = false;
  netFailed = false;
  relayInUse = false;
  Sound.enabled = cfg.sound;
  Sound.unlock();
  openTransport();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, TICK_MS);
  showScreen('s-lobby');
  renderLobby();
  location.hash = '#/host';
}

function initHost() {
  $('#btn-open-room').onclick = startRoom;
  $('#btn-open-room-2').onclick = startRoom;

  $('#copy-code').onclick = () => copy(G.code, 'Code copied');
  $('#copy-link').onclick = () => copy(joinURL(), 'Join link copied');
  $('#lobby-dash').onclick = openDashboardWindow;
  $('#room-lock').onchange = e => { G.lock = e.target.checked; bcast(true); toast(G.lock ? 'Room locked' : 'Room open', G.lock ? 'bad' : 'ok'); };
  $('#lobby-back').onclick = () => {
    if (playersArr().length && !confirm('Players are already waiting. Close the room and go back to editing?')) return;
    closeTransport(); clearInterval(tickTimer); G = null;
    showScreen('s-build'); location.hash = '#/host';
  };
  $('#btn-rebalance').onclick = () => {
    if (!G.cfg.teamsEnabled) return;
    const ps = playersArr().sort((a, b) => a.joinedAt - b.joinedAt);
    ps.forEach((p, i) => { p.team = G.cfg.teams[i % G.cfg.teams.length].id; });
    bcast(true); renderLobby(); toast('Teams rebalanced', 'ok');
  };
  $('#btn-start').onclick = () => {
    if (!playersArr().length) return;
    G.startedAt = now();
    Sound.unlock();
    askQuestion();
  };

  $('#lobby-players').addEventListener('click', e => {
    const chip = e.target.closest('[data-p]'); if (!chip) return;
    if (!e.target.closest('[data-act=kick]')) return;
    const p = G.players[chip.dataset.p]; if (!p) return;
    if (!confirm('Remove ' + p.name + ' from the room?')) return;
    reply(p.id, { t: 'kick' });
    delete G.players[p.id];
    bcast(true); renderLobby();
  });

  $('#stage-controls').addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = b.dataset.c;
    if (c === 'reveal' || c === 'skip') reveal();
    else if (c === 'scores') showScores();
    else if (c === 'next') askQuestion();
    else if (c === 'finish') finish();
    else if (c === 'end') endEarly();
    else if (c === 'dash') openDashboardWindow();
    else if (c === 'puzzle') askPuzzle();
    else if (c === 'pzend') endPuzzle();
    else if (c === 'pznext') afterPuzzle();
  });

  $('#lobby-puzzle').onclick = askPuzzle;

  $('#btn-export-csv').onclick = exportCSV;
  $('#btn-export-json').onclick = exportJSON;
  $('#btn-print').onclick = () => window.print();
  $('#btn-again').onclick = () => {
    closeTransport(); clearInterval(tickTimer); G = null;
    showScreen('s-build'); location.hash = '#/host';
  };

  /* Host keyboard shortcuts — handy when the laptop is on a lectern. */
  document.addEventListener('keydown', e => {
    if (!G || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (!$('#s-stage').classList.contains('on')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); nextStep(); }
    else if (e.key.toLowerCase() === 'r' && G.phase === 'question') { e.preventDefault(); reveal(); }
  });

  addEventListener('beforeunload', e => {
    if (G && G.phase !== 'final' && Object.keys(G.players).length) {
      e.preventDefault(); e.returnValue = '';
    }
  });
}

function copy(text, msg) {
  const done = () => toast(msg, 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed — select it manually', 'bad'); }
    ta.remove();
  }
}

function resume() {
  if (!G) return false;
  if (G.phase === 'lobby') { showScreen('s-lobby'); renderLobby(); }
  else if (G.phase === 'final') { showScreen('s-final'); renderFinal(); }
  else { lastStageKey = ''; showScreen('s-stage'); renderStage(); }
  return true;
}

window.QA.Host = { init: initHost, startRoom, showScreen, resume, isLive: () => !!G, copy };
})();
