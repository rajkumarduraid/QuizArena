/* ============================================================================
   Quiz Arena — shared result views
   Everything here renders from a public snapshot, so the host stage, the
   projector dashboard and a player's device all draw from identical code.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { esc, secs, nf, clamp, shape, ico, avatarSVG, ACOLORS } = Q;

function teamOf(snap, id) {
  return (snap.teams || []).find(t => t.id === id) || null;
}
function teamChip(snap, id, extra) {
  const t = teamOf(snap, id);
  if (!t) return '';
  return '<span class="team-chip" style="color:' + esc(t.color) + ';border-color:' + esc(t.color) + '55;background:' + esc(t.color) + '1f">' +
    '<span class="swatch" style="background:' + esc(t.color) + '"></span>' + esc(t.name) + (extra || '') + '</span>';
}

/* --------------------------------------------------- countdown ring */
function ringHTML(id) {
  return '<div class="ring" id="' + id + '">' +
    '<svg width="74" height="74" viewBox="0 0 74 74" aria-hidden="true">' +
      '<circle class="bgc" cx="37" cy="37" r="32" fill="none" stroke-width="7"></circle>' +
      '<circle class="fgc" cx="37" cy="37" r="32" fill="none" stroke-width="7" stroke-linecap="round" ' +
        'stroke-dasharray="201.06" stroke-dashoffset="0"></circle>' +
    '</svg><div class="num">0</div></div>';
}
function setRing(el, frac, secsLeft) {
  if (!el) return;
  const c = 201.06;
  const fg = el.querySelector('.fgc');
  if (fg) fg.style.strokeDashoffset = String(c * (1 - clamp(frac, 0, 1)));
  const n = el.querySelector('.num');
  if (n) n.textContent = String(Math.max(0, Math.ceil(secsLeft)));
  el.classList.toggle('low', secsLeft <= 10 && secsLeft > 5);
  el.classList.toggle('crit', secsLeft <= 5);
}

/* --------------------------------------------------- answer tiles */
function answersHTML(snap, opts) {
  opts = opts || {};
  const q = snap.q;
  if (!q) return '';
  const rev = opts.reveal ? snap.reveal : null;
  const total = rev ? Math.max(1, rev.dist.reduce((a, b) => a + b, 0)) : 1;
  const one = q.options.length <= 2 && q.options.join('').length > 40;
  return '<div class="answers' + (one ? ' one-col' : '') + (opts.deal ? ' deal' : '') + '">' + q.options.map((o, i) => {
    const right = rev && rev.correct === i;
    const picked = opts.myChoice === i;
    let cls = 'ans';
    if (rev) cls += right ? ' right' : ' dimmed';
    if (picked) cls += rev ? (right ? '' : ' wrongpick') : ' picked';
    const pct = rev ? Math.round((rev.dist[i] || 0) / total * 100) : 0;
    return '<button class="' + cls + '" style="background:' + ACOLORS[i] + '" ' +
      (opts.clickable ? 'data-pick="' + i + '"' : 'disabled') + '>' +
      '<span class="shape">' + shape(i) + '</span>' +
      '<span class="txt">' + esc(o) + '</span>' +
      (rev ? '<span class="tick">' + (right ? ico('check') : (picked ? ico('cross') : '')) + '</span>' +
             '<span class="barfill" style="width:' + pct + '%"></span>'
           : (picked ? '<span class="tick">' + ico('check-circle') + '</span>' : '')) +
      '</button>';
  }).join('') + '</div>';
}

