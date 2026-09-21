/* ============================================================================
   Quiz Arena — puzzle engines

   Four puzzles, each a generator paired with a solver. Zip and Mini Sudoku are
   held to one answer, proved by the solver before a board is handed out; Wend
   and Patches accept any legal arrangement (see the note above each). No DOM in
   this file, so the whole thing can be driven from Node in the test suite.

   Every board is built from a seed rather than stored, which is what makes a
   race cheap: the host sends a game, a level and a number, and every device
   builds the identical grid for itself.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;

/* -------------------------------------------------------------- randomness */
function rng(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, n) => Math.min(n - 1, Math.floor(r() * n));
const pick = (r, a) => a[ri(r, a.length)];
function shuffle(r, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = ri(r, i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const seq = n => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };

/* Puzzle 12 on hard must be the same board for everyone, forever, and must not
   collide with puzzle 12 on easy — so the seed is a hash of all three. */
function seedOf(game, level, n) {
  const s = game + ':' + level + ':' + n;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ------------------------------------------------------------------- grids */
function neighbours(w, h) {
  const nb = new Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = (i / w) | 0, c = i % w, a = [];
    if (r > 0) a.push(i - w);
    if (c > 0) a.push(i - 1);
    if (c < w - 1) a.push(i + 1);
    if (r < h - 1) a.push(i + w);
    nb[i] = a;
  }
  return nb;
}
const edgeKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

/* Sizes of the free components left on the board. Used everywhere as a cheap
   "have I just stranded a pocket nothing can fill" test. */
function componentSizes(free, adj, n) {
  const seen = new Uint8Array(n), out = [];
  for (let i = 0; i < n; i++) {
    if (!free[i] || seen[i]) continue;
    const q = [i]; seen[i] = 1; let c = 0;
    for (let qi = 0; qi < q.length; qi++) {
      c++;
      const list = adj[q[qi]];
      for (let k = 0; k < list.length; k++) {
        const j = list[k];
        if (free[j] && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    out.push(c);
  }
  return out;
}

/* Can these pockets be filled exactly by the pieces still to place? */
function tileable(comps, lens) {
  if (!comps.length) return lens.length === 0;
  const cs = comps.slice().sort((a, b) => b - a);
  const ls = lens.slice().sort((a, b) => b - a);
  const used = new Array(ls.length).fill(false);
  let steps = 20000;
  function fill(ci, need) {
    if (steps-- < 0) return true;             /* give up and allow: retries cover it */
    if (need === 0) {
      ci++;
      if (ci >= cs.length) return true;
      need = cs[ci];
    }
    let last = -1;
    for (let k = 0; k < ls.length; k++) {
      if (used[k] || ls[k] > need || ls[k] === last) continue;
      last = ls[k]; used[k] = true;
      if (fill(ci, need - ls[k])) return true;
      used[k] = false;
    }
    return false;
  }
  return fill(0, cs[0]);
}

/* Carve the free cells into pieces of the given sizes. `grow` decides the shape
   of a piece — a snaking path for Wend, a blob for Patches — so the two games
   share the search and only differ in what they grow. */
function carve(r, free, adj, sizes, n, grow, tries) {
  const order = sizes.slice().sort((a, b) => b - a);
  const out = [];
  let steps = 0;
  function rec(left) {
    if (++steps > 40000) return false;
    if (!left.length) return true;
    /* Start from the most boxed-in free cell. Corners and dead ends are what
       strand a board, so committing them first fails fast instead of late. */
    let start = -1, deg = 99;
    for (let i = 0; i < n; i++) {
      if (!free[i]) continue;
      let d = 0;
      const list = adj[i];
      for (let k = 0; k < list.length; k++) if (free[list[k]]) d++;
      if (d < deg) { deg = d; start = i; }
    }
    if (start < 0) return false;
    const seen = {};
    const idxs = shuffle(r, seq(left.length));
    for (let a = 0; a < idxs.length; a++) {
      const size = left[idxs[a]];
      if (seen[size]) continue;              /* equal sizes are interchangeable */
      seen[size] = 1;
      const rest = left.slice(); rest.splice(idxs[a], 1);
      const cands = [];
      for (let t = 0; t < tries && cands.length < 10; t++) {
        const piece = grow(r, free, adj, start, size);
        if (piece) cands.push(piece);
      }
      for (let c = 0; c < cands.length; c++) {
        const piece = cands[c];
        for (let k = 0; k < piece.length; k++) free[piece[k]] = 0;
        const ok = tileable(componentSizes(free, adj, n), rest);
        if (ok) {
          out.push(piece);
          if (rec(rest)) return true;
          out.pop();
        }
        for (let k = 0; k < piece.length; k++) free[piece[k]] = 1;
        if (steps > 40000) return false;
      }
    }
    return false;
  }
  return rec(order) ? out : null;
}

/* a self-avoiding walk of exactly `size` cells — the shape a word takes */
function growPath(r, free, adj, start, size) {
  const on = {}; on[start] = 1;
  const path = [start];
  let guard = size * 40;
  while (path.length < size) {
    if (guard-- < 0) return null;
    const cur = path[path.length - 1];
    const opts = [];
    const list = adj[cur];
    for (let k = 0; k < list.length; k++) if (free[list[k]] && !on[list[k]]) opts.push(list[k]);
    if (!opts.length) {
      if (path.length === 1) return null;
      const back = path.pop(); delete on[back];
      continue;
    }
    const j = pick(r, opts);
    on[j] = 1; path.push(j);
  }
  return path;
}

/* a connected blob of exactly `size` cells — the shape a patch takes */
function growBlob(r, free, adj, start, size) {
  const on = {}; on[start] = 1;
  const cells = [start];
  let frontier = adj[start].filter(j => free[j]);
  while (cells.length < size) {
    if (!frontier.length) return null;
    const at = ri(r, frontier.length);
    const c = frontier[at];
    frontier.splice(at, 1);
    if (on[c] || !free[c]) continue;
    on[c] = 1; cells.push(c);
    const list = adj[c];
    for (let k = 0; k < list.length; k++) if (free[list[k]] && !on[list[k]]) frontier.push(list[k]);
  }
  return cells;
}

/* A random multiset of part sizes summing exactly to `total`. Never leaves a
   remainder too small to be a part in its own right. */
function partSizes(r, total, lo, hi, minParts) {
  for (let t = 0; t < 500; t++) {
    const out = [];
    let left = total;
    while (left > 0) {
      const top = Math.min(hi, left), opts = [];
      for (let v = lo; v <= top; v++) {
        const rest = left - v;
        if (rest === 0 || rest >= lo) opts.push(v);
      }
      if (!opts.length) break;
      const v = pick(r, opts);
      out.push(v); left -= v;
    }
    if (left === 0 && out.length >= (minParts || 2)) return out.sort((a, b) => a - b);
  }
  return null;
}

/* ==================================================== 1. Mini Sudoku (6x6) */
/* Digits 1-6; boxes are three wide and two tall. */
const sudBox = i => ((((i / 6) | 0) / 2) | 0) * 2 + (((i % 6) / 3) | 0);

function sudokuSolve(grid, limit, r) {
  const rows = new Int32Array(6), cols = new Int32Array(6), boxes = new Int32Array(6);
  const g = grid.slice();
  for (let i = 0; i < 36; i++) {
    const v = g[i];
    if (!v) continue;
    const b = 1 << v, ro = (i / 6) | 0, co = i % 6, bo = sudBox(i);
    if ((rows[ro] & b) || (cols[co] & b) || (boxes[bo] & b)) return { count: 0, first: null };
    rows[ro] |= b; cols[co] |= b; boxes[bo] |= b;
  }
  let count = 0, first = null;
  (function rec() {
    let at = -1, mask = 0, best = 9;
    for (let i = 0; i < 36; i++) {
      if (g[i]) continue;
      const used = rows[(i / 6) | 0] | cols[i % 6] | boxes[sudBox(i)];
      let n = 0, m = 0;
      for (let v = 1; v <= 6; v++) if (!(used & (1 << v))) { n++; m |= 1 << v; }
      if (n === 0) return;
      if (n < best) { best = n; at = i; mask = m; if (n === 1) break; }
    }
    if (at < 0) { count++; if (!first) first = g.slice(); return; }
    const vals = [];
    for (let v = 1; v <= 6; v++) if (mask & (1 << v)) vals.push(v);
    if (r) shuffle(r, vals);
    const ro = (at / 6) | 0, co = at % 6, bo = sudBox(at);
    for (let k = 0; k < vals.length; k++) {
      const b = 1 << vals[k];
      g[at] = vals[k]; rows[ro] |= b; cols[co] |= b; boxes[bo] |= b;
      rec();
      g[at] = 0; rows[ro] &= ~b; cols[co] &= ~b; boxes[bo] &= ~b;
      if (count >= limit) return;
    }
  })();
  return { count, first };
}

function sudokuGen(seed, level) {
  const r = rng(seed);
  const full = sudokuSolve(new Array(36).fill(0), 1, r).first;
  const target = level === 'easy' ? 20 : level === 'hard' ? 8 : 14;
  const g = full.slice();
  let given = 36;
  const order = shuffle(r, seq(36));
  for (let k = 0; k < order.length && given > target; k++) {
    const i = order[k], keep = g[i];
    g[i] = 0;
    if (sudokuSolve(g, 2).count === 1) given--; else g[i] = keep;
  }
  return { game: 'sudoku', w: 6, h: 6, bw: 3, bh: 2, givens: g, solution: full, given: given };
}

/* ================================================================== 2. Zip */
/* One path that starts at 1, touches every numbered stop in order, fills every
   cell and never crosses a wall. */

/* A snake already visits every cell; backbite moves shuffle it into something
   that does not look like a snake, while staying a valid full-grid path. */
function hamiltonPath(r, w, h) {
  const n = w * h, nb = neighbours(w, h);
  const path = [];
  for (let row = 0; row < h; row++) {
    for (let k = 0; k < w; k++) path.push(row * w + (row % 2 ? w - 1 - k : k));
  }
  const pos = new Int32Array(n);
  const sync = () => { for (let i = 0; i < n; i++) pos[path[i]] = i; };
  sync();
  const rounds = n * 80;
  for (let it = 0; it < rounds; it++) {
    if (ri(r, 2) === 0) { path.reverse(); sync(); }
    const tail = path[n - 1], opts = nb[tail];
    const v = opts[ri(r, opts.length)], j = pos[v];
    if (j >= n - 2) continue;
    for (let a = j + 1, b = n - 1; a < b; a++, b--) { const t = path[a]; path[a] = path[b]; path[b] = t; }
    sync();
  }
  return path;
}

function zipSolve(w, h, stops, walls, limit, budget) {
  const n = w * h, nb = neighbours(w, h);
  const adj = nb.map((list, i) => list.filter(j => !walls.has(edgeKey(i, j))));
  const stopAt = new Int32Array(n).fill(-1);
  for (let k = 0; k < stops.length; k++) stopAt[stops[k]] = k;
  const seen = new Uint8Array(n), mark = new Int32Array(n);
  let stamp = 0, count = 0, nodes = 0, over = false;

  /* Everything still unvisited has to stay reachable in one piece, or this
     branch is already dead. This one check is what makes the search finish. */
  function open(cur, left) {
    if (left === 0) return true;
    let start = -1;
    const list = adj[cur];
    for (let k = 0; k < list.length; k++) if (!seen[list[k]]) { start = list[k]; break; }
    if (start < 0) return false;
    stamp++;
    const q = [start]; mark[start] = stamp;
    let cnt = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const l2 = adj[q[qi]];
      for (let k = 0; k < l2.length; k++) {
        const c = l2[k];
        if (seen[c] || mark[c] === stamp) continue;
        mark[c] = stamp; cnt++; q.push(c);
      }
    }
    return cnt === left;
  }

  function go(cur, need, left) {
    if (++nodes > budget) { over = true; return; }
    if (left === 0) { if (need === stops.length) count++; return; }
    const list = adj[cur];
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (seen[c]) continue;
      const s = stopAt[c];
      if (s >= 0 && s !== need) continue;
      const nextNeed = s >= 0 ? need + 1 : need;
      if (nextNeed === stops.length && left > 1) continue;   /* nothing left to reach */
      seen[c] = 1;
      if (open(c, left - 1)) go(c, nextNeed, left - 1);
      seen[c] = 0;
      if (count >= limit || over) return;
    }
  }

  seen[stops[0]] = 1;
  go(stops[0], 1, n - 1);
  return { count, over };
}

function zipGen(seed, level) {
  const spec = level === 'easy' ? { w: 5, h: 5, stops: 5 }
             : level === 'hard' ? { w: 7, h: 7, stops: 8 }
             : { w: 6, h: 6, stops: 6 };
  const w = spec.w, h = spec.h, n = w * h, nb = neighbours(w, h);
  const r = rng(seed);
  for (let attempt = 0; attempt < 80; attempt++) {
    const path = hamiltonPath(r, w, h);
    const inner = shuffle(r, seq(n - 2).map(i => i + 1)).slice(0, spec.stops - 2).sort((a, b) => a - b);
    const stops = [0].concat(inner, [n - 1]).map(i => path[i]);

    const used = {};
    for (let i = 0; i + 1 < n; i++) used[edgeKey(path[i], path[i + 1])] = 1;
    const cand = [];
    for (let i = 0; i < n; i++) {
      const list = nb[i];
      for (let k = 0; k < list.length; k++) {
        const j = list[k];
        if (i < j && !used[edgeKey(i, j)]) cand.push(edgeKey(i, j));
      }
    }
    shuffle(r, cand);

    const walls = new Set();
    let at = 0;
    const add = k => { while (k-- > 0 && at < cand.length) walls.add(cand[at++]); };
    add(Math.round(cand.length * 0.22));
    for (let round = 0; round < 16; round++) {
      const res = zipSolve(w, h, stops, walls, 2, 400000);
      if (!res.over && res.count === 1) {
        return { game: 'zip', w: w, h: h, stops: stops, walls: Array.from(walls), solution: path };
      }
      if (at >= cand.length) break;
      add(Math.max(1, Math.round(cand.length * 0.07)));
    }
  }
  return null;
}

/* ================================================================= 3. Wend */
/* The letters split into words of the given lengths, each traced as a path
   through touching cells, every open cell used exactly once. */
function wordSlot(len, i) { return Q.WORDS[len].substr(i * len, len); }
function wordsOfLength(len) { return Q.WORDS[len] ? Q.WORDS[len].length / len : 0; }

function isWord(s) {
  s = String(s == null ? '' : s).toLowerCase();
  const pool = Q.WORDS[s.length];
  if (!pool || !s.length) return false;
  let at = pool.indexOf(s);
  while (at >= 0) {
    if (at % s.length === 0) return true;
    at = pool.indexOf(s, at + 1);
  }
  return false;
}

function wendGen(seed, level) {
  const spec = level === 'easy' ? { w: 4, h: 4, block: 0, lo: 3, hi: 5 }
             : level === 'hard' ? { w: 6, h: 6, block: 4, lo: 3, hi: 8 }
             : { w: 5, h: 5, block: 4, lo: 3, hi: 7 };
  const w = spec.w, h = spec.h, n = w * h, adj = neighbours(w, h);
  const r = rng(seed);

  for (let attempt = 0; attempt < 60; attempt++) {
    /* Blocked cells come in pairs, as in the samples, and must never cut the
       board in two or leave a cell with nothing to join. */
    const free = new Uint8Array(n).fill(1);
    let blocked = [];
    let ok = true;
    for (let b = 0; b < spec.block / 2; b++) {
      const spots = [];
      for (let i = 0; i < n; i++) {
        if (!free[i]) continue;
        const list = adj[i];
        for (let k = 0; k < list.length; k++) if (free[list[k]] && i < list[k]) spots.push([i, list[k]]);
      }
      if (!spots.length) { ok = false; break; }
      shuffle(r, spots);
      let placed = false;
      for (let s = 0; s < spots.length; s++) {
        free[spots[s][0]] = 0; free[spots[s][1]] = 0;
        const comps = componentSizes(free, adj, n);
        if (comps.length === 1 && comps[0] === n - blocked.length - 2) {
          blocked = blocked.concat(spots[s]); placed = true; break;
        }
        free[spots[s][0]] = 1; free[spots[s][1]] = 1;
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;

    const open = n - blocked.length;
    const lens = partSizes(r, open, spec.lo, spec.hi, 3);
    if (!lens) continue;

    const paths = carve(r, free, adj, lens, n, growPath, 26);
    if (!paths) continue;

    /* Any word of the right length fits a path, so this never fails — but the
       same word twice in one grid reads like a bug, so keep them distinct. */
    const letters = new Array(n).fill('');
    const taken = {}, answers = [];
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p], L = path.length;
      const pool = Math.min(Q.WORD_COMMON[L] || 0, wordsOfLength(L));
      if (!pool) { answers.length = 0; break; }
      let word = null;
      for (let t = 0; t < 60; t++) {
        const cand = wordSlot(L, ri(r, pool));
        if (!taken[cand]) { word = cand; break; }
      }
      if (!word) { answers.length = 0; break; }
      taken[word] = 1; answers.push(word.toUpperCase());
      for (let k = 0; k < L; k++) letters[path[k]] = word.charAt(k).toUpperCase();
    }
    if (answers.length !== paths.length) continue;

    return {
      game: 'wend', w: w, h: h,
      letters: letters,
      blocked: blocked.slice().sort((a, b) => a - b),
      lengths: paths.map(p => p.length).sort((a, b) => a - b),
      solution: paths, answers: answers
    };
  }
  return null;
}

/* Is this set of traced paths a finished board? Anything that covers every open
   cell once with real words of the right lengths counts, not just the words the
   generator happened to plant. */
function wendCheck(p, paths) {
  const n = p.w * p.h, adj = neighbours(p.w, p.h);
  const blocked = {}; p.blocked.forEach(i => { blocked[i] = 1; });
  const hit = new Uint8Array(n);
  for (let a = 0; a < paths.length; a++) {
    const path = paths[a];
    if (!path || !path.length) return false;
    for (let k = 0; k < path.length; k++) {
      const c = path[k];
      if (c < 0 || c >= n || blocked[c] || hit[c]) return false;
      if (k && adj[path[k - 1]].indexOf(c) < 0) return false;
      hit[c] = 1;
    }
    if (!isWord(wendWord(p, path))) return false;
  }
  for (let i = 0; i < n; i++) if (!blocked[i] && !hit[i]) return false;
  const got = paths.map(x => x.length).sort((a, b) => a - b).join(',');
  return got === p.lengths.slice().sort((a, b) => a - b).join(',');
}
/* A traced path spells a word forwards or backwards — people read both ways. */
function wendWord(p, path) {
  const fwd = path.map(c => p.letters[c]).join('');
  if (isWord(fwd)) return fwd;
  const back = path.slice().reverse().map(c => p.letters[c]).join('');
  return isWord(back) ? back : fwd;
}

/* ============================================================== 4. Patches */
/* Grow every numbered patch into a connected block of exactly that many cells,
   with no overlaps and no cell left over.

   Unlike Zip and Sudoku, a Patches board is NOT guaranteed to have only one
   answer, and that is deliberate rather than a gap. One number per patch is the
   thinnest clue a region puzzle can carry, and measured over thousands of
   boards it pins down a 5x5 about a fifth of the time and a 6x6 almost never —
   the classic Fillomino "equal patches may not touch" rule barely moves it. So
   this is a packing puzzle: the generator guarantees a board can be filled, and
   any arrangement that covers it legally is accepted. It stays fair, it still
   rewards seeing the shapes quickly, and generation costs nothing.  */

/* Every connected set of `size` cells containing `start`, each exactly once. */
function enumRegions(start, size, allowed, adj, emit, budget) {
  const sub = [start], inSub = {}, forb = {};
  inSub[start] = 1; forb[start] = 1;
  let stopped = false;
  function rec(ext) {
    if (stopped) return;
    if (sub.length === size) { emit(sub.slice()); return; }
    const local = [], pool = ext.slice();
    while (pool.length) {
      if (--budget.n <= 0) { stopped = true; break; }
      const u = pool.pop();
      forb[u] = 1; local.push(u);
      const next = pool.slice();
      const list = adj[u];
      for (let k = 0; k < list.length; k++) {
        const v = list[k];
        if (!allowed(v) || inSub[v] || forb[v] || next.indexOf(v) >= 0) continue;
        next.push(v);
      }
      sub.push(u); inSub[u] = 1;
      rec(next);
      sub.pop(); delete inSub[u];
      if (stopped) break;
    }
    for (let k = 0; k < local.length; k++) delete forb[local[k]];
  }
  rec(adj[start].filter(allowed));
}

function patchesSolve(w, h, seeds, limit, budget) {
  const n = w * h, adj = neighbours(w, h);
  const owner = new Int32Array(n).fill(-1);
  const seedAt = new Int32Array(n).fill(-1);
  seeds.forEach((s, i) => { seedAt[s.cell] = i; });
  const order = seeds.map((s, i) => i).sort((a, b) => seeds[a].n - seeds[b].n);
  const budgetRef = { n: budget };
  let count = 0;

  /* Every free pocket must be claimable exactly by the seeds sitting inside it.
     Cheap to check and it prunes almost everything. */
  function feasible(from) {
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (owner[i] >= 0 || seen[i]) continue;
      const q = [i]; seen[i] = 1;
      let size = 0, want = 0;
      for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi]; size++;
        const s = seedAt[c];
        if (s >= 0 && order.indexOf(s) >= from) want += seeds[s].n;
        const list = adj[c];
        for (let k = 0; k < list.length; k++) {
          const j = list[k];
          if (owner[j] < 0 && !seen[j]) { seen[j] = 1; q.push(j); }
        }
      }
      if (want !== size) return false;
    }
    return true;
  }

  function rec(k) {
    if (budgetRef.n <= 0) return;
    if (k >= order.length) { count++; return; }
    const idx = order[k], s = seeds[idx];
    const allowed = c => owner[c] < 0 && (seedAt[c] < 0 || seedAt[c] === idx);
    enumRegions(s.cell, s.n, allowed, adj, cells => {
      if (count >= limit || budgetRef.n <= 0) return;
      for (let i = 0; i < cells.length; i++) owner[cells[i]] = idx;
      if (feasible(k + 1)) rec(k + 1);
      for (let i = 0; i < cells.length; i++) owner[cells[i]] = -1;
    }, budgetRef);
  }
  rec(0);
  return { count: count, over: budgetRef.n <= 0 };
}

