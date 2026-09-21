/* ============================================================================
   Quiz Arena — player device, spectator dashboard, router
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, $$, esc, clamp, uid, secs, nf, now, modal, SS, Sound, Confetti,
        LocalBus, PeerClient, RelayBus, Net, findRelay, shape, ico, markSVG, countUp,
        avatarSVG, avatarCount } = Q;
const V = Q.Views;

/* ======================================================= shared client bus */
function connect(code, onMsg, onStatus, delay) {
  let heard = false, closed = false;
  const net = Net({ onMessage: m => { heard = true; onMsg(m); } });
  net.add(LocalBus(code, net.accept));

  /* A room running in another tab on this machine answers in milliseconds.
     Only when nothing local replies do we open a peer-to-peer connection,
     which keeps offline and same-device games entirely off the network. */
  let reached = false;
  const reachOut = () => {
    if (reached) return;
    reached = true;
    const status = onStatus || function () {};
    findRelay().then(hasRelay => {
      if (closed) return;
      net.add(hasRelay ? RelayBus(code, net.accept, status)
                       : PeerClient(code, net.accept, status));
    });
  };
  const timer = setTimeout(() => { if (!heard) reachOut(); }, delay == null ? 600 : delay);

  const baseClose = net.close;
  net.close = () => { closed = true; clearTimeout(timer); baseClose(); };
  return net;
}

/* ============================================================ PLAYER =====*/
const P = {
  pzKey: '',
  pid: null, name: '', team: null, code: '',
  net: null, snap: null, lastSnapAt: 0,
  picked: Object.create(null),      /* qid -> chosen index          */
  lockedMs: Object.create(null),    /* qid -> host-measured ms      */
  hb: 0, tick: 0, renderKey: '', ring: null, endsAt: 0,
  joinWait: 0, peerText: '', ok: false, avatar: null,
  images: Object.create(null), imgAsked: Object.create(null)
};

function pid() {
  let v = SS.get('qa:pid', null);
  if (!v) { v = uid(12); SS.set('qa:pid', v); }
  return v;
}

function playerStatus() {
  const el = $('#play-net'); if (!el) return;
  const fresh = now() - P.lastSnapAt < 8000;
  if (fresh) { el.className = 'pill ok'; el.innerHTML = '<span class="dot live"></span> Live'; }
  else {
    el.className = 'pill warn';
    el.innerHTML = ico('hourglass') + '<span></span>';
    el.lastChild.textContent = P.lastSnapAt ? 'Reconnecting…' : (P.peerText || 'Connecting…');
  }
}

function sendJoin() {
  P.net.send({ t: 'hello', code: P.code, pid: P.pid, name: P.name, team: P.team, avatar: P.avatar || 0 });
}

function startPlayer(code, name, team, avatar) {
  P.code = code; P.name = name; P.team = team; P.pid = pid();
  if (avatar != null) P.avatar = avatar;
  P.snap = null; P.lastSnapAt = 0; P.ok = false;
  P.picked = Object.create(null); P.lockedMs = Object.create(null);
  P.images = Object.create(null); P.imgAsked = Object.create(null);
  if (P.net) { try { P.net.close(); } catch (e) {} }
  P.net = connect(code, onHostMessage, (state, text) => {
    P.peerText = text || state;
    if (state === 'notfound' && !P.ok) { /* the host may simply be local-only */ }
    playerStatus();
  });
  sendJoin();
  clearInterval(P.joinWait);
  let tries = 0;
  P.joinWait = setInterval(() => {
    if (P.ok) { clearInterval(P.joinWait); return; }
    if (++tries > 9) {
      clearInterval(P.joinWait);
      showJoinError('No room answered to code ' + code + '.',
        '<div class="notice" style="margin-bottom:0;text-align:left"><span class="ic">' + ico('search') + '</span><div>' +
        '<b>Three things to check</b><p>' +
        '1. The host still has the room open on their screen.<br>' +
        '2. You and the host opened the <em>same web address</em>. Opening your own copy of the file &mdash; ' +
        'from a shared folder, email or a download &mdash; puts you on an island that cannot reach anyone else.<br>' +
        '3. Your network allows the connection. Office and school networks often block the peer-to-peer traffic ' +
        'this uses \u2014 a phone hotspot is a quick way to tell. If it is blocked, ask the host to run the quiz ' +
        'from the bundled server, which works over ordinary web requests.' +
        '</p></div></div>');
      return;
    }
    sendJoin();
  }, 900);

  clearInterval(P.hb);
  P.hb = setInterval(() => {
    if (P.net) P.net.send({ t: 'hb', code: P.code, pid: P.pid, name: P.name });
    playerStatus();
  }, 3000);
  clearInterval(P.tick);
  P.tick = setInterval(playerTick, 200);
}

function leavePlayer() {
  if (P.net) { P.net.send({ t: 'bye', code: P.code, pid: P.pid }); try { P.net.close(); } catch (e) {} }
  P.net = null;
  clearInterval(P.hb); clearInterval(P.tick); clearInterval(P.joinWait);
}

function showJoinError(msg, hint) {
  Q.Host.showScreen('s-join');
  $('#join-step-code').classList.remove('hide');
  $('#join-step-name').classList.add('hide');
  $('#join-err').textContent = msg;
  $('#name-err').textContent = '';
  const box = $('#join-hint');
  if (box) {
    box.innerHTML = hint || '';
    box.classList.toggle('hide', !hint);
  }
}