/* --------------------------------------------------- distribution */
function distHTML(snap) {
  const r = snap.reveal, q = snap.q;
  if (!r || !q) return '';
  const max = Math.max(1, Math.max.apply(null, r.dist));
  const total = Math.max(1, r.dist.reduce((a, b) => a + b, 0));
  return '<div class="dist">' + q.options.map((o, i) => {
    const n = r.dist[i] || 0;
    const right = r.correct === i;
    return '<div class="dist-row">' +
      '<span class="sh" style="background:' + ACOLORS[i] + '">' + shape(i) + '</span>' +
      '<div class="tr"><div class="fl" style="width:' + Math.round(n / max * 100) + '%;background:' +
        (right ? 'linear-gradient(90deg,var(--ok),#3FCB96)' : 'var(--line-2)') + '"></div>' +
        '<div class="cap">' + (right ? ico('check') : '') + '<span>' + esc(o) + '</span></div></div>' +
      '<span class="n">' + n + ' · ' + Math.round(n / total * 100) + '%</span>' +
    '</div>';
  }).join('') + '</div>';
}

/* --------------------------------------------------- fastest banner */
function fastestHTML(snap) {
  const r = snap.reveal;
  if (!r) return '';
  if (!r.fastest) {
    return '<div class="fastest" style="background:var(--surface);border-color:var(--line)">' +
      '<span class="bolt" style="animation:none;background:var(--sunken);color:var(--faint);box-shadow:none">' +
      ico('empty') + '</span>' +
      '<div><div class="who">Nobody got this one</div>' +
      '<p class="dim" style="font-size:13.5px;margin-top:4px">No correct answers, so no fastest responder this round.</p></div></div>';
  }
  const f = r.fastest;
  return '<div class="fastest">' +
    '<span class="bolt">' + ico('stopwatch') + '</span>' +
    avatarSVG(f.avatar, 'av-md') +
    '<div style="min-width:0">' +
      '<p class="lab">Fastest correct answer</p>' +
      '<div class="who">' + esc(f.name) + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        teamChip(snap, f.team) +
        '<span class="pill ok">+' + nf(f.gain) + ' pts</span>' +
      '</div>' +
    '</div>' +
    '<div class="secs">' + secs(f.ms) + '<small>TO ANSWER</small></div>' +
  '</div>';
}

/* --------------------------------------------------- speed podium */
function speedListHTML(snap, meId) {
  const r = snap.reveal;
  if (!r || !r.top || !r.top.length) return '';
  return '<div class="speed-list">' + r.top.map((p, i) =>
    '<div class="speed-row' + (p.id === meId ? ' me' : '') + '">' +
      '<span class="rank-badge' + (i < 3 ? ' g' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
      avatarSVG(p.avatar, 'av-sm') +
      '<span class="nm">' + esc(p.name) + '</span>' +
      (snap.teamsEnabled ? teamChip(snap, p.team) : '') +
      '<span class="tm">' + secs(p.ms) + '</span>' +
    '</div>').join('') + '</div>';
}

/* --------------------------------------------------- leaderboard */
function leaderboardHTML(snap, meId, limit) {
  const ps = (snap.players || []).slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!ps.length) return '<p class="empty-state">No players yet.</p>';
  const shown = limit ? ps.slice(0, limit) : ps;
  return '<div class="lb">' + shown.map((p, i) => {
    const cls = 'lb-row' + (i === 0 ? ' top1' : i === 1 ? ' top2' : i === 2 ? ' top3' : '') + (p.id === meId ? ' me' : '');
    /* data-lb lets the caller FLIP rows into their new positions */
    const gain = p.lastGain;
    return '<div class="' + cls + '" data-lb="' + p.id + '">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="lb-name">' + avatarSVG(p.avatar, 'av-sm') + '<span>' + esc(p.name) + '</span>' +
        (snap.teamsEnabled ? teamChip(snap, p.team) : '') +
        (p.connected ? '' : '<span class="pill" title="Not connected right now">' + ico('signal-off') + '</span>') +
        (p.streak >= 2 ? '<span class="pill warn">' + ico('flame') + p.streak + '</span>' : '') +
      '</span>' +
      '<span style="text-align:right">' +
        '<span class="lb-score" data-score="' + p.id + '" data-v="' + p.score + '">' + nf(p.score) + '</span>' +
        (gain != null && gain !== 0
          ? '<div class="lb-delta" style="color:' + (gain > 0 ? 'var(--ok)' : 'var(--bad)') + '">' + (gain > 0 ? '+' : '') + nf(gain) + '</div>'
          : (p.lastMs != null ? '<div class="lb-sub">' + secs(p.lastMs) + '</div>' : '')) +
      '</span>' +
    '</div>';
  }).join('') + '</div>' +
  (limit && ps.length > limit ? '<p class="faint center" style="font-size:12.5px;margin-top:9px">+ ' + (ps.length - limit) + ' more</p>' : '');
}