function patchesGen(seed, level) {
  const spec = level === 'easy' ? { w: 5, h: 5, lo: 2, hi: 5 }
             : level === 'hard' ? { w: 7, h: 7, lo: 2, hi: 8 }
             : { w: 6, h: 6, lo: 2, hi: 7 };
  const w = spec.w, h = spec.h, n = w * h, adj = neighbours(w, h);
  const r = rng(seed);

  for (let attempt = 0; attempt < 60; attempt++) {
    const sizes = partSizes(r, n, spec.lo, spec.hi, 4);
    if (!sizes || sizes.length > 10) continue;
    const free = new Uint8Array(n).fill(1);
    const regions = carve(r, free, adj, sizes, n, growBlob, 20);
    if (!regions) continue;

    const solution = new Array(n).fill(-1);
    regions.forEach((cells, i) => cells.forEach(c => { solution[c] = i; }));
    return {
      game: 'patches', w: w, h: h,
      seeds: regions.map(cells => ({ cell: pick(r, cells), n: cells.length })),
      solution: solution
    };
  }
  return null;
}

/* Patches is finished when every cell belongs to a patch, every patch is
   connected, holds exactly one number, and is exactly that big. */
function patchesCheck(p, owner) {
  const n = p.w * p.h, adj = neighbours(p.w, p.h);
  for (let i = 0; i < n; i++) if (!(owner[i] >= 0 && owner[i] < p.seeds.length)) return false;
  const size = new Array(p.seeds.length).fill(0);
  for (let i = 0; i < n; i++) size[owner[i]]++;
  for (let k = 0; k < p.seeds.length; k++) {
    const s = p.seeds[k];
    if (owner[s.cell] !== k) return false;
    if (size[k] !== s.n) return false;
    /* connected, counted from the numbered cell */
    const seen = new Uint8Array(n), q = [s.cell];
    seen[s.cell] = 1;
    let c = 0;
    for (let qi = 0; qi < q.length; qi++) {
      c++;
      const list = adj[q[qi]];
      for (let a = 0; a < list.length; a++) {
        const j = list[a];
        if (owner[j] === k && !seen[j]) { seen[j] = 1; q.push(j); }
      }
    }
    if (c !== s.n) return false;
  }
  return true;
}