function onHostMessage(m) {
  if (!m || (m.code && m.code !== P.code)) return;
  if (m.to && m.to !== P.pid) return;

  if (m.t === 'welcome') {
    P.ok = true; clearInterval(P.joinWait);
    P.name = m.name; P.team = m.team;
    SS.set('qa:last', { code: P.code, name: P.name, team: P.team, avatar: P.avatar || 0 });
    Q.Host.showScreen('s-play');
    P.renderKey = '';
    return;
  }
  if (m.t === 'deny') {
    clearInterval(P.joinWait);
    leavePlayer();
    Q.Host.showScreen('s-join');
    $('#join-step-code').classList.add('hide');
    $('#join-step-name').classList.remove('hide');
    $('#name-err').style.color = 'var(--bad)';
    $('#name-err').textContent = m.reason || 'The host turned that request down.';
    return;
  }
  if (m.t === 'kick') {
    leavePlayer();
    showJoinError('The host removed you from the room.');
    return;
  }
  if (m.t === 'locked') { P.lockedMs[m.qid] = m.ms; renderPlayer(); return; }
  if (m.t === 'img') {
    if (typeof m.src === 'string' && /^data:image\//.test(m.src)) {
      P.images[m.qi] = m.src;
      P.renderKey = '';
      renderPlayer();
    }
    return;
  }
  if (m.t === 'st') {
    P.snap = m.s; P.lastSnapAt = now();
    if (!P.ok) { P.ok = true; clearInterval(P.joinWait); Q.Host.showScreen('s-play'); }
    if (m.s.phase === 'question') P.endsAt = now() + (m.s.endsIn || 0);
    askForImage(m.s);
    syncPuzzle(m.s);
    renderPlayer();
    playerStatus();
  }
}

/* A puzzle break swaps this device over to the board and back again. Only the
   game, level and number arrive; the board is rebuilt here from those, which is
   why a race costs no more to send than a scoreboard. */
function syncPuzzle(snap) {
  if (snap.phase === 'puzzle' && snap.pz) {
    const key = snap.pz.game + ':' + snap.pz.level + ':' + snap.pz.number;
    if (P.pzKey !== key) {
      P.pzKey = key;
      Q.PuzzleUI.startRace({
        game: snap.pz.game, level: snap.pz.level, number: snap.pz.number,
        snap: snap, meId: P.pid, endsIn: snap.pz.endsIn,
        onSolved: () => { if (P.net) P.net.send({ t: 'pzdone', code: P.code, pid: P.pid }); }
      });
    } else {
      Q.PuzzleUI.raceSnapshot(snap, P.pid, snap.pz.endsIn);
    }
    return;
  }
  if (P.pzKey) {
    P.pzKey = '';
    Q.PuzzleUI.stopRace();
    Q.Host.showScreen('s-play');
    P.renderKey = '';
  }
}

/* The picture arrives in its own message; if this device missed it — joined
   late, reconnected, dropped a packet — ask for it once per round. */
function askForImage(snap) {
  if (!snap.q || !snap.q.hasImage) return;
  const qi = snap.qi;
  if (P.images[qi] || P.imgAsked[qi]) return;
  P.imgAsked[qi] = true;
  if (P.net) P.net.send({ t: 'needimg', code: P.code, pid: P.pid, qi });
  /* one retry, in case the reply was the thing that went missing */
  setTimeout(() => {
    if (!P.images[qi] && P.net && P.snap && P.snap.qi === qi) {
      P.net.send({ t: 'needimg', code: P.code, pid: P.pid, qi });
    }
  }, 2500);
}
const roundImage = qi => P.images[qi] || null;

function me() {
  if (!P.snap) return null;
  return (P.snap.players || []).find(p => p.id === P.pid) || null;
}
function myRank() {
  if (!P.snap) return null;
  const ps = P.snap.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const i = ps.findIndex(p => p.id === P.pid);
  return i < 0 ? null : { rank: i + 1, of: ps.length };
}

function playerTick() {
  if (!P.snap || P.snap.phase !== 'question' || !P.ring) return;
  const left = P.endsAt - now();
  const total = (P.snap.q && P.snap.q.time * 1000) || 1;
  V.setRing(P.ring, clamp(left / total, 0, 1), left / 1000);
}

