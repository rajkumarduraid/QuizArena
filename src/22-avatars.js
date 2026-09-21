/* ============================================================================
   Quiz Arena — hero roster

   Thirty original masked characters, drawn as busts on a 64-unit grid so they
   hold up at 96px in the picker and still read as distinct silhouettes at
   24px in a leaderboard row. Everything is vector: no image files, identical
   on every machine, and it costs the page nothing to load.

   These are built from superhero vocabulary — cowls, visors, helms, hoods,
   capes, chest emblems — not from any existing publisher's characters.
   Silhouette and colour do the work at small sizes; the detail rewards the
   picker, where they are shown large.
   ========================================================================= */
(function () {
'use strict';
const Q = window.QA;

/* Suit palettes: [primary, accent, deep shade for the backdrop] */
const SUITS = [
  ['#2B36C9', '#FFC53D', '#1A2183'], ['#B8123C', '#FFD8DE', '#7A0A28'],
  ['#0E7C5A', '#B9F5D8', '#075039'], ['#4A1E9E', '#00E0C0', '#2E1166'],
  ['#0B4F87', '#5FD0FF', '#062F52'], ['#C2410C', '#FFD9A8', '#7C2708'],
  ['#1F2937', '#F5C542', '#0D1218'], ['#7A0F52', '#FF9CD6', '#4C0733'],
  ['#0F766E', '#A7F3D0', '#0A4A45'], ['#B45309', '#FDE68A', '#733503'],
  ['#312E81', '#C7D2FE', '#1E1B57'], ['#166534', '#BBF7D0', '#0D3D1F'],
  ['#9A1233', '#FCA5A5', '#5F0B20'], ['#0369A1', '#BAE6FD', '#02486B'],
  ['#5B21B6', '#DDD6FE', '#3A1478']
];
const SKIN = ['#F2C49B', '#D89B6C', '#A96B43', '#7A4A2B', '#EBD2BE'];

/* mix a hex toward black or white — the tile is a pale wash of the suit's own
   hue, so each character keeps its colour identity while the figure, which is
   dark and saturated, is the only thing with weight on the tile */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const to = amt < 0 ? 0 : 255, k = Math.abs(amt);
  const ch = i => {
    const v = (n >> (16 - i * 8)) & 255;
    return Math.round(v + (to - v) * k).toString(16).padStart(2, '0');
  };
  return '#' + ch(0) + ch(1) + ch(2);
}

/* ------------------------------------------------------- chest insignia */
const EMBLEM = {
  bolt:    '<path d="M34 49 26 60h5l-1 6 8-11h-5l1-6Z"/>',
  star:    '<path d="m32 50 2.4 5 5.6.7-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.7Z"/>',
  diamond: '<path d="m32 49 6 7-6 7-6-7Z"/>',
  ring:    '<path d="M32 49a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/>',
  chevron: '<path d="m32 49 8 8-2.6 2.6L32 54.2l-5.4 5.4L24 57Z"/>',
  drop:    '<path d="M32 48c4 5 6.4 7.6 6.4 10.6a6.4 6.4 0 0 1-12.8 0C25.6 55.6 28 53 32 48Z"/>',
  cross:   '<path d="M29.6 49h4.8v4.4H39v4.8h-4.6V63h-4.8v-4.8H25v-4.8h4.6Z"/>',
  eye:     '<path d="M32 51c5 0 8.6 4.4 8.6 4.4S37 60 32 60s-8.6-4.6-8.6-4.6S27 51 32 51Zm0 2.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z"/>'
};

/* --------------------------------------------------------------- crests */
const CREST = {
  none:    '',
  earsBat: '<path d="M17.4 18.6 14 3.4l9.6 9.6Zm29.2 0L50 3.4l-9.6 9.6Z"/>',
  hornsUp: '<path d="M17.6 16.6c-3.6-3-5.2-7-4.8-11.8 4.4 2 7.4 5 9 9Zm28.8 0c3.6-3 5.2-7 4.8-11.8-4.4 2-7.4 5-9 9Z"/>',
  fin:     '<path d="M32 4c5 4 7.6 9 8 15.4H24C24.4 13 27 8 32 4Z"/>',
  crown:   '<path d="M14 20 12 6l8 6 4-8 4 8 8-6-2 14Z" transform="translate(6)"/>',
  antenna: '<path d="M22 14 17 5" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
           '<path d="M42 14 47 5" stroke-width="2.6" stroke-linecap="round" fill="none"/>' +
           '<circle cx="16.4" cy="4" r="3"/><circle cx="47.6" cy="4" r="3"/>',
  wings:   '<path d="M17.8 17.6 4 12.6l13.4-1.6ZM46.2 17.6 60 12.6l-13.4-1.6Z"/>',
  spikes:  '<path d="M20 15.6 18.6 7l5.4 6.2L27 5l3 8 2-7.4 2 7.4 3-8 3 8.2 5.4-6.2L44 15.6Z"/>',
  plume:   '<path d="M32 3c-1.6 6 .6 8.4 2.6 11.4 1 1.4 1.8 2.8 2.2 4.4h-11c1-4.6 4-8.4 6.2-15.8Z"/>'
};

/* ---------------------------------------------------------------- masks
   Each returns the mask over an already-drawn head, in suit colours.       */
const MASK = {
  /* full cowl: skull and cheeks covered, jaw exposed */
  cowl: (c1, c2) =>
    '<path d="M32 11.6c-9.8 0-15.8 6.8-15.8 17.2v4.6h31.6v-4.6c0-10.4-6-17.2-15.8-17.2Z" fill="' + c1 + '"/>' +
    '<path d="M16.2 33.2h6v9.4a17.4 17.4 0 0 1-6-7.4Zm25.6 0h6v2a17.4 17.4 0 0 1-6 7.4Z" fill="' + c1 + '"/>',
  /* smooth full-face mask, only lenses break it */
  full: (c1, c2) =>
    '<path d="M32 11.4c-9.6 0-15.2 7-15.2 17.4S22.4 47 32 47s15.2-7.8 15.2-18.2S41.6 11.4 32 11.4Z" fill="' + c1 + '"/>' +
    '<path d="M22 20.6c2.6-3.4 6-5.2 10-5.2s7.4 1.8 10 5.2c-3-1.8-6.4-2.7-10-2.7s-7 .9-10 2.7Z" fill="#fff" opacity=".16"/>',
  /* domino: a narrow band across the eyes */
  domino: (c1, c2) =>
    '<path d="M16.8 24.2c4.4-2.2 9.4-3.2 15.2-3.2s10.8 1 15.2 3.2c-.6 4.6-2 7.4-4.4 8.4-2.6 1-5.6-.2-9-3.4h-3.6c-3.4 3.2-6.4 4.4-9 3.4-2.4-1-3.8-3.8-4.4-8.4Z" fill="' + c1 + '"/>',
  /* engineered helm with an open faceplate */
  helm: (c1, c2) =>
    '<path d="M32 10c-9.6 0-15.6 6.6-15.6 16.6 0 4 .7 7.4 1.9 10.2l3.9-1.6V26.4h19.6v8.8l3.9 1.6c1.2-2.8 1.9-6.2 1.9-10.2C47.6 16.6 41.6 10 32 10Z" fill="' + c1 + '"/>' +
    '<path d="M20.2 24.6h23.6v3.4H20.2Z" fill="' + c2 + '"/>' +
    '<path d="M30.4 34.6h3.2v10h-3.2Z" fill="' + c1 + '"/>',
  /* wraparound visor band */
  visor: (c1, c2) =>
    '<path d="M32 11.4c-8.6 0-14.2 5.6-14.2 14v2.2h28.4v-2.2c0-8.4-5.6-14-14.2-14Z" fill="' + c1 + '"/>' +
    '<path d="M16.6 25.8h30.8v7.6H16.6Z" fill="' + c1 + '"/>',
  /* drawn hood with the face in shadow */
  hood: (c1, c2) =>
    '<path d="M32 8c-11 0-17.4 8.2-17.4 20 0 6.4 1.8 12 4.8 15.8l4.6-3c-2-3-3.2-7.2-3.2-12 0-8.6 4.4-14.2 11.2-14.2s11.2 5.6 11.2 14.2c0 4.8-1.2 9-3.2 12l4.6 3c3-3.8 4.8-9.4 4.8-15.8C49.4 16.2 43 8 32 8Z" fill="' + c1 + '"/>' +
    '<path d="M20.6 22c2.6-4.4 6.4-6.6 11.4-6.6s8.8 2.2 11.4 6.6c-1 6-4.8 9-11.4 9s-10.4-3-11.4-9Z" fill="#000" opacity=".42"/>',
  /* bandana across the lower face */
  lower: (c1, c2) =>
    '<path d="M18.8 31.6c4 2.4 8.4 3.6 13.2 3.6s9.2-1.2 13.2-3.6c-.6 7.8-5 12.6-13.2 12.6s-12.6-4.8-13.2-12.6Z" fill="' + c1 + '"/>' +
    '<path d="M18.8 31.6h26.4v3H18.8Z" fill="' + c2 + '"/>',
  /* forehead circlet, face bare */
  circlet: (c1, c2) =>
    '<path d="M18.4 22.2h27.2v4.4H18.4Z" fill="' + c1 + '"/>' +
    '<path d="m32 17.4 3.6 5.6h-7.2Z" fill="' + c2 + '"/>'
};


/* Domino, bandana and circlet leave the skull bare, so those characters get
   hair — without it they all read as the same bald head. */
const HAIR = [
  '<path d="M32 12.4c-8.6 0-14.2 5.4-14.4 13.8 1.8-4.8 4.6-7.4 9-8 4-.6 8.8-.6 12.8 0 3.8.6 6.2 3.2 7 8-.2-8.4-5.8-13.8-14.4-13.8Z"/>',
  '<path d="M17.6 26.4c-.6-9 4.8-14.4 14.4-14.4 6.8 0 11.4 2.6 13.6 7.6-3.6-1.8-7.6-2.4-12-1.8-6.8 1-11.2 4.2-16 8.6Z"/>',
  '<path d="M32 12.2c-9 0-14.4 5.6-14.4 15l3.6-1.6c.4-4.4 1.4-6.8 3.4-7.6 2.4 2.4 5.8 3.6 10.4 3.6 3.6 0 6.2-.9 7.6-2.6 1.8 1.1 2.9 3.4 3.2 6.6l3.6 1.6c0-9.4-5.4-15-14.4-15Z"/>',
  '<path d="M32 11.8c-9.2 0-14.6 5.8-14.4 15.4l3.4-2c.6-3.8 1.8-6.2 3.6-7.2-.4 3 .4 5 2.4 6 1.4-2.4 3.4-3.8 6-4.2-.6 2.2 0 3.8 1.6 4.8 1.2-2 3-3.2 5.4-3.6-.4 1.8.2 3.2 1.6 4.2l4.8 2c.2-9.6-5.2-15.4-14.4-15.4Z"/>'
];
const HAIR_COL = ['#2A2018', '#4A3324', '#191423', '#6A4526', '#3B2A46'];
const BARE_SKULL = { domino: 1, lower: 1, circlet: 1 };

/* ----------------------------------------------------------------- eyes */
const EYES = {
  lens:   c => '<g fill="#fff"><path d="M21.4 27.4c2.6-1.6 5-1.8 7.2-.6l-1 4.6c-2.6.8-4.8.2-6.6-1.8Zm21.2 0c-2.6-1.6-5-1.8-7.2-.6l1 4.6c2.6.8 4.8.2 6.6-1.8Z"/></g>' +
               '<g fill="' + c + '" opacity=".45"><path d="M22.2 28.4c1.8-1 3.4-1.2 4.8-.6l-.6 2.8c-1.8.4-3.2 0-4.2-1.2Zm19.6 0c-1.8-1-3.4-1.2-4.8-.6l.6 2.8c1.8.4 3.2 0 4.2-1.2Z"/></g>',
  slit:   c => '<path d="M20.4 26 30.2 28.6l-1 3.8-9.4-2.6Zm23.2 0L33.8 28.6l1 3.8 9.4-2.6Z" fill="#fff" opacity=".92"/>' +
               '<path d="M21.6 27.4 29 29.4l-.5 1.9-7.2-2Zm20.8 0L35 29.4l.5 1.9 7.2-2Z" fill="' + c + '"/>',
  glow:   c => '<circle cx="25.4" cy="29" r="6.4" fill="' + c + '" opacity=".3"/><circle cx="38.6" cy="29" r="6.4" fill="' + c + '" opacity=".3"/>' +
               '<circle cx="25.4" cy="29" r="3.8" fill="#fff"/><circle cx="38.6" cy="29" r="3.8" fill="#fff"/>' +
               '<circle cx="25.4" cy="29" r="1.7" fill="' + c + '"/><circle cx="38.6" cy="29" r="1.7" fill="' + c + '"/>',
  goggle: c => '<circle cx="25" cy="29" r="5.4" fill="' + c + '"/><circle cx="39" cy="29" r="5.4" fill="' + c + '"/>' +
               '<circle cx="25" cy="29" r="2.4" fill="#0B1020" opacity=".55"/><circle cx="39" cy="29" r="2.4" fill="#0B1020" opacity=".55"/>' +
               '<path d="M30.4 28.4h3.2v2h-3.2Z" fill="' + c + '"/>',
  band:   c => '<path d="M18.4 26.4h27.2v5.6H18.4Z" fill="' + c + '"/>' +
               '<path d="M20 27.6h9.4v1.6H20Z" fill="#fff" opacity=".45"/>',
  bare:   () => '<ellipse cx="25.6" cy="29" rx="2.1" ry="2.5" fill="#1A1526"/>' +
                '<ellipse cx="38.4" cy="29" rx="2.1" ry="2.5" fill="#1A1526"/>',
  cyclo:  c => '<path d="M17.6 27.2h28.8v5.2c-4.6 1.6-9.4 2.4-14.4 2.4s-9.8-.8-14.4-2.4Z" fill="' + c + '"/>' +
               '<path d="M19.6 28.4h11v1.4h-11Z" fill="#fff" opacity=".5"/>'
};

/* -------------------------------------------------------------- roster */
/* [name, suit, skin, crest, mask, eyes, emblem, cape] */
const ROSTER = [
  ['Bulwark', 0, 0, 'none', 'cowl', 'lens', 'chevron', 1],
  ['Sunspire', 9, 4, 'crown', 'domino', 'glow', 'star', 1],
  ['Nightwarden', 6, 0, 'earsBat', 'cowl', 'slit', 'eye', 1],
  ['Emberfall', 5, 1, 'fin', 'full', 'glow', 'drop', 0],
  ['Tidecaller', 4, 4, 'wings', 'domino', 'lens', 'drop', 1],
  ['Voltaic', 0, 2, 'antenna', 'helm', 'band', 'bolt', 0],
  ['Grimveil', 6, 3, 'hornsUp', 'hood', 'glow', 'cross', 1],
  ['Lumen', 10, 4, 'plume', 'circlet', 'bare', 'ring', 1],
  ['Stormforge', 13, 1, 'spikes', 'helm', 'cyclo', 'bolt', 0],
  ['Cinder', 12, 2, 'fin', 'lower', 'slit', 'drop', 0],
  ['Halcyon', 8, 4, 'wings', 'circlet', 'bare', 'star', 1],
  ['Ironvow', 10, 0, 'none', 'helm', 'band', 'ring', 0],
  ['Duskrunner', 3, 3, 'none', 'lower', 'goggle', 'chevron', 0],
  ['Prism', 14, 4, 'crown', 'full', 'glow', 'diamond', 1],
  ['Aegis', 1, 1, 'none', 'cowl', 'lens', 'cross', 1],
  ['Vantage', 4, 0, 'antenna', 'visor', 'cyclo', 'eye', 0],
  ['Torrent', 8, 2, 'fin', 'domino', 'lens', 'drop', 1],
  ['Obsidian', 6, 3, 'spikes', 'full', 'slit', 'diamond', 0],
  ['Skyward', 13, 4, 'wings', 'domino', 'bare', 'star', 1],
  ['Rampart', 11, 1, 'none', 'helm', 'band', 'chevron', 0],
  ['Kestrel', 9, 0, 'plume', 'cowl', 'lens', 'chevron', 1],
  ['Zephyra', 2, 4, 'wings', 'circlet', 'bare', 'ring', 1],
  ['Molten', 5, 2, 'hornsUp', 'full', 'glow', 'drop', 0],
  ['Frostpeak', 4, 4, 'crown', 'visor', 'band', 'diamond', 1],
  ['Nocturne', 3, 3, 'earsBat', 'hood', 'slit', 'eye', 1],
  ['Radiant', 9, 1, 'plume', 'domino', 'glow', 'star', 1],
  ['Thorn', 11, 2, 'spikes', 'lower', 'goggle', 'cross', 0],
  ['Vertex', 7, 4, 'antenna', 'helm', 'cyclo', 'diamond', 0],
  ['Umbra', 6, 3, 'hornsUp', 'hood', 'glow', 'ring', 1],
  ['Pulsar', 3, 0, 'none', 'visor', 'band', 'bolt', 1]
];
const AV_COUNT = ROSTER.length;

/* -------------------------------------------------------------- render */
function drawnAvatar(i, cls) {
  const a = ROSTER[safeIndex(i, AV_COUNT)];
  const [name, suitI, skinI, crest, mask, eyes, emblem, cape] = a;
  const [c1, c2, c3] = SUITS[suitI];
  const skin = SKIN[skinI];
  const uid = 'a' + i + '-' + Math.random().toString(36).slice(2, 6);
  const field = shade(c1, 0.80);           /* pale wash of the suit's own hue */
  const fieldTop = shade(c1, 0.91);

  /* The bust is drawn large in the frame: at 24px only the silhouette and the
     two brightest shapes survive, so the head has to own the tile. */
  const facePlate =
    '<ellipse cx="32" cy="28" rx="15.6" ry="17.4" fill="' + skin + '" ' +
      'stroke="' + shade(skin, -0.34) + '" stroke-width="0.7" stroke-opacity=".55"/>' +
    '<path d="M24.6 42h14.8v7.4H24.6Z" fill="' + skin + '"/>' +
    '<path d="M24.6 42h14.8v3.4a21 21 0 0 1-14.8 0Z" fill="#000" opacity=".15"/>';

  return '<svg class="av ' + (cls || '') + '" viewBox="0 0 64 64" role="img" aria-label="' + name + '">' +
    '<defs>' +
      '<linearGradient id="g' + uid + '" x1="0" y1="0" x2="0.4" y2="1">' +
        '<stop offset="0" stop-color="' + fieldTop + '"/><stop offset="1" stop-color="' + field + '"/></linearGradient>' +
      '<clipPath id="c' + uid + '"><rect width="64" height="64" rx="15"/></clipPath>' +
    '</defs>' +
    '<g clip-path="url(#c' + uid + ')">' +
      '<rect width="64" height="64" fill="url(#g' + uid + ')"/>' +
      (cape ? '<path d="M5 64c1-15 9-24 27-24s26 9 27 24Z" fill="' + shade(c1, -0.34) + '"/>' : '') +
      '<path d="M11 64c1.8-12.6 10.4-19.6 21-19.6S51.2 51.4 53 64Z" fill="' + c1 + '"/>' +
      '<path d="M23.4 46.2 32 57l8.6-10.8a22 22 0 0 0-17.2 0Z" fill="' + c2 + '"/>' +
      '<g fill="' + c2 + '">' + EMBLEM[emblem] + '</g>' +
      facePlate +
      (BARE_SKULL[mask]
        ? '<g fill="' + HAIR_COL[(i * 3 + skinI) % HAIR_COL.length] + '">' + HAIR[(i * 5) % HAIR.length] + '</g>'
        : '') +
      MASK[mask](c1, c2) +
      '<g fill="' + c1 + '">' + CREST[crest] + '</g>' +
      '<g fill="#000" opacity=".14">' + CREST[crest] + '</g>' +
      EYES[eyes](c2) +
      /* a rim of light down one side so the head reads as a form, not a sticker */
      '<path d="M32 10.4c-10 0-16.2 7.2-16.2 18h3.4c0-8.8 5.2-14.6 12.8-14.6Z" fill="#fff" opacity=".14"/>' +
    '</g></svg>';
}

/* ==========================================================================
   Custom packs

   The drawn roster is the default, but a host can supply their own pictures
   instead: drop images plus a manifest into an `avatars/` folder next to the
   page and they replace the built-in cast. Only the chosen index travels
   between devices — every device loads the pictures from the same origin, so
   nothing large goes over the wire and nothing is embedded in the page.
   ======================================================================== */
let PACK = null;
const packSize = () => (PACK ? PACK.length : AV_COUNT);
/* An avatar index arrives from another device, so it can be missing or
   nonsense. One bad row must never take down the board it appears on. */
const safeIndex = (i, n) => {
  const v = Number(i);
  return Number.isFinite(v) ? ((Math.trunc(v) % n) + n) % n : 0;
};
const wrap = i => safeIndex(i, packSize());

function avatarCount() { return packSize(); }
function avatarName(i) {
  if (PACK) return PACK[wrap(i)].name || ('Avatar ' + (wrap(i) + 1));
  return ROSTER[wrap(i)][0];
}
function avatarHTML(i, cls) {
  if (!PACK) return drawnAvatar(i, cls);
  const it = PACK[wrap(i)];
  return '<img class="av ' + (cls || '') + '" src="' + Q.esc(it.src) + '" ' +
         'alt="' + Q.esc(it.name || '') + '" loading="lazy" decoding="async">';
}
const randomAvatar = () => Math.floor(Math.random() * packSize());

/* Resolves once we know whether a pack exists; never rejects, because a
   missing folder is the normal case. */
const packReady = (function () {
  if (!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return Promise.resolve(false);
  const dir = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1) + 'avatars/';
  return fetch(dir + 'manifest.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const list = j && Array.isArray(j.avatars) ? j.avatars : null;
      if (!list || !list.length) return false;
      PACK = list.slice(0, 60)
        .filter(x => x && typeof x.src === 'string' && !/^\s*(javascript|data):/i.test(x.src))
        .map(x => ({ name: String(x.name || '').slice(0, 40), src: dir + x.src.replace(/^\.?\//, '') }));
      if (!PACK.length) { PACK = null; return false; }
      return true;
    })
    .catch(() => false);
})();

Q.avatarSVG = avatarHTML;
Q.avatarCount = avatarCount;
Q.avatarName = avatarName;
Q.avatarPackReady = packReady;
Q.avatarPackActive = () => !!PACK;
Q.randomAvatar = randomAvatar;
})();
