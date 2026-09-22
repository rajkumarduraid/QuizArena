/* The big screen: one machine, no room, no players, no score. It has to work
   straight off a file with nothing else running, so this suite drives the page
   over file:// rather than through the relay. */
const { harness, browser } = require('./lib.js');
const path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'index.html');
const { ck, done } = harness();

/* A real PNG with real transparency, because the point of the logo path is
   that the alpha channel survives — a flattened one would pass a test written
   against a file that never had any. */
function wideBars(w, h) {
  const zlib = require('zlib');
  const rows = Buffer.alloc(h * (1 + w * 4));
  let at = 0;
  for (let y = 0; y < h; y++) {
    rows[at++] = 0;
    for (let x = 0; x < w; x++) {
      const on = y >= 8 && y < h - 8 && x >= 8 && x < w - 8 && Math.floor(x / 26) % 2 === 0;
      rows[at++] = on ? 230 : 0; rows[at++] = on ? 198 : 0;
      rows[at++] = on ? 92 : 0;  rows[at++] = on ? 255 : 0;
    }
  }
  const chunk = (tag, data) => {
    const body = Buffer.concat([Buffer.from(tag), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32
      ? zlib.crc32(body) >>> 0 : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))
  ]);
}
let CRC = null;
function crc32(buf) {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

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

  /* The whole point of the rewrite: the second window is built by the first,
     not sent to an address. An address is the thing that fails — in a frame,
     in a viewer, in an artifact — and a host is left with a black rectangle. */
  ck(/^about:blank/.test(screen.url()),
     'the screen is written by the host window, not navigated to a URL', screen.url());
  ck(await screen.$eval('#qa-sprite', e => !!e.querySelector('#i-check')),
     'it carries the icon set, so nothing renders as an empty box');
  ck(await screen.$eval('#screen-stage .pick-tile .n',
       e => getComputedStyle(e).fontSize !== '16px'),
     'and the stylesheet came with it');

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


  /* ------------------------------------------------------------------ */
  console.log('\n— the words on the screen are the host’s —');
  await p.evaluate(() => { location.hash = '#/show/numbers'; });
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  ck((await p.textContent('#show-stage .show-head h1')).trim() === 'Pick a number',
     'it starts with the wording it ships with');

  await p.click('#show-setup');
  await p.waitForSelector('#sw-board', { timeout: 6000 });
  await p.fill('#sw-board', 'Choose a box');
  await p.fill('#sw-call', 'Shout one out and we will open it.');
  await p.fill('#sw-numLab', 'Box');
  await p.waitForFunction(() =>
    /Choose a box/.test(document.querySelector('#show-stage .show-head h1').textContent),
    null, { timeout: 6000 });
  ck(true, 'typing a heading changes the board as you type');
  ck(/Shout one out/.test(await p.textContent('#show-stage .show-head p')),
     'and the line under it');

  await p.click('.modal-bg [data-close]');
  await p.waitForFunction(() => !document.querySelector('.modal-bg.on'), null, { timeout: 4000 });
  const [wScreen] = await Promise.all([c.waitForEvent('page'), p.click('#show-screen')]);
  await wScreen.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });
  ck((await wScreen.textContent('#screen-stage .show-head h1')).trim() === 'Choose a box',
     'the room gets the host’s wording, not the default');

  /* the number label follows into the question */
  await p.evaluate(() => { window.QA.Show.state.spinPick = false; });
  await p.click('#show-stage [data-n]');
  await p.waitForSelector('#show-stage .show-q', { timeout: 8000 });
  ck(/^Box /.test((await p.textContent('#show-stage .qno')).trim()),
     'and what a number is called follows it into the question',
     (await p.textContent('#show-stage .qno')).trim());
  await p.click('#show-back');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 8000 });

  /* the host reloading their own window orphans the one they wrote, so the
     screen is opened again below — which re-adopts that same window by name */
  await wScreen.close();
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  ck((await p.textContent('#show-stage .show-head h1')).trim() === 'Choose a box',
     'the wording is still there next time');

  await p.click('#show-setup');
  await p.waitForSelector('#sw-reset', { timeout: 6000 });
  await p.click('#sw-reset');
  await p.waitForFunction(() =>
    /Pick a number/.test(document.querySelector('#show-stage .show-head h1').textContent),
    null, { timeout: 6000 });
  ck(true, 'and one button puts every line back');

  /* ------------------------------------------------------------------ */
  console.log('\n— the brand —');
  await p.click('.modal-bg [data-close]');
  await p.waitForFunction(() => !document.querySelector('.modal-bg.on'), null, { timeout: 4000 });
  const [bScreen] = await Promise.all([c.waitForEvent('page'), p.click('#show-screen')]);
  await bScreen.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });
  await p.click('#show-setup');
  await p.waitForSelector('#sw-themes [data-t]', { timeout: 6000 });
  const before = await bScreen.evaluate(() =>
    getComputedStyle(document.querySelector('#s-screen')).backgroundColor);
  await p.click('[data-t="boardroom"]');
  await p.waitForTimeout(250);
  const after = await bScreen.evaluate(() =>
    getComputedStyle(document.querySelector('#s-screen')).backgroundColor);
  ck(before !== after, 'picking a theme repaints the room’s screen too', before + ' → ' + after);

  const acc = await p.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  const arena = await p.evaluate(() =>
    window.QA.Brand.THEMES.filter(t => t.id === 'arena')[0].accent.toLowerCase());
  ck(!!acc && acc.toLowerCase() !== arena,
     'and the host’s window takes it too, not the one it shipped with', acc);

  /* a colour that would be illegible must be pushed until it is not */
  const rd = await p.evaluate(() => {
    const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const rgb = h => [1, 3, 5].map(i => parseInt(h.replace('#', '').substr(i - 1, 2), 16));
    window.QA.Brand.set({ accent: '#FFF9C4' });   /* pale yellow: unreadable as a button */
    window.QA.Brand.apply();
    const app = rgb(getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
    const stage = rgb(getComputedStyle(document.querySelector('#s-screen')).getPropertyValue('--brand').trim());
    const ground = rgb(getComputedStyle(document.querySelector('#s-screen'))
      .getPropertyValue('--sunken').trim());
    const ratio = (a, b) => { const x = lum(a), y = lum(b);
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    return { onWhite: ratio(app, [255, 255, 255]), onStage: ratio(stage, ground) };
  });
  ck(rd.onWhite >= 4.5, 'a colour too pale for white button text is darkened until it reads',
     rd.onWhite.toFixed(2) + ':1');
  ck(rd.onStage >= 4.5, 'and the same colour stays bright enough on the dark stage',
     rd.onStage.toFixed(2) + ':1');

  /* a logo goes in by file and lands on the room's screen */
  const logo = path.join(require('os').tmpdir(), 'qa-test-logo.png');
  require('fs').writeFileSync(logo, wideBars(340, 64));
  await p.setInputFiles('#sw-file', logo);
  await p.waitForFunction(() => !!document.querySelector('#sw-prev img'), null, { timeout: 8000 });
  ck(true, 'a logo file is taken and previewed');
  await bScreen.waitForSelector('#screen-brand .stage-mark img', { timeout: 8000 });
  ck(true, 'and it is on the room’s screen, not only the host’s');
  const keepsAlpha = await bScreen.$eval('#screen-brand .stage-mark img',
    e => /^data:image\/(png|svg)/.test(e.src));
  ck(keepsAlpha, 'kept as a PNG, so a transparent mark is not flattened onto white');

  await p.fill('#sw-mark', 'Technology Town Hall');
  await bScreen.waitForFunction(() =>
    /Technology Town Hall/.test(document.querySelector('#screen-brand').textContent),
    null, { timeout: 6000 });
  ck(true, 'wording beside it follows');

  /* the size of it, which a logo at one fixed height cannot be made to suit */
  const markH = () => bScreen.$eval('#screen-brand img', e => e.getBoundingClientRect().height);
  const boardBottom = () => bScreen.evaluate(() => {
    const g = document.querySelector('#screen-stage .pick-grid');
    return { bottom: g.getBoundingClientRect().bottom, h: innerHeight };
  });
  const h100 = await markH();
  const fit100 = await boardBottom();
  const setSize = async v => {
    await p.$eval('#sw-size', (e, x) => {
      e.value = x; e.dispatchEvent(new Event('input', { bubbles: true }));
    }, String(v));
    await p.waitForTimeout(320);
  };
  await setSize(300);
  const h300 = await markH();
  ck(h300 > h100 * 2.4, 'the logo can be made bigger', Math.round(h100) + 'px → ' + Math.round(h300) + 'px');
  const fit300 = await boardBottom();
  ck(fit300.bottom <= fit300.h, 'and the board gives way to it rather than running off the screen',
     Math.round(fit300.bottom) + ' of ' + fit300.h);
  ck(Math.abs(fit300.bottom - fit100.bottom) < 40,
     'the board still ends where it did', Math.round(fit100.bottom) + ' → ' + Math.round(fit300.bottom));

  await setSize(50);
  ck((await markH()) < h100, 'and smaller');
  ck(await p.$eval('#sw-prev img', e => e.getBoundingClientRect().height < 30),
     'the preview in the sheet is drawn at that size too, so it can be judged there');
  await p.click('#sw-size1');
  await p.waitForTimeout(250);
  ck(Math.abs((await markH()) - h100) < 2, 'Reset puts it back', Math.round(await markH()) + 'px');

  await p.click('#sw-clear');
  await p.waitForTimeout(200);
  ck(await p.$eval('#sw-size', e => e.disabled),
     'with no logo there is nothing to size, and the slider says so');
  await p.setInputFiles('#sw-file', logo);
  await p.waitForFunction(() => !!document.querySelector('#sw-prev img'), null, { timeout: 8000 });

  /* put it back so the rest of the suite sees the shipped look */
  await p.evaluate(() => {
    window.QA.Brand.set({ theme: 'arena', accent: '', ground: '', logo: '', mark: '' });
    window.QA.Brand.apply();
  });
  await p.click('.modal-bg [data-close]');
  await bScreen.close();

  /* ------------------------------------------------------------------ */
  console.log('\n— the board runs before a number opens —');
  await p.reload();
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });
  /* an earlier block turned it off; turn it back on the way a host would */
  await p.click('#show-setup');
  await p.waitForSelector('.set-sec .switch .track', { timeout: 6000 });
  if (!(await p.$eval('#sw-spin', e => e.checked))) await p.click('.set-sec .switch .track');
  await p.click('.modal-bg [data-close]');
  await p.waitForFunction(() => !document.querySelector('.modal-bg.on'), null, { timeout: 4000 });
  const [sp] = await Promise.all([c.waitForEvent('page'), p.click('#show-screen')]);
  await sp.waitForSelector('#screen-stage .pick-grid', { timeout: 12000 });

  /* the suite has opened some numbers already, so take one that is still
     there rather than assuming a position */
  const want = await p.$eval('#show-stage .pick-grid [data-n]', e => Number(e.dataset.n));
  const wantQ = await p.evaluate(n => {
    const S = window.QA.Show.state;
    const qs = window.QA.Build.getConfig().questions.filter(q => q.kind !== 'pz');
    return (qs[S.order[n]] || {}).text || '';
  }, want);

  await p.click('#show-stage [data-n="' + want + '"]');
  await p.waitForSelector('#show-stage .pick-grid.sweeping', { timeout: 4000 });
  ck(true, 'tapping a number sets the board running rather than opening it');
  ck(!!(await sp.$('#screen-stage .pick-grid.sweeping')),
     'the room’s screen runs with it');
  ck(!(await p.$('#show-stage [data-n]')),
     'and nothing else can be tapped while it runs');

  /* the spotlight has to actually move */
  const lit = new Set();
  for (let i = 0; i < 14; i++) {
    const at = await p.$eval('#show-stage .pick-grid',
      g => { const s = g.querySelector('.pick-tile.spot'); return s ? [].indexOf.call(g.children, s) : -1; });
    if (at >= 0) lit.add(at);
    await p.waitForTimeout(70);
  }
  ck(lit.size > 3, 'the spotlight travels the board', lit.size + ' tiles lit');

  await p.waitForSelector('#show-stage .pick-grid.landing .pick-tile.landed', { timeout: 6000 });
  const landedAt = await p.$eval('#show-stage .pick-grid',
    g => [].indexOf.call(g.children, g.querySelector('.pick-tile.landed')));
  ck(landedAt === want, 'and stops on the number that was actually called',
     'landed on ' + landedAt + ', wanted ' + want);
  const landedOn = await sp.$eval('#screen-stage .pick-grid',
    g => [].indexOf.call(g.children, g.querySelector('.pick-tile.landed')));
  ck(landedOn === want, 'the room sees it stop on the same one', String(landedOn));
  const turns = await p.$eval('#show-stage .pick-tile.landed', e => getComputedStyle(e).animationName);
  ck(turns === 'tile-land', 'the tile it stops on turns over', turns);

  await p.waitForSelector('#show-stage .show-q', { timeout: 8000 });
  ck((await p.textContent('#show-stage .show-text')).trim() === wantQ.trim(),
     'and the question that opens is the one behind that number');
  await sp.waitForSelector('#screen-stage .show-q', { timeout: 8000 });
  ck((await sp.textContent('#screen-stage .show-text')).trim() === wantQ.trim(),
     'in both windows');

  await p.click('#show-back');
  await p.waitForSelector('#show-stage .pick-grid', { timeout: 8000 });
  await p.click('#show-setup');
  await p.waitForSelector('.set-sec .switch .track', { timeout: 6000 });
  if (await p.$eval('#sw-spin', e => e.checked)) await p.click('.set-sec .switch .track');
  await p.click('.modal-bg [data-close]');
  await p.waitForFunction(() => !document.querySelector('.modal-bg.on'), null, { timeout: 4000 });
  await p.click('#show-stage [data-n]');
  await p.waitForSelector('#show-stage .show-q', { timeout: 2500 });
  ck(!(await p.$('.pick-grid.sweeping')), 'turned off, a number opens straight away');
  await sp.close();

  /* ------------------------------------------------------------------ */
  console.log('\n— what the sounds are made of —');
  /* the chain is built once, the first time anything plays, so this needs a
     page where nothing has played yet */
  const sp2 = await c.newPage();
  await sp2.goto(URL + '#/show');
  await sp2.waitForSelector('#s-show.on', { timeout: 10000 });
  const built = await sp2.evaluate(() => {
    const A = window.AudioContext || window.webkitAudioContext;
    const seen = { osc: 0, noise: 0, filter: 0, limiter: 0, room: 0 };
    const P = A.prototype;
    const spy = (name, key) => {
      const f = P[name];
      P[name] = function () { seen[key]++; return f.apply(this, arguments); };
    };
    spy('createOscillator', 'osc'); spy('createBufferSource', 'noise');
    spy('createBiquadFilter', 'filter'); spy('createDynamicsCompressor', 'limiter');
    spy('createConvolver', 'room');
    window.QA.Sound.unlock();
    window.QA.Sound.sting();
    return seen;
  });
  ck(built.limiter >= 1, 'everything goes through a limiter, so two sounds at once cannot clip');
  ck(built.room >= 1, 'and through a room, so nothing lands flat');
  ck(built.osc >= 6, 'the answer sting is a chord, not a beep', built.osc + ' voices');
  ck(built.filter >= built.osc, 'every voice has a filter closing over it',
     built.filter + ' filters for ' + built.osc + ' voices');

  const quiet = await sp2.evaluate(() => {
    const A = window.AudioContext || window.webkitAudioContext;
    let n = 0;
    const f = A.prototype.createOscillator;
    A.prototype.createOscillator = function () { n++; return f.apply(this, arguments); };
    window.QA.Sound.enabled = false; window.QA.Sound.sting(); window.QA.Sound.land();
    const off = n;
    window.QA.Sound.enabled = true; window.QA.Sound.volume = 0;
    window.QA.Sound.sting(); window.QA.Sound.land();
    const zero = n;
    window.QA.Sound.volume = 1;
    return { off: off, zero: zero };
  });
  ck(quiet.off === 0, 'muted, nothing is even built');
  ck(quiet.zero === 0, 'and at zero volume nothing is built either');
  await sp2.close();

  await p.close();

  /* ---------------------------------------------------------------------
     The case that started this: the page running inside a sandboxed frame,
     which is how it is served from an artifact viewer. There the page's own
     address will not load a second time in a top-level window, so the old
     screen came up black. A written window has no address to fail.          */
  console.log('\n— inside a sandboxed frame, the way a viewer serves it —');
  const app = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const frame = '<!doctype html><meta charset="utf-8"><body style="margin:0">' +
    '<iframe src="app.html" style="border:0;width:100vw;height:100vh" ' +
    'sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"></iframe>';

  const c4 = await ctx(1400, 900);
  await c4.route('https://qa.test/**', r => {
    const u = r.request().url();
    r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
                body: /app\.html/.test(u) ? app : frame });
  });
  const fp = await c4.newPage();
  await fp.goto('https://qa.test/frame.html');
  const inner = () => fp.frames().filter(f => /app\.html/.test(f.url()))[0];
  await fp.waitForFunction(() => document.querySelector('iframe'), null, { timeout: 8000 });
  let fr = null;
  for (let i = 0; i < 60 && !fr; i++) { fr = inner(); if (!fr) await fp.waitForTimeout(100); }
  ck(!!fr, 'the app boots inside the frame');

  await fr.waitForSelector('#s-home.on, #s-build.on, .screen.on', { timeout: 15000 });
  await fr.evaluate(() => { location.hash = '#/host'; });
  await fr.waitForSelector('#s-build.on', { timeout: 10000 });
  await fr.click('#btn-sample');
  await fr.waitForFunction(() =>
    (JSON.parse(localStorage.getItem('qa:config:v1') || '{}').questions || []).length === 6,
    null, { timeout: 8000 });
  await fr.evaluate(() => { location.hash = '#/show/numbers'; });
  await fr.waitForSelector('#show-stage .pick-grid', { timeout: 10000 });

  const [fscreen] = await Promise.all([
    c4.waitForEvent('page'),
    fr.click('#show-screen')
  ]);
  await fscreen.waitForSelector('#screen-stage .pick-grid', { timeout: 15000 });
  ck(true, 'the screen still opens, and the room sees the board');
  const fTiles = await fscreen.$$eval('#screen-stage .pick-tile .n', e => e.map(x => x.textContent.trim()));
  ck(fTiles.length === 6, 'all six numbers on it', fTiles.join(','));
  const fBg = await fscreen.evaluate(() =>
    getComputedStyle(document.querySelector('#s-screen')).backgroundColor);
  ck(/^rgba?\((\d+), (\d+), (\d+)/.test(fBg) &&
     fBg.match(/\d+/g).slice(0, 3).reduce((a, x) => a + (+x), 0) < 200,
     'on the dark stage, not a black rectangle', fBg);

  await fr.click('#show-stage [data-n="0"]');
  await fscreen.waitForSelector('#screen-stage .show-q', { timeout: 12000 });
  ck((await fscreen.textContent('#screen-stage .show-text')).trim().length > 5,
     'and the host can still put a question on it');
  await fr.click('#show-reveal');
  await fscreen.waitForSelector('#screen-stage .show-answers.revealed', { timeout: 12000 });
  ck((await fscreen.$$('#screen-stage .show-ans.right')).length === 1,
     'right and wrong land in the room as they should');

  /* closing it and asking again gets a fresh one rather than nothing */
  await fscreen.close();
  await fp.waitForTimeout(200);
  const [fscreen2] = await Promise.all([
    c4.waitForEvent('page'),
    fr.click('#show-screen')
  ]);
  await fscreen2.waitForSelector('#screen-stage', { timeout: 15000 });
  ck(true, 'closing the screen and asking again opens another');
  await fscreen2.close();

  /* The fallback the blocked-pop-up note hands out: a window the host opened
     by hand at that address. It has no handle to us, so it goes on listening
     over the channel — that path has to keep working too. */
  console.log('\n— a screen window opened by hand at the address —');
  const byHand = await c4.newPage();
  await byHand.goto('https://qa.test/app.html#/screen');
  await byHand.waitForSelector('#s-screen.on', { timeout: 15000 });
  await fr.click('#show-back');
  await byHand.waitForSelector('#screen-stage .pick-grid', { timeout: 15000 });
  ck(true, 'it finds the control window on its own and picks up the board');
  await fr.click('#show-stage [data-n="1"]');
  await byHand.waitForSelector('#screen-stage .show-q', { timeout: 15000 });
  ck((await byHand.textContent('#screen-stage .show-text')).trim() ===
     (await fr.textContent('#show-stage .show-text')).trim(),
     'and follows the host from there');
  await byHand.close();

  ck(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await b.close();
  done();
})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
