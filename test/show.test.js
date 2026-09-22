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
  const right = await p.$eval('.show-ans.right .txt', e => e.textContent.trim());
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

  console.log('\n— two windows: the room sees one thing, the host another —');
  /* the tool is remembered, so ask for the board rather than assume it */
  await p.evaluate(() => { location.hash = '#/show/numbers'; });
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });

  const [screen] = await Promise.all([
    c.waitForEvent('page'),
    p.click('#show-screen')
  ]);
  await screen.waitForLoadState('domcontentloaded');
  await screen.waitForSelector('#s-screen.on', { timeout: 10000 });
  ck(true, 'Open the screen brings up a second window');
  await screen.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });
  ck(true, 'and it picks up the board from the control window');

  const liveButtons = await screen.$$eval('#screen-stage button:not([disabled])', e => e.length);
  ck(liveButtons === 0, 'the room\u2019s window has nothing to click', liveButtons + ' enabled buttons');
  /* other screens keep their own toolbars in the document, hidden — what
     matters is that the one on show has none */
  ck(!(await screen.$('#s-screen .topbar')), 'and no toolbar across the top');
  ck(await screen.$eval('#s-screen', e => e.classList.contains('on')), 'the room sees only that window');
  ck(!!(await p.$('#show-reveal, #show-stage [data-n]')), 'the host window keeps the controls');

  /* the host opens a number; the room must follow */
  await p.click('#show-stage [data-n="1"]');
  await p.waitForSelector('.show-q', { timeout: 8000 });
  const asked = (await p.textContent('#show-stage .show-text')).trim();
  await screen.waitForSelector('#screen-stage .show-q', { timeout: 10000 });
  ck((await screen.textContent('#screen-stage .show-text')).trim() === asked,
     'tapping a number puts the same question on the room\u2019s screen');
  ck(!(await screen.$('#screen-stage .show-actions')), 'without the buttons');
  ck(!(await screen.$('#screen-stage .show-answers.revealed')), 'and without giving the answer away');

  /* and the reveal, with its right/wrong animation */
  await p.click('#show-reveal');
  await screen.waitForSelector('#screen-stage .show-answers.revealed', { timeout: 10000 });
  const marks = await screen.$$eval('#screen-stage .show-ans',
    els => els.map(e => e.classList.contains('right') ? 'right' : e.classList.contains('wrong') ? 'wrong' : '-'));
  ck(marks.filter(x => x === 'right').length === 1 && marks.indexOf('-') < 0,
     'the room sees exactly one right and the rest wrong', marks.join(','));
  const ticks = await screen.$$eval('#screen-stage .show-ans .ansmark', e => e.length);
  ck(ticks === marks.length, 'every option is marked with a tick or a cross', String(ticks));
  const anim = await screen.$eval('#screen-stage .show-ans.right',
    e => getComputedStyle(e).animationName);
  ck(anim === 'ans-win', 'and the right one animates in', anim);

  await p.click('#show-next');
  await screen.waitForSelector('#screen-stage .pick-grid', { timeout: 10000 });
  ck(await screen.$eval('#screen-stage .pick-tile:nth-child(2)', e => /done/.test(e.className)),
     'going back leaves the number struck off on both');

  /* the wheel travels too */
  await p.click('#show-tools [data-tool="wheel"]');
  await screen.waitForSelector('#screen-stage #wheel-svg', { timeout: 10000 });
  ck(true, 'switching tool switches the room\u2019s window with it');
  await p.click('#wheel-spin');
  await screen.waitForFunction(
    () => (document.querySelector('#screen-stage .wheel-out').textContent || '').trim().length > 0,
    null, { timeout: 15000 });
  const seen = (await screen.textContent('#screen-stage .wheel-out')).trim();
  const said = (await p.textContent('#show-stage .wheel-out')).trim();
  ck(seen === said && seen.length > 0, 'both windows name the same winner', seen + ' / ' + said);

  await screen.close();

  console.log('\n— the stage —');
  await p.evaluate(() => { location.hash = '#/show/numbers'; });
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  const [scr2] = await Promise.all([c.waitForEvent('page'), p.click('#show-screen')]);
  await scr2.waitForLoadState('domcontentloaded');
  await scr2.setViewportSize({ width: 1600, height: 1000 });
  await scr2.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });

  const grounds = await Promise.all([p, scr2].map(pg =>
    pg.evaluate(() => getComputedStyle(document.querySelector('.screen.on')).backgroundColor)));
  ck(grounds[0] !== grounds[1], 'the room gets a stage, the host keeps the daylight', grounds.join(' vs '));
  const lum = await scr2.evaluate(() => {
    const m = /rgba?\((\d+), ?(\d+), ?(\d+)/.exec(
      getComputedStyle(document.querySelector('#s-screen')).backgroundColor);
    return m ? (+m[1] + +m[2] + +m[3]) / 3 : 255;
  });
  ck(lum < 70, 'and that stage is actually dark', 'mean channel ' + Math.round(lum));
  const inkOk = await scr2.evaluate(() => {
    const m = /rgba?\((\d+), ?(\d+), ?(\d+)/.exec(
      getComputedStyle(document.querySelector('#screen-stage h1')).color);
    return m ? (+m[1] + +m[2] + +m[3]) / 3 : 0;
  });
  ck(inkOk > 180, 'with light text on it, not the light theme\u2019s ink', 'mean channel ' + Math.round(inkOk));

  /* a board that runs off the bottom of a projector is the one thing the room
     cannot work around */
  const fits = await scr2.evaluate(() => {
    const g = document.querySelector('#screen-stage .pick-grid');
    const r = g.getBoundingClientRect();
    return { bottom: Math.round(r.bottom), h: window.innerHeight, over: r.bottom > window.innerHeight + 1 };
  });
  ck(!fits.over, 'the whole board fits on the screen', 'grid ends at ' + fits.bottom + ' of ' + fits.h);

  const tileAnim = await scr2.$eval('#screen-stage .pick-tile', e => getComputedStyle(e).animationName);
  ck(tileAnim === 'tile-deal', 'the tiles deal themselves out', tileAnim);
  await scr2.close();

  console.log('\n— sound —');
  ck(/Sound on/.test(await p.textContent('#show-sound')), 'sound starts on');
  await p.click('#show-sound');
  ck(/Sound off/.test(await p.textContent('#show-sound')), 'and can be turned off');
  ck(await p.evaluate(() => window.QA.Sound.enabled === false), 'which actually silences it');
  await p.waitForFunction(() =>
    JSON.parse(localStorage.getItem('qa:show:v1') || '{}').sound === false, null, { timeout: 5000 });
  await p.reload();
  await p.waitForSelector('#s-show.on', { timeout: 10000 });
  ck(/Sound off/.test(await p.textContent('#show-sound')), 'and it stays off next time');
  await p.click('#show-sound');
  ck(/Sound on/.test(await p.textContent('#show-sound')), 'and back on again');

  console.log('\n— opening a number —');
  await p.evaluate(() => { location.hash = '#/show/numbers'; });
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  await p.click('#show-stage [data-n="4"]');
  await p.waitForSelector('.show-q.fresh', { timeout: 8000 });
  ck(!!(await p.$('.q-open .big-n')), 'the number the room called out arrives first');
  ck((await p.textContent('.q-open .big-n')).trim() === '5', 'and it is the number they called', await p.textContent('.q-open .big-n'));
  ck((await p.$$('.q-open .ring')).length === 2, 'with the burst behind it');

  const wordSpans = await p.$$eval('.show-text .w', els => els.map(e => e.textContent));
  const qWords = (await p.$eval('.show-text', e => e.textContent)).trim().split(/\s+/);
  ck(wordSpans.length === qWords.length && wordSpans.length > 2,
     'the question is split so it can arrive a word at a time', wordSpans.length + ' words');
  const delays = await p.$$eval('.show-text .w', els => els.map(e => getComputedStyle(e).animationDelay));
  ck(delays.length > 2 && delays[0] !== delays[1] &&
     parseFloat(delays[1]) > parseFloat(delays[0]), 'each one a beat after the last',
     delays.slice(0, 3).join(', '));
  const optStart = await p.$eval('.show-answers', e => parseFloat(getComputedStyle(e).getPropertyValue('--start')));
  ck(optStart > parseFloat(delays[delays.length - 1]) * 1000,
     'and the options wait for the last word', optStart + 'ms vs last word ' + delays[delays.length - 1]);

  await p.click('#show-reveal');
  await p.waitForSelector('.show-answers.revealed', { timeout: 6000 });
  ck(!(await p.$('.q-open')), 'giving the answer does not play the opening again');
  ck(!(await p.$('.show-text .w')), 'nor re-write the question');

  console.log('\n— a question on its own, with no choices —');
  await p.click('#show-back');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 6000 });
  ck(/With choices/.test(await p.textContent('#show-choices')), 'choices are shown by default');
  await p.click('#show-choices');
  ck(/Question only/.test(await p.textContent('#show-choices')), 'and can be turned off');

  const [scr3] = await Promise.all([c.waitForEvent('page'), p.click('#show-screen')]);
  await scr3.waitForLoadState('domcontentloaded');
  await scr3.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });

  /* earlier sections have used some numbers, and the board remembers — so take
     whichever is still open rather than a fixed one */
  await p.click('#show-stage [data-n]');
  await p.waitForSelector('.show-q.solo', { timeout: 8000 });
  ck((await p.$$('.show-ans')).length === 0, 'the question comes up with nothing under it');
  ck(!!(await p.$('.q-open .big-n')), 'and still opens with its number');
  await scr3.waitForSelector('#screen-stage .show-q.solo', { timeout: 10000 });
  ck((await scr3.$$('#screen-stage .show-ans')).length === 0, 'the room sees no choices either');
  const solo = await scr3.$eval('#screen-stage .show-q.solo .show-text',
    e => parseFloat(getComputedStyle(e).fontSize));
  ck(solo > 40, 'so the question takes the room it needs', Math.round(solo) + 'px');

  await p.click('#show-reveal');
  await p.waitForSelector('.answer-solo', { timeout: 8000 });
  const soloAns = (await p.textContent('.answer-solo .val')).trim();
  const soloExpect = await p.evaluate(() => {
    const S = window.QA.Show.state;
    const qs = window.QA.Build.getConfig().questions.filter(q => q.kind !== 'pz');
    const q = qs[S.at];
    return q ? q.options[q.correct] : null;
  });
  ck(soloAns === soloExpect, 'the answer lands on its own, and it is the right one',
     soloAns + ' vs ' + soloExpect);
  await scr3.waitForSelector('#screen-stage .answer-solo', { timeout: 10000 });
  ck((await scr3.textContent('#screen-stage .answer-solo .val')).trim() === soloExpect,
     'and the room gets the same');
  await scr3.close();

  await p.reload();
  await p.waitForSelector('#s-show.on', { timeout: 10000 });
  ck(/Question only/.test(await p.textContent('#show-choices')), 'the choice sticks next time');
  await p.click('#show-choices');

  ck(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close();
  done();
})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