/* --------------------------------------------------- team race */
function teamBarsHTML(snap) {
  if (!snap.teamsEnabled || !snap.teamStats || !snap.teamStats.length) return '';
  const metric = snap.teamMetric === 'avg' ? 'avg' : 'total';
  const rows = snap.teamStats.slice().sort((a, b) => b[metric] - a[metric]);
  const max = Math.max(1, rows[0][metric]);
  return '<div class="col" style="gap:14px">' + rows.map((t, i) =>
    '<div class="team-bar" style="color:' + esc(t.color) + '">' +
      '<div class="lbl"><span style="color:var(--ink);display:inline-flex;align-items:center;gap:5px">' +
        (i === 0 && t[metric] > 0 ? ico('crown', 'sm') : '') + esc(t.name) +
        ' <span class="faint" style="font-weight:500">· ' + t.members + ' player' + (t.members === 1 ? '' : 's') + '</span></span>' +
        '<span style="color:var(--ink)" class="mono">' + nf(t[metric]) +
          '<span class="faint" style="font-size:11.5px;font-weight:500"> ' + (metric === 'avg' ? 'avg' : 'pts') +
          ' · ' + nf(metric === 'avg' ? t.total : t.avg) + ' ' + (metric === 'avg' ? 'total' : 'avg') + '</span></span>' +
      '</div>' +
      '<div class="track"><div class="fill" style="width:' + Math.round(t[metric] / max * 100) + '%;background:' + esc(t.color) + '"></div></div>' +
    '</div>').join('') + '</div>';
}

/* --------------------------------------------------- stat tiles */
function tilesHTML(snap) {
  const s = snap.stats || {};
  const connected = (snap.players || []).filter(p => p.connected).length;
  return '<div class="stat-tiles">' +
    '<div class="tile"><div class="k">Players</div><div class="v">' + connected + '</div>' +
      '<div class="s">' + (snap.players || []).length + ' joined in total</div></div>' +
    '<div class="tile"><div class="k">Question</div><div class="v">' + (snap.qi + 1) + ' / ' + snap.total + '</div>' +
      '<div class="s">' + esc(snap.title || 'Quiz') + '</div></div>' +
    '<div class="tile"><div class="k">Room accuracy</div><div class="v">' + (s.accuracy == null ? '—' : s.accuracy + '%') + '</div>' +
      '<div class="s">correct answers so far</div></div>' +
    '<div class="tile"><div class="k">Average speed</div><div class="v">' + (s.avgMs == null ? '—' : secs(s.avgMs)) + '</div>' +
      '<div class="s">across every answer</div></div>' +
    '<div class="tile"><div class="k">Quickest of the game</div><div class="v" style="color:var(--gold)">' + (s.best ? secs(s.best.ms) : '—') + '</div>' +
      '<div class="s">' + (s.best ? esc(s.best.name) + ' · Q' + s.best.qn : 'no correct answers yet') + '</div></div>' +
  '</div>';
}

/* --------------------------------------------------- live answer ticker */
function tickerHTML(snap) {
  const ev = (snap.events || []).slice().reverse();
  if (!ev.length) return '<p class="empty-state">Answers appear here the moment they land.</p>';
  return '<div class="ticker">' + ev.map(e =>
    '<div class="tick-item ' + (e.right === true ? 'good' : e.right === false ? 'bad-a' : '') + '">' +
      (e.right === true ? ico('check-circle') : e.right === false ? ico('cross-circle') : ico('stopwatch')) +
      avatarSVG(e.avatar, 'av-xs') +
      '<b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.name) + '</b>' +
      (snap.teamsEnabled ? teamChip(snap, e.team) : '') +
      '<span class="faint" style="font-size:12px">Q' + e.qn + '</span>' +
      '<span class="t">' + secs(e.ms) + '</span>' +
    '</div>').join('') + '</div>';
}


