/* ============================================================================
   Quiz Arena — stage branding

   The big screen goes up on a wall in front of colleagues, so it should look
   like it belongs to the company running the meeting rather than to this app.
   That is three things and no more: a palette, a mark, and the words.

   Two decisions worth knowing about.

   The palette is written into a <style> element rather than set as inline
   properties on #s-screen. That is not tidiness — the audience window is built
   by copying this page's <style> blocks, so a rule written this way travels
   with it and inline properties would not.

   The palette is derived from two colours rather than listed out. A theme is
   an accent and a ground; everything else — surfaces, rules, dimmed text — is
   that ground mixed toward white by a fixed amount. Deriving it means a colour
   picked out of a brand guide produces a whole coherent screen, and it lets
   the accent be pushed until it actually reads: light enough on the dark stage,
   dark enough under white button text. A theme you can set is no use if it can
   be set to something illegible.

   There is no company mark in this file and there will not be one. A logo is
   the company's, and anyone inside it already has the real file — so this takes
   an upload. What you put there is your call; make sure you have the right to
   use it, particularly for anything beyond your own meeting room.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;
const { $, esc, LS } = Q;

const KEY = 'qa:brand:v1';

/* Each theme is an accent and a ground. The third value is a second wash of
   light across the stage, which stops a large dark wall looking like a dead
   rectangle on a projector. */
const THEMES = [
  { id: 'arena',     name: 'Arena',     accent: '#6D4BFF', ground: '#101128', wash: '#1F2A5E' },
  { id: 'boardroom', name: 'Boardroom', accent: '#C9A227', ground: '#0B1B33', wash: '#123050' },
  { id: 'midnight',  name: 'Midnight',  accent: '#00C2A8', ground: '#07110F', wash: '#0B2B33' },
  { id: 'slate',     name: 'Slate',     accent: '#3B82F6', ground: '#13161D', wash: '#1C2A3D' },
  { id: 'claret',    name: 'Claret',    accent: '#E8623C', ground: '#1A0F14', wash: '#3A1720' }
];

const DEF = { theme: 'arena', accent: '', ground: '', logo: '', mark: '', size: 1 };
let B = Object.assign({}, DEF);

/* ------------------------------------------------------------ colour maths */
function rgb(h) {
  h = String(h || '').trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v)))
  .toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

/* WCAG relative luminance, so "readable" is a measurement and not a guess */
function lum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* Walk a colour toward white (or black) until it reads against the ground it
   sits on. Twenty steps of 5% is finer than the eye and always terminates. */
function readable(c, against, want, towards) {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, against) < want; i++) {
    out = mix(c, towards, (i + 1) * 0.05);
  }
  return out;
}

/* ------------------------------------------------------------------ state */
function theme() {
  return THEMES.filter(t => t.id === B.theme)[0] || THEMES[0];
}
function accent() { return rgb(B.accent) || rgb(theme().accent); }
function ground() { return rgb(B.ground) || rgb(theme().ground); }
function wash() {
  /* a custom ground has no wash of its own, so lift one out of it */
  if (B.ground && rgb(B.ground)) return mix(rgb(B.ground), accent(), 0.22);
  return rgb(theme().wash);
}

/* How big the mark is drawn, as a multiple of its default height. Held as a
   ratio rather than a pixel height because the mark is already sized against
   the viewport — one number then works on a laptop and on a wall. */
const SIZE_MIN = 0.5, SIZE_MAX = 3;
const size = () => {
  const n = Number(B.size);
  return Number.isFinite(n) ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)) : 1;
};

function load() {
  const s = LS.get(KEY, null);
  B = Object.assign({}, DEF, s && typeof s === 'object' ? s : {});
  if (!THEMES.some(t => t.id === B.theme)) B.theme = DEF.theme;
  B.size = size();
  return B;
}
function save() { LS.set(KEY, B); }
function set(patch) { Object.assign(B, patch); save(); }

