/* Shared plumbing for the browser suites. */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const DIR = path.join(__dirname, '..');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function startServer(port, runtime) {
  return new Promise((res, rej) => {
    const cmd = runtime === 'python' ? 'python3' : 'node';
    const file = runtime === 'python' ? 'server.py' : 'server.js';
    const p = spawn(cmd, [path.join(DIR, file), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; if (/Quiz Arena is running/.test(out)) res(p); });
    p.on('exit', c => rej(new Error('server exited ' + c)));
    setTimeout(() => rej(new Error('server did not start')), 9000);
  });
}

function harness() {
  const fails = [];
  const ck = (c, l, x) => {
    console.log((c ? '  ✓ ' : '  ✗ ') + l + (!c && x ? '  →  ' + x : ''));
    if (!c) fails.push(l);
  };
  const done = () => {
    console.log('\n' + (fails.length
      ? '✗ ' + fails.length + ' FAILED:\n   - ' + fails.join('\n   - ')
      : '✓ all checks passed'));
    process.exit(fails.length ? 1 : 0);
  };
  return { ck, fails, done };
}

async function browser(errs) {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = async (w, h) => {
    const c = await b.newContext({ viewport: { width: w || 1280, height: h || 1000 } });
    c.on('page', p => {
      p.on('pageerror', e => errs.push(e.message));
      p.on('dialog', d => d.accept());
    });
    return c;
  };
  return { b, ctx };
}

const joinAs = async (ctx, url, code, name, av) => {
  const p = await ctx.newPage();
  await p.goto(url + '#/join/' + code);
  await p.waitForSelector('#join-step-name:not(.hide)');
  await p.fill('#in-name', name);
  await p.waitForFunction(() => document.querySelectorAll('#avatar-grid [data-av]').length > 0, null, { timeout: 8000 });
  await p.click('#avatar-grid [data-av="' + av + '"]');
  await p.click('#btn-join');
  await p.waitForSelector('#s-play.on', { timeout: 20000 });
  return p;
};

/* drag a puzzle to its solution with real pointer events */
const solvePuzzle = async page => {
  const drags = await page.evaluate(() => {
    const S = window.QA.PuzzleUI.state, p = S.p;
    const r = document.querySelector('#pz-board').getBoundingClientRect();
    const at = c => ({ x: r.left + ((c % p.w) + 0.5) * r.width / p.w,
                       y: r.top + (((c / p.w) | 0) + 0.5) * r.height / p.h });
    if (p.game === 'zip') return [p.solution.map(at)];
    if (p.game === 'wend') return p.solution.map(q => q.map(at));
    const adj = window.QA.Puzzles.neighbours(p.w, p.h);
    return p.seeds.map((s, k) => {
      const mine = [];
      for (let i = 0; i < p.solution.length; i++) if (p.solution[i] === k) mine.push(i);
      const order = [s.cell], seen = {}; seen[s.cell] = 1;
      for (let qi = 0; qi < order.length; qi++)
        for (const j of adj[order[qi]]) if (mine.indexOf(j) >= 0 && !seen[j]) { seen[j] = 1; order.push(j); }
      return order.map(at);
    });
  });
  for (const d of drags) {
    await page.mouse.move(d[0].x, d[0].y);
    await page.mouse.down();
    for (let i = 1; i < d.length; i++) await page.mouse.move(d[i].x, d[i].y);
    await page.mouse.up();
  }
};

module.exports = { startServer, harness, browser, joinAs, solvePuzzle, DIR, EXE };