/* --------------------------------------------------- pre-game briefing */
function briefHTML(snap, opts) {
  const b = snap.brief;
  if (!b) return '';
  opts = opts || {};
  const mins = Math.max(1, Math.round(b.seconds / 60));
  const w = b.speedW;
  const pts = b.pointsMin === b.pointsMax ? nf(b.pointsMax) : nf(b.pointsMin) + '–' + nf(b.pointsMax);
  const tms = b.timeMin === b.timeMax ? b.timeMin + 's' : b.timeMin + '–' + b.timeMax + 's';
  const atBuzzer = Math.round(b.pointsMax * (1 - w));

  const rule = (icon, text) =>
    '<li>' + ico(icon) + '<span>' + text + '</span></li>';
  const rules = [
    w > 0
      ? rule('stopwatch', 'Answer <b>fast</b>. Instantly is worth the full ' + nf(b.pointsMax) +
             ', right on the buzzer only ' + nf(atBuzzer) + '.')
      : rule('check-circle', 'Every correct answer is worth the same &mdash; speed decides the spotlight, not the score.'),
    b.fastBonus ? rule('bolt', 'The single <b>fastest correct</b> player each round takes a bonus <b>+' + nf(b.fastBonus) + '</b>.') : '',
    b.streakBonus ? rule('flame', 'A <b>streak</b> of correct answers adds <b>+' + nf(b.streakBonus) + '</b> each, up to five in a row.') : '',
    b.wrongPenalty ? rule('cross-circle', 'A wrong answer costs <b>&minus;' + nf(b.wrongPenalty) + '</b>. Your score never drops below zero.') : '',
    snap.teamsEnabled
      ? rule('users', 'Teams are ranked by <b>' + (snap.teamMetric === 'avg' ? 'average points per player' : 'total points') + '</b>.')
      : '',
    b.puzzles ? rule('puzzle', 'There ' + (b.puzzles === 1 ? 'is <b>1 puzzle round</b>' : 'are <b>' + b.puzzles +
      ' puzzle rounds</b>') + ' in here. Your screen switches to a board and the room races to solve it.') : '',
    b.noCopy ? rule('lock', 'Question text is <b>locked</b> on your device &mdash; it cannot be selected or copied.') : '',
    rule('eye', 'Miss a question and you simply score nothing for it &mdash; no penalty for running out of time.')
  ].filter(Boolean).join('');

  return '<div class="brief">' +
    '<div class="brief-head">' + ico('file') +
      '<div><b>How this quiz works</b>' +
      '<p>' + esc(snap.title) + '</p></div></div>' +
    '<div class="brief-stats">' +
      '<div><span class="k">Questions</span><span class="v">' + b.questions + '</span></div>' +
      '<div><span class="k">Time each</span><span class="v">' + tms + '</span></div>' +
      '<div><span class="k">Points each</span><span class="v">' + pts + '</span></div>' +
      '<div><span class="k">Up for grabs</span><span class="v">' + nf(b.pointsTotal) + '</span></div>' +
    '</div>' +
    '<p class="brief-note">About ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' of answering time' +
      (b.shuffle ? ', in a random order' : '') + '.</p>' +
    '<ul class="brief-rules">' + rules + '</ul>' +
    (opts.footer || '') +
  '</div>';
}

/* ------------------------------------------------- the puzzle race */
/* Who has cracked it, in order, and who is still at it. Drawn from the same
   snapshot on the host screen, the projector and a player's own board. */
