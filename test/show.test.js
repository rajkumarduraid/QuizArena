/* The big screen: one machine, no room, no players, no score. It has to work
   straight off a file with nothing else running, so this suite drives the page
   over file:// rather than through the relay. */
const { harness, browser } = require('./lib.js');
const path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
const { ck, done } = harness();

(async () => {
  const errs = [];
  const { b, ctx } = await browser(errs);
  const c = await ctx(1500, 950);
  const p = await c.newPage();

  console.log('\n— it opens with nothing else running —');
  await p.goto(URL + '#/show');
  await p.waitForSelector('#s-show.on', { timeout: 10000 });
  ck(true, 'no room, no code, no sign-up');
  ck(/no questions yet/i.test(await p.textContent('#show-stage')),
     'an empty quiz says so rather than showing a blank wall');

  /* give it a quiz, the way the builder would */
  await p.goto(URL + '#/host');
  await p.waitForSelector('#s-build.on');
  await p.click('#btn-sample');
  await p.waitForFunction(() => document.querySelectorAll('.qcard').length === 6);
  await p.waitForFunction(() =>
    (JSON.parse(localStorage.getItem('qa:config:v1') || '{}').questions || []).length === 6,
    null, { timeout: 6000 });

  console.log('\n— pick a number —');
  await p.goto(URL + '#/show');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  const tiles = await p.$$eval('#show-stage .pick-tile .n', e => e.map(x => x.textContent.trim()));
  ck(tiles.join(',') === '1,2,3,4,5,6', 'a numbered tile per question', tiles.join(','));
  ck(!/pts|points|1,000/.test(await p.textContent('#show-stage')),
     'no points, no scores — nothing to rank');

  await p.click('#show-stage [data-n="2"]');
  await p.waitForSelector('.show-q', { timeout: 8000 });
  const shown = (await p.textContent('.show-text')).trim();
  ck(shown.length > 10, 'tapping a number puts its question on the screen', shown.slice(0, 40));
  ck((await p.$$('.show-ans')).length >= 2, 'with its options');
  ck(!(await p.$('.show-answers.revealed')), 'and the answer held back');

  await p.click('#show-reveal');
  await p.waitForSelector('.show-answers.revealed', { timeout: 6000 });
  const right = await p.$eval('.show-ans.right span:last-child', e => e.textContent.trim());
  const expect = await p.evaluate(t => {
    const q = window.QA.Build.getConfig().questions.filter(x => (x.text || '').trim() === t)[0];
    return q ? q.options[q.correct] : null;
  }, shown);
  ck(right === expect, 'Show the answer marks the right one', right + ' vs ' + expect);

  await p.click('#show-next');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 6000 });
  ck(await p.$eval('#show-stage .pick-tile:nth-child(3)', e => /done/.test(e.className)),
     'the number that was used is struck off');
  ck(!(await p.$('#show-stage [data-n="2"]')), 'and cannot be opened twice');

  /* a reload mid-session must not lose the board */
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  ck(await p.$eval('#show-stage .pick-tile:nth-child(3)', e => /done/.test(e.className)),
     'a stray reload keeps what has already been opened');

  console.log('\n— the keys a presenter has a hand on —');
  await p.click('#show-stage [data-n="0"]');
  await p.waitForSelector('.show-q', { timeout: 6000 });
  await p.keyboard.press('Space');
  await p.waitForSelector('.show-answers.revealed', { timeout: 6000 });
  ck(true, 'space gives the answer');
  await p.keyboard.press('Escape');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 6000 });
  ck(true, 'escape goes back to the board');

  await p.click('#show-reset');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 6000 });
  ck((await p.$$('#show-stage .pick-tile.done')).length === 0, 'Start over clears the board');

  console.log('\n— spin the wheel —');
  await p.click('#show-tools [data-tool="wheel"]');
  await p.waitForSelector('#wheel-svg', { timeout: 6000 });
  ck((await p.$$('#wheel-svg path')).length >= 2, 'it draws a wheel from the team names');
  await p.click('#wheel-edit');
  await p.waitForSelector('#wn');
  await p.fill('#wn', 'Priya\nRanjith\nAnita\nDeepa\nSam');
  await p.click('#wn-save');
  await p.waitForFunction(() => document.querySelectorAll('#wheel-svg path').length === 5, null, { timeout: 6000 });
  ck(true, 'the names you type are the wheel');

  await p.click('#wheel-spin');
  await p.waitForFunction(() => (document.querySelector('.wheel-out').textContent || '').trim().length > 0,
    null, { timeout: 12000 });
  const winner = (await p.textContent('.wheel-out')).trim();
  ck(['Priya', 'Ranjith', 'Anita', 'Deepa', 'Sam'].indexOf(winner) >= 0,
     'a spin lands on one of them', winner);

  /* the pointer and the announcement must never disagree */
  const underPin = await p.evaluate(() => {
    const svg = document.querySelector('#wheel-svg');
    const n = document.querySelectorAll('#wheel-svg path').length;
    const m = /rotate\(([-\d.]+)deg\)/.exec(svg.style.transform || '');
    const rot = m ? parseFloat(m[1]) : 0;
    /* sector k spans [k, k+1) * 360/n starting at the top, before rotation */
    const seg = 360 / n;
    let a = (-90 - rot) % 360; if (a < 0) a += 360;       /* pin, in wheel space */
    let idx = Math.floor(((a + 90) % 360) / seg);
    return { idx, labels: Array.from(document.querySelectorAll('#wheel-svg text')).map(t => t.textContent) };
  });
  ck(underPin.labels[underPin.idx] === winner,
     'the name announced is the one under the pin',
     'pin shows ' + underPin.labels[underPin.idx] + ', announced ' + winner);

  /* nothing on the wheel may read upside down, whichever side it sits on */
  const tilts = await p.$$eval('#wheel-svg text', els => els.map(e => {
    const m = /rotate\(([-\d.]+)/.exec(e.getAttribute('transform') || '');
    return m ? parseFloat(m[1]) : 0;
  }));
  const norm = d => { let x = ((d % 360) + 360) % 360; return x > 180 ? x - 360 : x; };
  ck(tilts.length === 5 && tilts.every(d => Math.abs(norm(d)) <= 90.01),
     'every name on the wheel is the right way up', tilts.map(norm).join(', '));

  await p.reload();
  await p.waitForSelector('#s-show.on', { timeout: 10000 });
  ck(/Priya/.test(await p.textContent('#show-stage')), 'the wheel remembers its names');

  console.log('\n— reveal a picture —');
  await p.click('#show-tools [data-tool="reveal"]');
  await p.waitForSelector('#show-stage', { timeout: 6000 });
  ck(/no question has a picture/i.test(await p.textContent('#show-stage')),
     'with no pictures it says so instead of showing an empty frame');

  /* now give a question a picture and come back */
  await p.evaluate(() => {
    const cfg = JSON.parse(localStorage.getItem('qa:config:v1'));
    /* a tiny but real image, so the tiles have something to cover */
    cfg.questions[0].image = 'data:image/svg+xml;base64,' + btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">' +
      '<rect width="640" height="420" fill="#1B5BDB"/>' +
      '<circle cx="320" cy="210" r="140" fill="#E39400"/></svg>');
    localStorage.setItem('qa:config:v1', JSON.stringify(cfg));
  });
  /* the page holds the quiz in memory, so a write straight to storage only
     shows up after a reload — the same as anywhere else in the app */
  await p.evaluate(() => { location.hash = '#/show/reveal'; });
  await p.reload();
  await p.waitForSelector('.reveal-hold', { timeout: 8000 });
  ck((await p.$$('.reveal-tiles i')).length === 16, 'the picture starts under sixteen pieces');
  ck((await p.$$('.reveal-tiles i.gone')).length === 0, 'none of them lifted yet');

  await p.click('.reveal-tiles [data-p="5"]');
  await p.waitForFunction(() => document.querySelectorAll('.reveal-tiles i.gone').length === 1, null, { timeout: 6000 });
  ck(true, 'clicking a piece lifts it');
  await p.click('#rv-one');
  await p.waitForFunction(() => document.querySelectorAll('.reveal-tiles i.gone').length === 2, null, { timeout: 6000 });
  ck(true, 'or the button lifts a random one');

  await p.click('#rv-say');
  await p.waitForFunction(() => document.querySelectorAll('.reveal-tiles i.gone').length === 16, null, { timeout: 6000 });
  ck(/Mercury|Jupiter|Mars|Venus/.test(await p.textContent('#show-stage')),
     'showing the answer uncovers everything and names it');

  ck(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close();
  done();
})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
