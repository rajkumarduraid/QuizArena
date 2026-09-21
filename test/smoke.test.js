/* The main paths, end to end over the relay: hosting, joining, a question, a
   picture round, a puzzle round, copy protection and the final results. */
const { startServer, harness, browser, joinAs, solvePuzzle } = require('./lib.js');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const RUNTIME = process.env.QA_RUNTIME || 'node';
const PORT = RUNTIME === 'python' ? 8103 : 8102;
const URL = 'http://127.0.0.1:' + PORT + '/';
const { ck, done } = harness();

/* a real 1600x1200 PNG, so the shrink path has actual work to do */
function bigPng(file) {
  const W = 1600, H = 1200;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) { raw[o++] = (x * 7 + y * 3) & 255; raw[o++] = (x ^ y) & 255; raw[o++] = (y * 5) & 255; }
  }
  const table = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xFFFFFFFF;
    for (const b of td) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
    const cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const selectText = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return { found: false };
  const r = document.createRange(); r.selectNodeContents(el);
  const g = getSelection(); g.removeAllRanges(); g.addRange(r);
  return { found: true, got: String(g).trim() };
}, sel);

(async () => {
  const img = path.join(__dirname, 'big.png');
  bigPng(img);
  const server = await startServer(PORT, RUNTIME);
  const errs = [];
  const { b, ctx } = await browser(errs);

  console.log('\n— building a quiz (' + RUNTIME + ' relay) —');
  const hostCtx = await ctx();
  const host = await hostCtx.newPage();
  await host.goto(URL + '#/host');
  await host.waitForSelector('#s-build.on');
  await host.click('#btn-sample');
  await host.waitForFunction(() => document.querySelectorAll('.qcard').length === 6);
  ck(true, 'the sample quiz loads');

  /* a picture on question one */
  await host.click('.qcard:nth-child(1) .qhead');
  await host.waitForSelector('.qcard:nth-child(1) .qimg-drop');
  const [chooser] = await Promise.all([
    host.waitForEvent('filechooser'),
    host.click('.qcard:nth-child(1) [data-act=addimg]')
  ]);
  await chooser.setFiles(img);
  await host.waitForSelector('.qcard:nth-child(1) .qimg-wrap img', { timeout: 20000 });
  const stored = await host.evaluate(() =>
    JSON.parse(localStorage.getItem('qa:config:v1')).questions[0].image.length);
  ck(stored > 2000 && stored < 145 * 1024, 'a big photo is shrunk to fit one message',
     Math.round(stored / 1024) + ' KB');

  /* a puzzle round after it */
  await host.click('#btn-add-pz');
  await host.waitForSelector('.qcard.pzcard');
  /* the builder saves on a 250ms debounce, so wait for it to land */
  await host.waitForFunction(() =>
    (JSON.parse(localStorage.getItem('qa:config:v1') || '{}').questions || []).some(q => q.kind === 'pz'),
    null, { timeout: 6000 });
  await host.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('qa:config:v1'));
    const q = cfg.questions.filter(x => x.kind !== 'pz');
    const pz = cfg.questions.filter(x => x.kind === 'pz')[0];
    pz.game = 'patches'; pz.level = 'easy'; pz.time = 120; pz.points = 800;
    cfg.questions = [q[0], pz, q[1]];
    cfg.teamsEnabled = false;
    localStorage.setItem('qa:config:v1', JSON.stringify(cfg));
  });
  await host.reload();
  await host.waitForSelector('#s-build.on');
  ck((await host.evaluate(() => window.QA.Build.getConfig().questions.map(q => q.kind || 'q'))).join(',')
     === 'q,pz,q', 'the quiz is question, puzzle, question');

  await host.click('.step[data-tab=go]');
  await host.click('#btn-open-room-2');
  await host.waitForSelector('#s-lobby.on');
  const code = (await host.textContent('#room-code')).trim();
  ck(/^[A-Z0-9]{6}$/.test(code), 'a six-character room code', code);

  console.log('\n— players join —');
  const aCtx = await ctx(), bCtx = await ctx(), dCtx = await ctx();
  const alice = await joinAs(aCtx, URL, code, 'Alice', 1);
  const bob = await joinAs(bCtx, URL, code, 'Bob', 7);
  await host.waitForFunction(() => document.querySelectorAll('#lobby-players .p-chip').length === 2, null, { timeout: 15000 });
  ck(true, 'two devices join over the relay');
  ck(/How this quiz works/.test(await alice.textContent('.brief')), 'and are briefed before it starts');
  const dash = await dCtx.newPage();
  await dash.goto(URL + '#/dash/' + code);
  await dash.waitForSelector('#s-dash.on');

  console.log('\n— a picture question —');
  await host.click('#btn-start');
  await host.waitForSelector('#stage-main .qmedia', { timeout: 15000 });
  await alice.waitForSelector('.play-body .qmedia', { timeout: 20000 });
  ck(await alice.$eval('.play-body .qmedia', i => i.complete && i.naturalWidth > 0),
     'the picture reaches a player');
  const bobLate = await joinAs(await ctx(), URL, code, 'Cara', 11);
  await bobLate.waitForSelector('.play-body .qmedia', { timeout: 20000 });
  ck(true, 'and someone joining mid-question asks for it and gets it');

  const sel = await selectText(alice, '.play-body .qtext');
  ck(sel.found && sel.got === '', 'a player cannot select the question text', JSON.stringify(sel.got));
  const hsel = await selectText(host, '#stage-main .qtext');
  ck(hsel.found && hsel.got.length > 5, 'the host still can');

  const right = await host.evaluate(() => window.QA.Build.getConfig().questions[0].correct);
  await alice.click('.ans[data-pick="' + right + '"]');
  await bob.click('.ans[data-pick="' + ((right + 1) % 4) + '"]');
  await host.waitForSelector('.fastest', { timeout: 25000 });
  ck(/Alice/.test(await host.textContent('#stage-main')), 'the reveal names the fastest correct player');
  ck(/\d+\.\d\ds/.test(await host.textContent('#stage-main')), 'with the exact time');

  console.log('\n— a puzzle round —');
  await host.click('[data-c=scores]');
  await host.waitForSelector('[data-c=next]', { timeout: 12000 });
  await host.click('[data-c=next]');
  await alice.waitForSelector('#s-puzzle.on.racing', { timeout: 15000 });
  ck((await alice.evaluate(() => window.QA.PuzzleUI.state.p.game)) === 'patches', 'the board the host built');
  const same = await Promise.all([alice, bob].map(p =>
    p.evaluate(() => JSON.stringify(window.QA.PuzzleUI.state.p.seeds))));
  ck(same[0] === same[1], 'identical on every device');
  await solvePuzzle(alice);
  await alice.waitForSelector('.pz-done', { timeout: 12000 });
  /* the others are still going, so the round would run its full clock — end it
     the way a host would rather than wait two minutes */
  await host.waitForSelector('[data-c=pzend]', { timeout: 12000 });
  await host.click('[data-c=pzend]');
  await host.waitForSelector('[data-c=pznext]', { timeout: 15000 });
  ck(/\+\d/.test(await host.textContent('#stage-main')), 'solving it wins points');
  await host.click('[data-c=pznext]');

  console.log('\n— finishing —');
  await host.waitForSelector('[data-c=next]', { timeout: 12000 });
  await host.click('[data-c=next]');
  await alice.waitForSelector('.play-body .ans', { timeout: 15000 });
  await alice.click('.ans[data-pick="0"]');
  await bob.click('.ans[data-pick="1"]');
  await host.waitForSelector('[data-c=scores]', { timeout: 26000 });
  await host.click('[data-c=scores]');
  await host.waitForSelector('[data-c=finish]', { timeout: 12000 });
  await host.click('[data-c=finish]');
  await host.waitForSelector('#s-final.on', { timeout: 12000 });
  ck((await host.$$('#final-main .pod')).length >= 2, 'a podium at the end');
  ck((await host.$$('#final-main table.tbl tr')).length >= 3, 'and a full table');
  await dash.waitForFunction(() => document.querySelector('#dash-phase').textContent === 'Final results', null, { timeout: 15000 });
  ck(true, 'the projector follows all the way through');

  ck(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close(); server.kill(); fs.rmSync(img, { force: true });
  done();
})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