function renderPlayer() {
  const snap = P.snap;
  const body = $('#play-body');
  if (!body) return;
  if (snap && snap.phase === 'puzzle') return;   /* the board has the screen */
  body.classList.toggle('no-copy', !snap || snap.noCopy !== false);
  const nameEl = $('#play-name');
  nameEl.innerHTML = avatarSVG(P.avatar || 0, 'av-sm') + '<span></span>';
  nameEl.lastChild.textContent = P.name;
  const m = me();
  $('#play-score').textContent = m ? nf(m.score) : '0';
  $('#play-team').innerHTML = snap && snap.teamsEnabled ? V.teamChip(snap, P.team) : '';

  if (!snap) {
    body.innerHTML = '<div class="verdict"><span class="em">' + ico('signal-off') + '</span><h2>Connecting</h2>' +
      '<p class="dim waitdots">Looking for room ' + esc(P.code) + '</p></div>';
    return;
  }

  const round = snap.qi;
  const key = snap.phase + ':' + round +
    ':' + (P.picked[round] != null ? 'p' : 'o') +
    ':' + (P.lockedMs[round] != null ? 't' : '') +
    ':' + (m && m.hasAnswered ? 'h' : '') +
    ':' + (roundImage(round) ? 'i' : '');

  if (snap.phase === 'lobby') {
    body.innerHTML =
      '<div class="verdict good" style="padding:22px 18px">' +
        '<span class="em" style="background:none;box-shadow:none;width:auto;height:auto">' +
          avatarSVG(P.avatar || 0, 'av-xl') + '</span>' +
        '<h2>You&rsquo;re in, ' + esc(P.name) + '</h2>' +
        (snap.teamsEnabled && P.team ? '<div>' + V.teamChip(snap, P.team) + '</div>' : '') +
        '<span class="pill accent">' + ico('users') + snap.players.length +
          ' player' + (snap.players.length === 1 ? '' : 's') + ' in the room</span>' +
        '<p class="dim waitdots" style="font-size:14px">Waiting for the host to start</p>' +
      '</div>' +
      V.briefHTML(snap) +
      '<button class="btn ghost sm" id="p-leave" style="align-self:center">Leave the game</button>';
    wireLeave();
    P.renderKey = key; P.ring = null;
    return;
  }

  if (snap.phase === 'board') {
    const tiles = snap.board || [];
    const left = tiles.filter(t => !t.done).length;
    const key2 = 'board:' + snap.picked;
    if (P.renderKey === key2) return;
    P.renderKey = key2; P.ring = null;
    body.innerHTML =
      '<div class="verdict" style="padding:20px 16px">' +
        '<span class="em">' + ico('grid') + '</span>' +
        '<h2>Pick a number</h2>' +
        '<p class="dim waitdots" style="font-size:14px">Someone in the room is choosing</p>' +
        '<span class="pill">' + (left ? left + ' of ' + tiles.length + ' left' : 'all played') + '</span>' +
      '</div>' +
      V.boardHTML(snap, {});
    return;
  }

  if (snap.phase === 'question') {
    const chosen = P.picked[round];
    const alreadyIn = chosen == null && m && m.hasAnswered;
    if (P.renderKey !== key) {
      P.renderKey = key;
      if (alreadyIn) {
        body.innerHTML =
          '<div class="verdict"><span class="em">' + ico('lock') + '</span><h2>Answer already in</h2>' +
          '<p class="dim">Your answer for this question is locked with the host.</p>' +
          '<span class="pill">' + snap.answeredNow + ' of ' + snap.players.filter(x => x.connected).length + ' answered</span></div>';
        P.ring = null;
      } else if (chosen == null) {
        body.innerHTML =
          '<div class="row" style="justify-content:space-between;gap:14px">' +
            V.ringHTML('p-ring') +
            '<span class="pill accent">Q' + (snap.qi + 1) + ' / ' + snap.total + ' · ' + nf(snap.q.points) + ' pts</span>' +
          '</div>' +
          (roundImage(round) ? '<img class="qmedia" src="' + esc(roundImage(round)) + '" alt="">' : '') +
          '<div class="qtext" style="font-size:clamp(19px,4.4vw,30px);padding:16px 18px">' + esc(snap.q.text) + '</div>' +
          V.answersHTML(snap, { clickable: true, deal: true });
        P.ring = $('#p-ring');
        body.querySelectorAll('[data-pick]').forEach(b => {
          b.onclick = () => pick(Number(b.dataset.pick));
        });
      } else {
        const ms = P.lockedMs[round];
        body.innerHTML =
          '<div class="verdict">' +
            '<span class="em">' + ico('lock') + '</span><h2>Answer locked in</h2>' +
            '<p class="dim" style="font-size:15px">You picked ' +
              '<b style="color:' + Q.AHEX[chosen] + ';display:inline-flex;align-items:center;gap:5px;vertical-align:-3px">' +
              shape(chosen) + esc(snap.q.options[chosen]) + '</b></p>' +
            (ms != null ? '<div class="pts">' + secs(ms) + '</div><p class="faint" style="font-size:12.5px">time on the clock</p>' : '') +
            '<p class="dim waitdots" style="margin-top:8px">Waiting for the rest of the room</p>' +
            '<span class="pill">' + snap.answeredNow + ' of ' + snap.players.filter(p => p.connected).length + ' answered</span>' +
          '</div>';
        P.ring = null;
      }
    } else if (chosen != null || alreadyIn) {
      const pill = body.querySelector('.pill');
      if (pill) pill.textContent = snap.answeredNow + ' of ' + snap.players.filter(x => x.connected).length + ' answered';
    }
    return;
  }

  if (snap.phase === 'reveal') {
    const r = snap.reveal;
    const chosen = P.picked[round];
    const right = chosen != null && chosen === r.correct;
    const gain = m ? m.lastGain : null;
    const mine = m ? m.lastMs : null;
    const iAmFastest = r.fastest && r.fastest.id === P.pid;
    if (P.renderKey !== key) {
      P.renderKey = key; P.ring = null;
      if (right) Sound.right(); else if (chosen != null) Sound.wrong();
      if (iAmFastest) Confetti.fire(1400);
      body.innerHTML =
        '<div class="verdict ' + (chosen == null ? '' : right ? (iAmFastest ? 'good gold' : 'good') : 'bad') + '">' +
          '<span class="em">' + (chosen == null ? ico('hourglass')
            : right ? (iAmFastest ? ico('stopwatch') : ico('check-circle')) : ico('cross-circle')) + '</span>' +
          '<h2>' + (chosen == null ? 'Out of time' : right ? (iAmFastest ? 'Fastest in the room!' : 'Correct!') : 'Not this time') + '</h2>' +
          (mine != null ? '<p class="dim" style="font-size:15px">You answered in <b class="mono">' + secs(mine) + '</b></p>' : '') +
          (gain ? '<div class="pts">' + (gain > 0 ? '+' : '') + nf(gain) + '</div>' : '') +
          (!right ? '<p class="dim" style="font-size:15px">The answer was ' +
            '<b style="color:' + Q.AHEX[r.correct] + ';display:inline-flex;align-items:center;gap:5px;vertical-align:-3px">' +
            shape(r.correct) + esc(r.options[r.correct]) + '</b></p>' : '') +
          (m && m.streak >= 2 ? '<span class="pill warn">' + ico('flame') + m.streak + ' in a row</span>' : '') +
        '</div>' +
        (r.fastest && !iAmFastest
          ? '<div class="card tight"><div class="row"><span class="bolt" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--gold);color:#fff;flex:none">' + ico('stopwatch') + '</span>' +
            '<div style="flex:1;min-width:0"><b>' + esc(r.fastest.name) + '</b> was fastest' +
            '<div class="faint" style="font-size:12.5px">' + r.correctCount + ' of ' + r.answered + ' got it right</div></div>' +
            '<span style="font-family:var(--display);font-weight:800;color:var(--gold)">' + secs(r.fastest.ms) + '</span></div></div>'
          : '') +
        (snap.showPlayersLb ? '<div class="card tight"><h3 style="font-size:14px;margin-bottom:10px">Quickest correct</h3>' +
          (V.speedListHTML(snap, P.pid) || '<p class="faint center" style="font-size:13px">Nobody got it.</p>') + '</div>' : '');
    }
    return;
  }

  if (snap.phase === 'pzresult' && snap.pz) {
    if (P.renderKey === key) return;
    P.renderKey = key; P.ring = null;
    const mine = (snap.pz.board || []).filter(r => r.pid === P.pid)[0];
    const place = mine ? (snap.pz.board || []).indexOf(mine) + 1 : 0;
    const g = (Q.Puzzles.GAMES.filter(x => x.id === snap.pz.game)[0] || {});
    if (mine) Sound.right(); else Sound.wrong();
    if (place === 1) Confetti.fire(1600);
    body.innerHTML =
      '<div class="verdict ' + (mine ? (place === 1 ? 'good gold' : 'good') : '') + '">' +
        '<span class="em">' + (mine ? (place === 1 ? ico('trophy') : ico('check-circle')) : ico('hourglass')) + '</span>' +
        '<h2>' + (mine ? (place === 1 ? 'First to crack it!' : ordinal(place) + ' to solve it') : 'Time&rsquo;s up') + '</h2>' +
        '<p class="dim" style="font-size:14px">' + esc(g.name || 'Puzzle') + '</p>' +
        (mine ? '<p class="dim" style="font-size:15px">You solved it in <b class="mono">' + secs(mine.ms) + '</b></p>'
              : '<p class="dim" style="font-size:15px">No points this round &mdash; there is always the next one.</p>') +
        (mine && mine.gain ? '<div class="pts">+' + nf(mine.gain) + '</div>' : '') +
      '</div>' +
      (snap.showPlayersLb
        ? '<div class="card tight"><h3 style="font-size:14px;margin-bottom:10px">How the room did</h3>' +
          V.pzBoardHTML(snap, P.pid) + '</div>'
        : '');
    return;
  }

  if (snap.phase === 'scores') {
    if (P.renderKey === key) return;
    P.renderKey = key; P.ring = null;
    const r = myRank();
    body.innerHTML =
      '<div class="verdict" style="padding:24px 18px">' +
        '<span class="em"' + (r && r.rank === 1 ? ' style="background:var(--gold);color:#fff"' : '') + '>' +
          (r && r.rank === 1 ? ico('crown') : ico('chart')) + '</span>' +
        '<h2 style="font-size:clamp(22px,5vw,32px)">' + (r ? 'You are ' + ordinal(r.rank) + ' of ' + r.of : 'Scoreboard') + '</h2>' +
        '<div class="pts">' + nf(m ? m.score : 0) + '</div>' +
        '<p class="faint" style="font-size:12.5px">' + (m ? m.correct + ' correct' + (m.bestMs != null ? ' · best ' + secs(m.bestMs) : '') : '') + '</p>' +
      '</div>' +
      (snap.showPlayersLb
        ? '<div class="card tight"><h3 style="font-size:14px;margin-bottom:10px">Leaderboard</h3>' +
          V.leaderboardHTML(snap, P.pid, 5) + '</div>' +
          (snap.teamsEnabled ? '<div class="card tight"><h3 style="font-size:14px;margin-bottom:12px">Team race</h3>' + V.teamBarsHTML(snap) + '</div>' : '')
        : '<p class="dim center" style="font-size:13.5px">The host is showing the scoreboard on the big screen.</p>');
    return;
  }

  if (snap.phase === 'final') {
    if (P.renderKey === key) return;
    P.renderKey = key; P.ring = null;
    const r = myRank();
    if (r && r.rank <= 3) Confetti.fire(2400);
    const champ = snap.teamsEnabled
      ? snap.teamStats.slice().sort((a, b) => b[snap.teamMetric === 'avg' ? 'avg' : 'total'] - a[snap.teamMetric === 'avg' ? 'avg' : 'total'])[0]
      : null;
    body.innerHTML =
      '<div class="verdict ' + (r && r.rank === 1 ? 'good gold' : r && r.rank <= 3 ? 'good' : '') + '">' +
        '<span class="em">' + (r && r.rank <= 3 ? ico('trophy') : ico('flag')) + '</span>' +
        '<h2>' + (r ? ordinal(r.rank) + ' place' : 'Game over') + '</h2>' +
        '<div class="pts">' + nf(m ? m.score : 0) + '</div>' +
        (m ? '<p class="dim" style="font-size:14px">' + m.correct + ' of ' + m.answered + ' correct' +
          (m.bestMs != null ? ' · fastest ' + secs(m.bestMs) : '') +
          (m.fastWins ? ' · ' + m.fastWins + ' speed win' + (m.fastWins === 1 ? '' : 's') : '') + '</p>' : '') +
        (champ && champ.members ? '<span class="pill accent">' + ico('trophy') + esc(champ.name) + ' take the team title</span>' : '') +
      '</div>' +
      '<div class="card tight"><h3 style="font-size:14px;margin-bottom:10px">Final standings</h3>' +
        V.leaderboardHTML(snap, P.pid, 10) + '</div>' +
      '<button class="btn ghost sm" id="p-leave" style="align-self:center">Leave</button>';
    wireLeave();
    return;
  }
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function wireLeave() {
  const b = $('#p-leave');
  if (b) b.onclick = () => { leavePlayer(); location.hash = '#/'; route(); };
}
function pick(i) {
  const snap = P.snap;
  if (!snap || snap.phase !== 'question') return;
  if (P.picked[snap.qi] != null) return;
  P.picked[snap.qi] = i;
  Sound.tick();
  P.net.send({ t: 'ans', code: P.code, pid: P.pid, qid: snap.qi, choice: i });
  P.renderKey = '';
  renderPlayer();
}

/* Rounds are keyed by index, not question id: the host never reveals the id
   while a question is live, and the index is stable from ask through reveal. */

/* ---------------------------------------------------------- join screens */
function initJoin() {
  const codeIn = $('#in-code'), nameIn = $('#in-name');

  codeIn.addEventListener('input', () => {
    codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    $('#join-err').textContent = '';
    $('#join-hint').classList.add('hide');
  });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-code-next').click(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

  $('#btn-code-next').onclick = () => {
    const c = codeIn.value.trim().toUpperCase();
    if (c.length !== 6) { $('#join-err').textContent = 'Game codes are six characters.'; codeIn.classList.add('err'); return; }
    codeIn.classList.remove('err');
    P.code = c;
    location.hash = '#/join/' + c;
    showNameStep(c);
  };

  buildAvatarPicker();

  $('#btn-join').onclick = () => {
    const n = nameIn.value.trim().slice(0, 18);
    if (n.length < 1) {
      $('#name-err').style.color = 'var(--bad)';
      $('#name-err').textContent = 'We need something to call you.';
      nameIn.classList.add('err'); nameIn.focus(); return;
    }
    if (P.avatar == null) {
      $('#name-err').style.color = 'var(--bad)';
      $('#name-err').textContent = 'Pick an avatar to play as.';
      $('#avatar-grid').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    nameIn.classList.remove('err');
    $('#name-err').style.color = 'var(--muted)';
    $('#name-err').textContent = 'Joining…';
    Sound.unlock();
    const teamBtn = $('#team-pick-list .p-chip.sel');
    startPlayer(P.code, n, teamBtn ? teamBtn.dataset.team : null, P.avatar);
  };

  $('#join-home').onclick = () => { leavePlayer(); location.hash = '#/'; route(); };
}


/* Thirty faces, one required pick. Everyone in the room is then recognisable
   at a glance on the leaderboard rather than being one more line of text. */
function buildAvatarPicker() {
  Q.avatarPackReady.then(paintAvatarPicker);
}
function paintAvatarPicker() {
  const grid = $('#avatar-grid');
  if (!grid || grid.childElementCount) return;
  let html = '';
  for (let i = 0; i < avatarCount(); i++) {
    html += '<button type="button" class="av-opt" role="radio" aria-checked="false" ' +
      'data-av="' + i + '" aria-label="' + Q.esc(Q.avatarName(i)) + '" title="' + Q.esc(Q.avatarName(i)) + '">' +
      avatarSVG(i) + '</button>';
  }
  grid.innerHTML = html;
  grid.addEventListener('click', e => {
    const b = e.target.closest('[data-av]');
    if (!b) return;
    selectAvatar(Number(b.dataset.av));
  });
}
function selectAvatar(i) {
  P.avatar = i;
  $$('#avatar-grid [data-av]').forEach(b =>
    b.setAttribute('aria-checked', String(Number(b.dataset.av) === i)));
  const status = $('#avatar-status');
  if (status) {
    status.className = 'pill ok';
    status.innerHTML = ico('check') + '<span></span>';
    status.lastChild.textContent = Q.avatarName(i);
  }
  const err = $('#name-err');
  if (err && /Pick an avatar/.test(err.textContent)) err.textContent = '';
  const chosen = $('#avatar-grid [aria-checked=true]');
  if (chosen) chosen.scrollIntoView({ block: 'nearest' });
}
function resetAvatarStatus() {
  const status = $('#avatar-status');
  if (!status) return;
  if (P.avatar == null) { status.className = 'pill'; status.textContent = 'Tap one to continue'; }
  else selectAvatar(P.avatar);
}

function showNameStep(code) {
  Q.Host.showScreen('s-join');
  $('#join-step-code').classList.add('hide');
  $('#join-step-name').classList.remove('hide');
  $('#join-code-pill').textContent = code;
  $('#name-err').textContent = '';
  const last = SS.get('qa:last', null);
  if (last && last.name && !$('#in-name').value) $('#in-name').value = last.name;
  buildAvatarPicker();
  if (P.avatar == null && last && Number.isInteger(last.avatar)) P.avatar = last.avatar;
  resetAvatarStatus();
  setTimeout(() => $('#in-name').focus(), 60);
  peekRoom(code);
}

/* Ask the room what teams it has so the picker can be filled in before joining. */
let peekNet = null;
function peekRoom(code) {
  if (peekNet) { try { peekNet.close(); } catch (e) {} peekNet = null; }
  $('#team-pick').classList.add('hide');
  peekNet = connect(code, m => {
    if (m.t !== 'st' || m.s.code !== code) return;
    const s = m.s;
    if (!s.teamsEnabled || s.assign !== 'choose') { $('#team-pick').classList.add('hide'); return; }
    const counts = {};
    s.teamStats.forEach(t => counts[t.id] = t.members);
    $('#team-pick-list').innerHTML = s.teams.map((t, i) =>
      '<button class="p-chip" data-team="' + esc(t.id) + '" style="border-color:' + esc(t.color) + '66">' +
      '<span class="swatch" style="background:' + esc(t.color) + '"></span>' + esc(t.name) +
      '<span class="faint" style="font-size:12px">' + (counts[t.id] || 0) + '</span></button>').join('');
    $('#team-pick').classList.remove('hide');
    const list = $('#team-pick-list');
    list.onclick = e => {
      const b = e.target.closest('[data-team]'); if (!b) return;
      $$('.p-chip', list).forEach(x => { x.classList.remove('sel'); x.style.background = ''; });
      b.classList.add('sel');
      const t = s.teams.find(x => x.id === b.dataset.team);
      if (t) b.style.background = t.color + '33';
    };
  }, () => {});
  peekNet.send({ t: 'watch', code: code, pid: 'peek-' + uid(6) });
  setTimeout(() => { if (peekNet) { try { peekNet.close(); } catch (e) {} peekNet = null; } }, 20000);
}

/* =========================================================== DASHBOARD ===*/
const D = { code: '', net: null, snap: null, last: 0, tick: 0, ring: null, key: '',
            images: Object.create(null), imgAsked: Object.create(null) };

function startDash(code) {
  D.code = code;
  if (D.net) { try { D.net.close(); } catch (e) {} }
  $('#dash-code').textContent = code;
  D.net = connect(code, m => {
    if (m.t === 'img' && typeof m.src === 'string' && /^data:image\//.test(m.src)) {
      D.images[m.qi] = m.src; D.key = ''; renderDash(); return;
    }
    if (m.t !== 'st' || m.s.code !== code) return;
    D.snap = m.s; D.last = now();
    if (m.s.phase === 'question') D.endsAt = now() + (m.s.endsIn || 0);
    if (m.s.q && m.s.q.hasImage && !D.images[m.s.qi] && !D.imgAsked[m.s.qi]) {
      D.imgAsked[m.s.qi] = true;
      D.net.send({ t: 'needimg', code: code, pid: 'dash', qi: m.s.qi });
    }
    renderDash();
  }, (state, text) => { D.peer = text || state; dashStatus(); });
  D.net.send({ t: 'watch', code: code, pid: 'dash-' + uid(6) });
  clearInterval(D.tick);
  D.tick = setInterval(() => {
    dashStatus();
    if (D.net && now() - D.last > 4000) D.net.send({ t: 'watch', code: code, pid: 'dash' });
    if (D.snap && D.snap.phase === 'question' && D.ring) {
      const total = (D.snap.q && D.snap.q.time * 1000) || 1;
      V.setRing(D.ring, clamp((D.endsAt - now()) / total, 0, 1), (D.endsAt - now()) / 1000);
    }
  }, 250);
  Q.Host.showScreen('s-dash');
  renderDash();
}
function dashStatus() {
  const el = $('#dash-net'); if (!el) return;
  const fresh = now() - D.last < 8000;
  el.className = 'pill ' + (fresh ? 'ok' : 'warn');
  if (fresh) el.innerHTML = '<span class="dot live"></span> Live';
  else { el.innerHTML = ico('hourglass') + '<span></span>'; el.lastChild.textContent = D.peer || 'Waiting for the host…'; }
  const ph = $('#dash-phase');
  if (ph && D.snap) {
    const map = { lobby: 'Lobby', question: 'Question in play', reveal: 'Answer revealed',
                  board: 'Pick a number', pzresult: 'Puzzle result', scores: 'Scoreboard',
                  final: 'Final results' };
    /* a puzzle built into the quiz is a round; one dropped in mid-session is a
       break, and the room should be told which it is looking at */
    map.puzzle = (D.snap.pz && D.snap.pz.planned) ? 'Puzzle round' : 'Puzzle break';
    ph.textContent = map[D.snap.phase] || D.snap.phase;
  }
}
function renderDash() {
  const snap = D.snap, main = $('#dash-main');
  if (!main) return;
  dashStatus();
  if (!snap) {
    main.innerHTML = '<div class="card center" style="padding:60px 20px"><h2 style="font-size:24px">Waiting for room ' + esc(D.code) + '</h2>' +
      '<p class="dim" style="margin-top:8px">Open this dashboard while the host has the room running.</p></div>';
    return;
  }
  main.classList.toggle('no-copy', snap.noCopy !== false);
  const key = snap.phase + ':' + snap.qi + ':' + (D.images[snap.qi] ? 'i' : '');
  const rebuilt = D.key !== key;
  D.key = key;

  if (snap.phase === 'lobby') {
    main.innerHTML = '<div class="card center" style="padding:44px 20px">' +
      '<p class="dim" style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;font-weight:750">Join at code</p>' +
      '<div class="code-big">' + Q.codeLetters(snap.code) + '</div>' +
      '<p class="dim">' + esc(snap.title) + ' · ' + snap.total + ' questions</p>' +
      '<div class="player-grid" style="justify-content:center;margin-top:22px">' +
        snap.players.map(p => '<span class="p-chip">' + esc(p.name) +
          (snap.teamsEnabled ? V.teamChip(snap, p.team) : '') + '</span>').join('') +
      '</div>' +
      (snap.players.length ? '' : '<p class="empty-state">Nobody has joined yet.</p>') +
      '</div>';
    D.ring = null;
    return;
  }

  if (snap.phase === 'question') {
    if (rebuilt) {
      main.innerHTML =
        '<div class="stage-top" style="margin-bottom:14px">' +
          '<div class="timer">' + V.ringHTML('dash-ring') +
            '<div><div class="answered-count"><span id="dash-answered">0</span> <span class="dim" style="font-size:.55em">answered</span></div></div></div>' +
          '<span class="pill accent">Question ' + (snap.qi + 1) + ' / ' + snap.total + '</span>' +
        '</div>' +
        (D.images[snap.qi] ? '<img class="qmedia" src="' + esc(D.images[snap.qi]) + '" alt="" style="margin-bottom:12px">' : '') +
        '<div class="qtext" style="font-size:clamp(20px,3.4vw,38px)">' + esc(snap.q.text) + '</div>' +
        '<div style="height:14px"></div>' +
        V.answersHTML(snap, { deal: true }) +
        '<div style="height:16px"></div>' +
        '<div class="card"><h3 style="font-size:15px;margin-bottom:10px">Answers landing live</h3><div id="dash-ticker"></div></div>';
      D.ring = $('#dash-ring');
    }
    const a = $('#dash-answered'); if (a) a.textContent = snap.answeredNow;
    const t = $('#dash-ticker'); if (t) t.innerHTML = V.tickerHTML(snap);
    return;
  }

  D.ring = null;
  if (snap.phase === 'board') {
    const tiles = snap.board || [];
    const left = tiles.filter(t => !t.done).length;
    main.innerHTML =
      '<div class="center" style="margin-bottom:20px">' +
        '<p class="dim" style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;font-weight:750">' +
          esc(snap.title) + '</p>' +
        '<h1 style="font-size:clamp(30px,5.5vw,52px)">Pick a number</h1>' +
        '<span class="pill accent" style="margin-top:12px">' +
          (left ? left + ' of ' + tiles.length + ' still to go' : 'All ' + tiles.length + ' played') +
        '</span>' +
      '</div>' +
      V.boardHTML(snap, { big: true });
    return;
  }
  if ((snap.phase === 'puzzle' || snap.phase === 'pzresult') && snap.pz) {
    const g = (Q.Puzzles.GAMES.filter(x => x.id === snap.pz.game)[0] || {});
    const solved = (snap.pz.board || []).length;
    main.innerHTML =
      '<div class="center" style="margin-bottom:16px">' +
        '<p class="dim" style="letter-spacing:.2em;text-transform:uppercase;font-size:12px;font-weight:750">' +
          (snap.phase === 'pzresult' ? 'Puzzle result'
            : snap.pz.planned ? 'Puzzle round' : 'Puzzle break') + '</p>' +
        '<h1 style="font-size:clamp(28px,5vw,46px)">' + esc(g.name || 'Puzzle') + '</h1>' +
        '<p class="dim" style="margin-top:6px;font-size:15px">' + (g.rule || '') + '</p>' +
        '<span class="pill accent" style="margin-top:12px">' + esc(snap.pz.level) + ' &middot; #' + snap.pz.number +
          ' &middot; ' + solved + ' solved' +
          (snap.phase === 'puzzle' && snap.pz.endsIn ? ' &middot; ' + Q.mmss(Math.ceil(snap.pz.endsIn / 1000)) + ' left' : '') +
          '</span>' +
      '</div>' +
      '<div class="dash-grid">' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Cracked it</h3>' +
          V.pzBoardHTML(snap) + '</div>' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Leaderboard so far</h3>' +
          V.leaderboardHTML(snap, null, 10) + '</div>' +
      '</div>';
    return;
  }
  if (snap.phase === 'reveal') {
    main.innerHTML =
      V.fastestHTML(snap) +
      '<div style="height:16px"></div>' +
      '<div class="dash-grid">' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">' + esc(snap.reveal.text) + '</h3>' + V.distHTML(snap) + '</div>' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Quickest correct</h3>' +
          (V.speedListHTML(snap) || '<p class="empty-state">Nobody got this one.</p>') + '</div>' +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Leaderboard</h3>' + V.leaderboardHTML(snap, null, 8) + '</div>' +
      '</div>';
    return;
  }
  if (snap.phase === 'final') {
    main.innerHTML = '<div class="center"><h1 style="font-size:clamp(28px,5vw,46px)">' + esc(snap.title) + '</h1></div>' +
      V.podiumHTML(snap) +
      '<div class="dash-grid">' +
        (snap.teamsEnabled ? '<div class="card"><h3 style="font-size:16px;margin-bottom:14px">Team standings</h3>' + V.teamBarsHTML(snap) + '</div>' : '') +
        '<div class="card"><h3 style="font-size:16px;margin-bottom:12px">Everyone</h3>' + V.leaderboardHTML(snap, null, 20) + '</div>' +
      '</div>';
    return;
  }
  /* scores */
  const before = dashBoardSnapshot(main);
  main.innerHTML =
    V.tilesHTML(snap) +
    '<div style="height:16px"></div>' +
    '<div class="dash-grid">' +
      '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Leaderboard</h3>' + V.leaderboardHTML(snap, null, 12) + '</div>' +
      (snap.teamsEnabled ? '<div class="card"><h3 style="font-size:17px;margin-bottom:14px">Team race</h3>' + V.teamBarsHTML(snap) + '</div>' : '') +
      '<div class="card"><h3 style="font-size:17px;margin-bottom:12px">Answer feed</h3>' + V.tickerHTML(snap) + '</div>' +
    '</div>';
  dashBoardAnimate(main, before);
}

/* The projector shows the same overtaking as the host screen. */
function dashBoardSnapshot(root) {
  const scores = {}, tops = {};
  root.querySelectorAll('[data-score]').forEach(el => { scores[el.dataset.score] = Number(el.dataset.v || 0); });
  root.querySelectorAll('[data-lb]').forEach(el => { tops[el.getAttribute('data-lb')] = el.getBoundingClientRect().top; });
  return { scores, tops, had: !!root.querySelector('.lb') };
}
function dashBoardAnimate(root, before) {
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

/* ============================================================== ROUTER ===*/
function hostGate(then) {
  const cfg = Q.Build.getConfig();
  if (!cfg.pinOn || !cfg.pin || SS.get('qa:unlocked', false)) { then(); return; }
  modal(
    '<h2 style="font-size:22px">Host PIN</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">This device asks for a PIN before the host controls open.</p>' +
    '<input class="inp mono" id="pin-in" inputmode="numeric" maxlength="8" placeholder="••••" ' +
      'style="margin-top:14px;font-size:26px;text-align:center;letter-spacing:.4em">' +
    '<p id="pin-err" style="color:var(--bad);font-size:13px;min-height:18px;margin-top:8px"></p>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close>Cancel</button>' +
    '<button class="btn primary" id="pin-go">Unlock</button></div>',
    (box, close) => {
      const go = () => {
        if ($('#pin-in', box).value === cfg.pin) { SS.set('qa:unlocked', true); close(); then(); }
        else { $('#pin-err', box).textContent = 'That PIN does not match.'; $('#pin-in', box).value = ''; }
      };
      $('#pin-go', box).onclick = go;
      $('#pin-in', box).onkeydown = e => { if (e.key === 'Enter') go(); };
    });
}

function route() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  const head = (parts[0] || '').toLowerCase();

  if (head === 'host') {
    if (Q.Host.resume()) return;                      /* already running     */
    hostGate(() => { Q.Host.showScreen('s-build'); Q.Build.renderAll(); });
    return;
  }
  if (head === 'dash') {
    const code = (parts[1] || '').toUpperCase();
    if (code.length === 6) { startDash(code); return; }
    askCode('Open the live dashboard', c => { location.hash = '#/dash/' + c; route(); });
    return;
  }
  if (head === 'show') {
    Q.Show.open((parts[1] || '').toLowerCase());
    return;
  }
  if (head === 'puzzles') {
    Q.Host.showScreen('s-puzzles');
    Q.PuzzleUI.renderHub();
    return;
  }
  if (head === 'puzzle') {
    Q.PuzzleUI.open((parts[1] || 'zip').toLowerCase(),
                    (parts[2] || 'medium').toLowerCase(),
                    parts[3] || 1);
    return;
  }
  if (head === 'join') {
    const code = (parts[1] || '').toUpperCase();
    if (code.length === 6) {
      /* A phone that reloads mid-game should not lose its seat: this tab
         still holds its player id, so slip straight back into the room. */
      const last = SS.get('qa:last', null);
      if (!P.ok && last && last.code === code && last.name) {
        P.code = code; P.name = last.name; P.team = last.team;
        P.avatar = Number.isInteger(last.avatar) ? last.avatar : 0;
        Q.Host.showScreen('s-play');
        P.renderKey = '';
        renderPlayer();
        startPlayer(code, last.name, last.team, P.avatar);
        return;
      }
      Q.Host.showScreen('s-join');
      P.code = code; $('#in-code').value = code; showNameStep(code);
      return;
    }
    Q.Host.showScreen('s-join');
    $('#join-step-code').classList.remove('hide');
    $('#join-step-name').classList.add('hide');
    setTimeout(() => $('#in-code').focus(), 60);
    return;
  }
  Q.Host.showScreen('s-home');
}

function askCode(title, then) {
  Q.Host.showScreen('s-home');
  modal(
    '<h2 style="font-size:22px">' + esc(title) + '</h2>' +
    '<p class="dim" style="font-size:13.5px;margin-top:7px">Enter the six-character game code.</p>' +
    '<input class="inp mono" id="ac-in" maxlength="6" placeholder="ABC123" style="margin-top:14px;font-size:26px;text-align:center;letter-spacing:.3em;text-transform:uppercase">' +
    '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn ghost" data-close>Cancel</button>' +
    '<button class="btn primary" id="ac-go">Open</button></div>',
    (box, close) => {
      const go = () => {
        const c = $('#ac-in', box).value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length !== 6) return;
        close(); then(c);
      };
      $('#ac-go', box).onclick = go;
      $('#ac-in', box).onkeydown = e => { if (e.key === 'Enter') go(); };
    });
}

function howItWorks() {
  modal(
    '<h2 style="font-size:23px">How a game runs</h2>' +
    '<ol style="margin:14px 0 0;padding-left:20px;line-height:1.75;font-size:14px;color:var(--ink-dim)">' +
      '<li><b style="color:var(--ink)">Build the questions.</b> Any time before the game &mdash; they stay saved in this browser, and you can export them as JSON.</li>' +
      '<li><b style="color:var(--ink)">Open the room.</b> You get a six-character code and a join link. Nothing starts until you press Start.</li>' +
      '<li><b style="color:var(--ink)">Players join.</b> They open the same page, tap <i>Join a game</i>, type the code and a name. That is the entire sign-up.</li>' +
      '<li><b style="color:var(--ink)">Play.</b> Each question runs on a countdown. Your screen shows answers arriving in real time; theirs locks the moment they tap.</li>' +
      '<li><b style="color:var(--ink)">See who was quickest.</b> Every reveal names the fastest correct player and the exact time they took, then the scoreboard and team race update.</li>' +
      '<li><b style="color:var(--ink)">Export.</b> Final results download as CSV or JSON.</li>' +
    '</ol>' +
    '<div class="card tight" style="margin-top:16px"><b style="font-size:13.5px">Two ways to connect</b>' +
      '<p class="dim" style="font-size:13px;margin-top:6px;line-height:1.6"><b>Any device</b> links phones and laptops peer-to-peer over the internet &mdash; this page has to be served over <span class="mono">https</span> for it, so put it on a web host or GitHub Pages. ' +
      '<b>This device only</b> syncs extra tabs and windows on the same computer, and works offline or straight from a file.</p></div>' +
    '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" data-close>Got it</button></div>');
}

/* ================================================================ BOOT ===*/
/* Icons live in markup as data-ico hooks so the HTML stays readable; they are
   painted once at boot rather than hand-written thirty times. */
function paintIcons(root) {
  (root || document).querySelectorAll('[data-mark]').forEach(el => {
    if (el.dataset.painted) return;
    el.dataset.painted = '1';
    el.insertAdjacentHTML('afterbegin', markSVG());
  });
  (root || document).querySelectorAll('[data-ico]').forEach(el => {
    if (el.dataset.painted) return;
    el.dataset.painted = '1';
    el.insertAdjacentHTML('afterbegin', ico(el.dataset.ico));
  });
  (root || document).querySelectorAll('[data-ico-after]').forEach(el => {
    if (el.dataset.painted) return;
    el.dataset.painted = '1';
    el.insertAdjacentHTML('beforeend', ico(el.dataset.icoAfter));
  });
}

/* Copy protection. `.no-copy` does the work; these close the routes styling
   leaves open — a keyboard copy of a selection made outside the locked box but
   running through it, right-click, and dragging text or the picture out.
   It is a deterrent: a screenshot or the developer tools always win. */
function selectionTouchesLocked() {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  return Array.prototype.some.call(document.querySelectorAll('.screen.on .no-copy'),
    el => { try { return r.intersectsNode(el); } catch (e) { return false; } });
}
function guardCopy() {
  const locked = e => !!(e.target && e.target.closest && e.target.closest('.no-copy'));
  ['copy', 'cut'].forEach(t => document.addEventListener(t, e => {
    if (locked(e) || selectionTouchesLocked()) e.preventDefault();
  }, true));
  ['contextmenu', 'dragstart', 'selectstart'].forEach(t => document.addEventListener(t, e => {
    if (locked(e)) e.preventDefault();
  }, true));
}

function boot() {
  paintIcons();
  guardCopy();
  Q.Build.init();
  Q.Host.init();
  Q.PuzzleUI.init();
  Q.Show.init();
  initJoin();

  $('#go-host').onclick = () => { location.hash = '#/host'; route(); };
  $('#go-join').onclick = () => { location.hash = '#/join'; route(); };
  $('#go-dash').onclick = () => { location.hash = '#/dash'; route(); };
  $('#go-puzzles').onclick = () => { location.hash = '#/puzzles'; route(); };
  $('#go-show').onclick = () => { location.hash = '#/show'; route(); };
  $('#btn-how').onclick = howItWorks;
  $('#build-home').onclick = () => { location.hash = '#/'; route(); };

  const pill = $('#home-net-pill');
  if (pill) {
    if (!/^https?:$/.test(location.protocol)) {
      pill.hidden = false;
      pill.className = 'pill warn soft';
      pill.innerHTML = ico('file') + '<span></span>';
      pill.lastChild.textContent = 'Opened as a local file — cross-device joining needs a web address';
    }
  }

  /* the favicon is the mark itself, so a pinned tab still reads as the app */
  try {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = 'data:image/svg+xml,' + encodeURIComponent(
      markSVG().replace('class="mark"', 'xmlns="http://www.w3.org/2000/svg"'));
    document.head.appendChild(link);
  } catch (e) {}

  addEventListener('hashchange', route);
  addEventListener('pagehide', () => { if (P.net) P.net.send({ t: 'bye', code: P.code, pid: P.pid }); });
  route();
}

Q.paintIcons = paintIcons;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