/* ------------------------------------------------------------------- CSS */
function css() {
  const g = ground(), a = accent(), w = wash();
  const up = t => hex(mix(g, WHITE, t));

  /* on the stage the accent has to carry text on a dark ground */
  const sAcc = hex(readable(a, g, 5.5, WHITE));
  const sAcc2 = hex(mix(readable(a, g, 5.5, WHITE), WHITE, 0.3));
  /* in the daylight app the accent is text on paper, so it is darkened until
     it reads there */
  const dAcc = hex(readable(a, WHITE, 4.6, BLACK));
  const dAcc2 = hex(mix(readable(a, WHITE, 4.6, BLACK), WHITE, 0.17));
  /* as a button fill it keeps its true colour, and the ink on top is whichever
     of black or white stands further from it — which is how a gold brand ends
     up gold with dark lettering rather than a drab olive with white */
  const onBrand = contrast(a, WHITE) >= contrast(a, BLACK) ? '#ffffff' : hex(mix(a, BLACK, 0.84));
  const dSoft = hex(mix(a, WHITE, 0.9));
  const dLine = hex(mix(a, WHITE, 0.62));

  return [
    /* the whole app follows the accent, so the host's window and the room's
       window are plainly the same piece of software */
    ':root{',
    '  --brand:' + dAcc + '; --brand-2:' + dAcc2 + ';',
    '  --brand-soft:' + dSoft + '; --brand-line:' + dLine + ';',
    '  --accent-rgb:' + a.map(Math.round).join(',') + ';',
    '  --brand-fill:' + hex(a) + '; --brand-fill-2:' + hex(mix(a, WHITE, 0.16)) + ';',
    '  --on-brand:' + onBrand + ';',
    '  --mark-scale:' + size().toFixed(2) + ';',
    '  --ring:0 0 0 3px ' + hex(a) + '33;',
    '}',
    '#s-screen{',
    '  --ink:' + up(0.95) + '; --ink-2:' + up(0.78) + ';',
    '  --muted:' + up(0.56) + '; --faint:' + up(0.4) + ';',
    '  --surface:' + up(0.09) + '; --surface-2:' + up(0.14) + ';',
    '  --sunken:' + up(0.045) + ';',
    '  --line:' + up(0.17) + '; --line-2:' + up(0.3) + ';',
    '  --brand:' + sAcc + '; --brand-2:' + sAcc2 + ';',
    '  --brand-soft:' + up(0.13) + '; --brand-line:' + hex(mix(g, a, 0.5)) + ';',
    /* the stage's own accent, lifted until it reads on the dark ground — every
       glow and wash on the screen is mixed from these three channels */
    '  --accent-rgb:' + readable(a, g, 5.5, WHITE).map(Math.round).join(',') + ';',
    '  --num:' + hex(mix(readable(a, g, 5.5, WHITE), WHITE, 0.72)) + ';',
    '  color:var(--ink);',
    '  background:',
    /* the glow at the top follows the theme's own second colour, lifted a
       little toward the accent — a big dark rectangle on a projector reads as
       a dead screen without it */
    '    radial-gradient(1100px 760px at 50% 24%, ' + hex(mix(mix(g, w, 0.5), a, 0.12)) + ' 0%, ' + hex(g) + '00 66%),',
    '    radial-gradient(900px 700px at 88% 94%, ' + hex(w) + ' 0%, ' + hex(w) + '00 62%),',
    '    ' + hex(g) + ';',
    '}'
  ].join('\n');
}

/* Write the rule into a document — this one, or the audience window we built.
   It goes last in <head> so it beats the stylesheet's own #s-screen block on
   order rather than needing to out-specify it. */
function apply(doc) {
  const d = doc || document;
  try {
    let el = d.getElementById('qa-brand');
    if (!el) {
      el = d.createElement('style');
      el.id = 'qa-brand';
      (d.head || d.documentElement).appendChild(el);
    }
    el.textContent = css();
    paintMark(d);
  } catch (e) {}
}

/* ------------------------------------------------------------------ mark */
function markHTML(big) {
  if (!B.logo && !B.mark) return '';
  return '<div class="stage-mark' + (big ? ' big' : '') + '">' +
    (B.logo ? '<img src="' + esc(B.logo) + '" alt="">' : '') +
    (B.mark ? '<span>' + esc(B.mark) + '</span>' : '') + '</div>';
}
function paintMark(doc) {
  const d = doc || document;
  try {
    const slot = d.getElementById('screen-brand');
    if (slot) {
      slot.innerHTML = markHTML(false);
      /* The board sizes itself against what is left of the wall, and the bar
         above it is whatever height the mark was set to — so the height is
         measured and handed to the stylesheet. CSS cannot ask how tall
         something is, and guessing it from the scale would be wrong the moment
         there is wording but no logo, or the other way round. */
      d.documentElement.style.setProperty('--brand-h', slot.offsetHeight + 'px');
    }
    const bar = d.getElementById('show-brand');
    if (bar) bar.innerHTML = markHTML(false);
  } catch (e) {}
}

/* ------------------------------------------------------------------ logo
   The builder's image shrinker flattens onto white, which is right for a
   photograph in a question and exactly wrong for a logo: the transparency is
   the thing that lets a mark sit on a dark stage. So logos take their own
   path — PNG on a transparent canvas, and an SVG passed straight through
   because it is already small and scales better than anything we could
   produce from it. */
const LOGO_BUDGET = 220 * 1024;   /* it lives in this browser, never on a wire */
const LOGO_EDGE = 640;

function shrinkLogo(src, type) {
  if (/^image\/svg/.test(type || '') || /^data:image\/svg/.test(src)) {
    if (src.length <= LOGO_BUDGET) return Promise.resolve(src);
    return Promise.reject(new Error('That SVG is very large — try a simpler export'));
  }
  return Q.loadImage(src).then(img => {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('That image has no size');
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d');
    let scale = Math.min(1, LOGO_EDGE / Math.max(w0, h0));
    const draw = sc => {
      cv.width = Math.max(1, Math.round(w0 * sc));
      cv.height = Math.max(1, Math.round(h0 * sc));
      cx.clearRect(0, 0, cv.width, cv.height);       /* keep the alpha */
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    };
    let out = draw(scale);
    while (out.length > LOGO_BUDGET && scale > 0.15) { scale *= 0.75; out = draw(scale); }
    if (out.length > LOGO_BUDGET) throw new Error('That image is too detailed — try a PNG of the logo on its own');
    return out;
  });
}

/* The accent belongs to the whole app, not only the stage, so the host's
   window and the room's are plainly the same piece of software. Applying it
   here means that is true from the first paint, whether or not anyone ever
   opens the big screen. */
load();
apply();

Q.Brand = {
  THEMES: THEMES,
  load: load, save: save, set: set, apply: apply, css: css,
  markHTML: markHTML, shrinkLogo: shrinkLogo,
  get: () => B,
  theme: theme,
  /* the two colours in force, for the pickers to open on */
  accentHex: () => hex(accent()),
  groundHex: () => hex(ground()),
  size: size, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX
};
})();
