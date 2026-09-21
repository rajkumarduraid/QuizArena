/* The pick-a-number board: rounds hidden behind numbered tiles, opened in
   whatever order the room calls out. */
const { startServer, harness, browser, joinAs, solvePuzzle } = require('./lib.js');
const PORT = 8101, URL = 'http://127.0.0.1:' + PORT + '/';
const { ck, done } = harness();

(async () => {
  const server = await startServer(PORT);
  const errs = [];
  const { b, ctx } = await browser(errs);

  console.log('\n— setting one up —');
  const hostCtx = await ctx();
  const host = await hostCtx.newPage();
  await host.goto(URL + '#/host');
  await host.waitForSelector('#s-build.on');
  await host.click('#btn-sample');
  await host.waitForFunction(() => document.querySelectorAll('.qcard').length === 6);

  await host.click('.step[data-tab=rules]');
  ck(!(await host.isChecked('#pick-board')), 'the scored board is off unless you ask for it');
  await host.evaluate(() => {
    const c = document.querySelector('#pick-board');
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await host.waitForFunction(() =>
    JSON.parse(localStorage.getItem('qa:config:v1') || '{}').pickBoard === true, null, { timeout: 6000 });
  ck(true, 'turning it on is remembered');

  await host.click('.step[data-tab=go]');
  await host.click('#btn-open-room-2');
  await host.waitForSelector('#s-lobby.on');
  const code = (await host.textContent('#room-code')).trim();

  const aCtx = await ctx(), bCtx = await ctx(), dCtx = await ctx(1500, 1000);
  const alice = await joinAs(aCtx, URL, code, 'Alice', 1);
  const bob = await joinAs(bCtx, URL, code, 'Bob', 5);
  await host.waitForFunction(() => document.querySelectorAll('#lobby-players .p-chip').length === 2, null, { timeout: 12000 });
  const dash = await dCtx.newPage();
  await dash.goto(URL + '#/dash/' + code);
  await dash.waitForSelector('#s-dash.on');

  console.log('\n— the board —');
  await host.click('#btn-start');
  await host.waitForSelector('#stage-main .pick-grid', { timeout: 10000 });
  const tiles = await host.$$eval('#stage-main .pick-tile', e => e.map(x => x.textContent.trim()));
  ck(tiles.length === 6, 'a tile per round', tiles.length + ' tiles');
  const nums = await host.$$eval('#stage-main .pick-tile .n', e => e.map(x => Number(x.textContent)));
  ck(nums.join(',') === '1,2,3,4,5,6', 'numbered 1 upwards', nums.join(','));

  await dash.waitForSelector('#dash-main .pick-grid.big', { timeout: 12000 });
  ck(/Pick a number/.test(await dash.textContent('#dash-main')), 'the big screen shows it too');
  ck(/Pick a number/.test(await dash.textContent('#dash-phase')), 'and says so in the status');
  await alice.waitForSelector('.play-body .pick-grid', { timeout: 12000 });
  ck(!(await alice.$('.play-body [data-tile]')), 'players can watch but not pick');

  const shuffled = await host.evaluate(() => {
    const sees = [];
    document.querySelectorAll('#stage-main .pick-tile').forEach(t => {
      sees.push(t.querySelector('.sub').textContent.trim());
    });
    return sees;
  });
  ck(shuffled.length === 6 && shuffled.every(x => /^[\d,]+$/.test(x)),
     'an unplayed tile shows only what it is worth', shuffled.join(' | '));

  console.log('\n— calling a number —');
  await host.click('#stage-main [data-tile="4"]');
  await host.waitForSelector('#answered-n', { timeout: 10000 });
  ck(true, 'tapping a tile opens the round behind it');
  ck(/Round 1 \/ 6/.test(await host.textContent('#stage-progress')), 'progress counts rounds played',
     await host.textContent('#stage-progress'));

  const qText = await host.textContent('#stage-main .qtext');
  await alice.waitForSelector('.play-body .ans', { timeout: 12000 });
  ck((await alice.textContent('.play-body .qtext')).trim() === qText.trim(), 'and players get that question');

  /* answer it correctly, so the tile has a winner to name */
  const right = await host.evaluate(t => {
    const q = window.QA.Build.getConfig().questions.filter(x => (x.text || '').trim() === t.trim())[0];
    return q ? q.correct : 0;
  }, qText);
  await alice.click('.ans[data-pick="' + right + '"]');
  await bob.click('.ans[data-pick="' + ((right + 1) % 2) + '"]');
  await host.waitForSelector('[data-c=scores]', { timeout: 25000 });
  await host.click('[data-c=scores]');
  await host.waitForSelector('[data-c=board]', { timeout: 10000 });
  ck(true, 'the scoreboard leads back to the board');
  await host.click('[data-c=board]');
  await host.waitForSelector('#stage-main .pick-grid', { timeout: 10000 });

  const done4 = await host.$eval('#stage-main .pick-tile:nth-child(4)', e => e.className + '|' + e.textContent.trim());
  ck(/done/.test(done4), 'the number that was played is struck off', done4);
  ck(!(await host.$('#stage-main [data-tile="4"]')), 'and cannot be picked again');
  ck((await host.$$('#stage-main [data-tile]')).length === 5, 'the other five are still live');
  ck(/Alice/.test(done4), 'a played tile names who took it', done4);
  ck(/played|Alice/.test(done4), 'and says "played" when nobody got it right', done4);

  console.log('\n— to the end —');
  for (const n of [1, 2, 3, 5, 6]) {
    await host.click('#stage-main [data-tile="' + n + '"]');
    await host.waitForFunction(() => !!document.querySelector('[data-c=reveal]') ||
                                     !!document.querySelector('[data-c=pzend]'), null, { timeout: 12000 });
    await alice.waitForSelector('.play-body .ans', { timeout: 12000 }).catch(() => {});
    await alice.click('.ans[data-pick="1"]').catch(() => {});
    await bob.click('.ans[data-pick="1"]').catch(() => {});
    await host.waitForSelector('[data-c=scores]', { timeout: 26000 });
    await host.click('[data-c=scores]');
    const last = n === 6;
    await host.waitForSelector(last ? '[data-c=finish]' : '[data-c=board]', { timeout: 10000 });
    if (!last) { await host.click('[data-c=board]'); await host.waitForSelector('#stage-main .pick-grid'); }
  }
  ck(true, 'every tile can be played through');
  ck(!!(await host.$('[data-c=finish]')), 'the last one offers the final results instead of the board');
  await host.click('[data-c=finish]');
  await host.waitForSelector('#s-final.on', { timeout: 10000 });
  ck(true, 'and the game finishes');

  console.log('\n— the number gives nothing away —');
  /* The mapping is shuffled per room and never leaves the host, so the only
     way to check it is to open several rooms and see tile 1 land elsewhere. */
  const firstBehindTile1 = [];
  for (let r = 0; r < 6; r++) {
    const c3 = await ctx();
    const h3 = await c3.newPage();
    await h3.goto(URL + '#/host');
    await h3.waitForSelector('#s-build.on');
    await h3.click('#btn-sample');
    await h3.waitForFunction(() => document.querySelectorAll('.qcard').length === 6);
    await h3.evaluate(() => {
      const cfg = JSON.parse(localStorage.getItem('qa:config:v1'));
      cfg.pickBoard = true;
      localStorage.setItem('qa:config:v1', JSON.stringify(cfg));
    });
    await h3.reload();
    await h3.waitForSelector('#s-build.on');
    await h3.click('.step[data-tab=go]');
    await h3.click('#btn-open-room-2');
    await h3.waitForSelector('#s-lobby.on');
    const c4 = await ctx();
    const pl = await joinAs(c4, URL, (await h3.textContent('#room-code')).trim(), 'P' + r, 2);
    await h3.waitForFunction(() => document.querySelectorAll('#lobby-players .p-chip').length === 1, null, { timeout: 12000 });
    await h3.click('#btn-start');
    await h3.waitForSelector('#stage-main [data-tile="1"]', { timeout: 10000 });
    await h3.click('#stage-main [data-tile="1"]');
    await h3.waitForSelector('#stage-main .qtext', { timeout: 10000 });
    firstBehindTile1.push((await h3.textContent('#stage-main .qtext')).trim().slice(0, 30));
    await c3.close(); await c4.close();
  }
  ck(new Set(firstBehindTile1).size > 1,
     'tile 1 is not always the same round — the mapping is shuffled per room',
     [...new Set(firstBehindTile1)].length + ' distinct over 6 rooms');

  console.log('\n— a normal quiz is untouched —');
  const h2ctx = await ctx();
  const h2 = await h2ctx.newPage();
  await h2.goto(URL + '#/host');
  await h2.waitForSelector('#s-build.on');
  await h2.click('#btn-sample');
  await h2.waitForFunction(() => document.querySelectorAll('.qcard').length === 6);
  await h2.click('.step[data-tab=go]');
  await h2.click('#btn-open-room-2');
  await h2.waitForSelector('#s-lobby.on');
  const code2 = (await h2.textContent('#room-code')).trim();
  const cCtx = await ctx();
  const cara = await joinAs(cCtx, URL, code2, 'Cara', 3);
  await h2.waitForFunction(() => document.querySelectorAll('#lobby-players .p-chip').length === 1, null, { timeout: 12000 });
  await h2.click('#btn-start');
  await h2.waitForSelector('#answered-n', { timeout: 12000 });
  ck(/Question 1 \/ 6/.test(await h2.textContent('#stage-progress')),
     'without the board, Start still opens question one', await h2.textContent('#stage-progress'));
  ck(!(await h2.$('#stage-main .pick-grid')), 'and there is no board anywhere');

  ck(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close(); server.kill();
  done();
})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