/* ============================================================ public shape */
const GAMES = [
  { id: 'zip', name: 'Zip', icon: 'route', tag: 'Path',
    rule: 'Draw one line from 1 to the last number, hitting them in order, filling every square and never crossing a wall.' },
  { id: 'wend', name: 'Wend', icon: 'letters', tag: 'Words',
    rule: 'Trace the hidden words through touching letters. The tiles below show how long each one is, and every open square belongs to exactly one word.' },
  { id: 'patches', name: 'Patches', icon: 'patch', tag: 'Logic',
    rule: 'Grow each numbered patch until it covers exactly that many squares. Patches cannot overlap, and no square is left bare.' },
  { id: 'sudoku', name: 'Mini Sudoku', icon: 'grid', tag: 'Numbers',
    rule: 'Fill the grid with 1 to 6 so no digit repeats in any row, column or bold box.' }
];
const LEVELS = ['easy', 'medium', 'hard'];
const GENERATORS = { zip: zipGen, wend: wendGen, patches: patchesGen, sudoku: sudokuGen };

/* Generating is a search, and a search can come up empty. Walking the seed
   rather than failing keeps "puzzle 7" meaningful without ever handing the
   screen a null board. */
function make(game, level, number) {
  const gen = GENERATORS[game];
  if (!gen) return null;
  const lv = LEVELS.indexOf(level) >= 0 ? level : 'medium';
  for (let bump = 0; bump < 24; bump++) {
    const p = gen(seedOf(game, lv, number + bump * 7919), lv);
    if (p) {
      p.level = lv; p.number = number;
      return p;
    }
  }
  return null;
}

