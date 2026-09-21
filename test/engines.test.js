/* The puzzle engines, driven straight from Node: no DOM, no browser. Every
   board a player is handed comes out of here, so this proves it generates, has
   the answer count it claims, and that the checker agrees with the generator. */
const fs = require('fs'), path = require('path');
const SRC = require('path').join(__dirname, '..', 'src');
global.window = { QA: {} };
global.location = { protocol: 'file:', pathname: '/quiz/index.html' };
for (const f of ['22-avatars.js', '72-words.js', '70-puzzles.js'])
  new Function(fs.readFileSync(path.join(SRC, f), 'utf8')).call(global);
const Q = global.window.QA, P = Q.Puzzles;

const fails = [];
const ck = (c, l, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + l + (!c && x ? '  →  ' + x : '')); if (!c) fails.push(l); };
const N = Number(process.env.QA_N || 40);
const clone = o => JSON.parse(JSON.stringify(o));

console.log('\n— a puzzle number means the same board everywhere —');
for (const g of ['zip', 'wend', 'patches', 'sudoku']) {
  const a = JSON.stringify(P.make(g, 'medium', 3));
  const b = JSON.stringify(P.make(g, 'medium', 3));
  ck(a === b && a.length > 40, g + ': rebuilds identically');
  ck(a !== JSON.stringify(P.make(g, 'medium', 4)), g + ': a different number is a different board');
}

for (const game of ['sudoku', 'zip', 'wend', 'patches']) {
  for (const level of ['easy', 'medium', 'hard']) {
    const t0 = Date.now();
    let made = 0, worst = 0;
    const bad = [];
    for (let i = 1; i <= N; i++) {
      const s = Date.now();
      const p = P.make(game, level, i);
      worst = Math.max(worst, Date.now() - s);
      if (!p) { bad.push('#' + i + ' produced nothing'); continue; }
      made++;
      if (!P.check(p, p.solution)) bad.push('#' + i + ' the checker rejects its own answer');
      if (game === 'sudoku') {
        const r = P._solve.sudoku(p.givens, 3);
        if (r.count !== 1) bad.push('#' + i + ' has ' + r.count + ' answers');
      } else if (game === 'zip') {
        const r = P._solve.zip(p.w, p.h, p.stops, new Set(p.walls), 3, 2e6);
        if (r.over || r.count !== 1) bad.push('#' + i + ' has ' + (r.over ? 'an unbounded search' : r.count + ' answers'));
      } else if (game === 'patches') {
        const total = p.seeds.reduce((t, s2) => t + s2.n, 0);
        if (total !== p.w * p.h) bad.push('#' + i + ' numbers sum to ' + total + ', not ' + (p.w * p.h));
        if (new Set(p.seeds.map(s2 => s2.cell)).size !== p.seeds.length) bad.push('#' + i + ' two numbers on one square');
      } else {
        p.answers.forEach(a => { if (!P.isWord(a)) bad.push('#' + i + ' planted "' + a + '", not a word'); });
        const cover = new Set();
        p.solution.forEach(cells => cells.forEach(c => cover.add(c)));
        if (cover.size + p.blocked.length !== p.w * p.h) bad.push('#' + i + ' does not cover the board');
      }
    }
    const claim = (game === 'zip' || game === 'sudoku') ? 'exactly one answer each' : 'legal and self-consistent';
    ck(made === N && bad.length === 0, game + '/' + level + ': ' + N + ' boards, ' + claim, bad.slice(0, 3).join('; '));
    console.log('      ' + Math.round((Date.now() - t0) / N) + 'ms each, ' + worst + 'ms worst');
  }
}

console.log('\n— the checker rejects near misses —');
{
  const p = P.make('sudoku', 'medium', 1), s = p.solution.slice();
  s[0] = s[0] === 1 ? 2 : 1;
  ck(!P.check(p, s), 'sudoku: one wrong digit fails');
  ck(!P.check(p, p.givens), 'sudoku: an unfinished grid fails');
}
{
  const p = P.make('zip', 'medium', 1);
  ck(!P.check(p, p.solution.slice(0, -1)), 'zip: a line short of the last square fails');
  ck(!P.check(p, p.solution.slice().reverse()), 'zip: running the numbers backwards fails');
}
{
  const p = P.make('patches', 'medium', 1), o = p.solution.slice();
  o[0] = o.find(x => x !== o[0]);
  ck(!P.check(p, o), 'patches: one square in the wrong patch fails');
  const bare = p.solution.slice(); bare[0] = -1;
  ck(!P.check(p, bare), 'patches: leaving a square bare fails');
}
{
  const p = P.make('wend', 'medium', 1);
  ck(!P.check(p, p.solution.slice(0, -1)), 'wend: leaving a word untraced fails');
  const m = clone(p.solution);
  const t = m[0][0]; m[0][0] = m[0][1]; m[0][1] = t;
  ck(!P.check(p, m), 'wend: scrambling a traced word fails');
  const back = clone(p.solution); back[0].reverse();
  ck(P.check(p, back), 'wend: tracing a word backwards is accepted');
}

console.log('\n— dictionary —');
ck(['theory', 'cascade', 'jet', 'puzzle', 'arena', 'ledger', 'invoice'].every(w => P.isWord(w)),
   'ordinary words are accepted');
ck(!P.isWord('zzzz') && !P.isWord('qwrtp'), 'nonsense is rejected');
ck(!P.isWord('hetheo'), 'a run spanning two packed entries is rejected');
{
  let total = 0;
  for (const L of [3, 4, 5, 6, 7, 8]) {
    total += Q.WORDS[L].length / L;
    if (Q.WORDS[L].length % L !== 0) ck(false, 'bucket ' + L + ' is not a whole number of words');
  }
  ck(total > 12000, 'wide enough to accept an unplanned answer', total + ' words');
}

console.log('\n— avatars survive a bad index —');
{
  let threw = null;
  [undefined, null, NaN, -3, 1e9, '4', 2.7].forEach(v => {
    try { if (!/^<(svg|img)/.test(Q.avatarSVG(v, 'av-sm'))) threw = 'no markup for ' + String(v); }
    catch (e) { threw = String(v) + ' → ' + e.message; }
  });
  ck(!threw, 'a missing or silly index still draws someone', threw);
}

console.log('\n' + (fails.length ? '✗ ' + fails.length + ' FAILED:\n   - ' + fails.join('\n   - ') : '✓ all checks passed'));
process.exit(fails.length ? 1 : 0);