function pzBoardHTML(snap, meId) {
  const pz = snap.pz;
  if (!pz) return '';
  const done = pz.board || [];
  const doneOf = {};
  done.forEach(r => { doneOf[r.pid] = 1; });
  const still = (snap.players || []).filter(p => p.connected && !doneOf[p.id]);

  const row = (i, p, ms) =>
    '<div class="lb-row' + (i === 0 ? ' top1' : i === 1 ? ' top2' : i === 2 ? ' top3' : '') +
      (p.id === meId || p.pid === meId ? ' me' : '') + '">' +
      '<span class="rk">' + (ms == null ? '·' : i + 1) + '</span>' +
      '<span class="lb-name">' + avatarSVG(p.avatar, 'av-sm') + '<span>' + esc(p.name) + '</span>' +
        (snap.teamsEnabled ? teamChip(snap, p.team) : '') + '</span>' +
      '<span style="text-align:right">' +
        (ms == null
          ? '<span class="lb-sub waitdots">' + (pz.scored ? 'did not finish' : 'still going') + '</span>'
          : '<span class="lb-score">' + secs(ms) + '</span>' +
            (p.gain != null ? '<div class="lb-delta" style="color:var(--ok)">+' + nf(p.gain) + '</div>' : '')) +
      '</span></div>';

  return '<div class="lb">' +
    done.map((r, i) => row(i, r, r.ms)).join('') +
    still.map(p => row(-1, p, null)).join('') +
    '</div>' +
    (!done.length && !still.length ? '<p class="empty-state">Nobody in the room yet.</p>' : '');
}

/* --------------------------------------------------- podium + table */
function podiumHTML(snap) {
  const ps = (snap.players || []).slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  if (!ps.length) return '';
  const seat = (p, n) => !p ? '' :
    '<div class="pod p' + n + '"><span class="cr">' + n + '</span>' +
      avatarSVG(p.avatar, 'av-lg') +
      '<span class="nm">' + esc(p.name) + '</span>' +
      (snap.teamsEnabled ? teamChip(snap, p.team) : '') +
      '<span class="sc">' + nf(p.score) + '</span>' +
      '<span class="faint" style="font-size:12px">' + p.correct + ' correct' +
        (p.bestMs != null ? ' · best ' + secs(p.bestMs) : '') + '</span></div>';
  return '<div class="podium">' + seat(ps[1], 2) + seat(ps[0], 1) + seat(ps[2], 3) + '</div>';
}

function finalTableHTML(snap) {
  const ps = (snap.players || []).slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
    '<th>#</th><th>Player</th>' + (snap.teamsEnabled ? '<th>Team</th>' : '') +
    '<th>Score</th><th>Correct</th><th>Accuracy</th><th>Avg time</th><th>Fastest</th><th>Speed wins</th>' +
    '</tr></thead><tbody>' +
    ps.map((p, i) =>
      '<tr><td class="num">' + (i + 1) + '</td>' +
      '<td><span style="display:inline-flex;align-items:center;gap:7px">' +
        avatarSVG(p.avatar, 'av-sm') + '<b>' + esc(p.name) + '</b></span></td>' +
      (snap.teamsEnabled ? '<td>' + (teamChip(snap, p.team) || '<span class="faint">—</span>') + '</td>' : '') +
      '<td class="num"><b>' + nf(p.score) + '</b></td>' +
      '<td class="num">' + p.correct + ' / ' + (p.answered || 0) + '</td>' +
      '<td class="num">' + (p.answered ? Math.round(p.correct / p.answered * 100) + '%' : '—') + '</td>' +
      '<td class="num">' + (p.avgMs != null ? secs(p.avgMs) : '—') + '</td>' +
      '<td class="num" style="color:var(--gold);font-weight:700">' + (p.bestMs != null ? secs(p.bestMs) : '—') + '</td>' +
      '<td class="num">' + (p.fastWins || 0) + '</td></tr>').join('') +
    '</tbody></table></div>';
}

window.QA.Views = {
  teamOf, teamChip, ringHTML, setRing, answersHTML, distHTML, fastestHTML, briefHTML, pzBoardHTML,
  speedListHTML, leaderboardHTML, teamBarsHTML, tilesHTML, tickerHTML,
  podiumHTML, finalTableHTML
};
})();