function check(p, state) {
  if (!p) return false;
  if (p.game === 'sudoku') {
    for (let i = 0; i < 36; i++) if (state[i] !== p.solution[i]) return false;
    return true;
  }
  if (p.game === 'zip') return zipStateSolved(p, state);
  if (p.game === 'wend') return wendCheck(p, state || []);
  if (p.game === 'patches') return patchesCheck(p, state || []);
  return false;
}

/* Zip accepts any full path that honours the stops and walls, not only the one
   the generator drew — though with a unique board they are the same line. */
function zipStateSolved(p, path) {
  if (!path || path.length !== p.w * p.h) return false;
  const adj = neighbours(p.w, p.h);
  const walls = {}; p.walls.forEach(k => { walls[k] = 1; });
  const seen = {};
  let need = 0;
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (seen[c]) return false;
    seen[c] = 1;
    if (i && (adj[path[i - 1]].indexOf(c) < 0 || walls[edgeKey(path[i - 1], c)])) return false;
    const at = p.stops.indexOf(c);
    if (at >= 0) {
      if (at !== need) return false;
      need++;
    }
  }
  return need === p.stops.length;
}

Q.Puzzles = {
  GAMES: GAMES, LEVELS: LEVELS,
  make: make, check: check,
  isWord: isWord, wendWord: wendWord,
  neighbours: neighbours, edgeKey: edgeKey,
  rng: rng, seedOf: seedOf,
  /* exposed for the test suite */
  _solve: { sudoku: sudokuSolve, zip: zipSolve, patches: patchesSolve }
};
})();
