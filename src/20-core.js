/* ============================================================================
   Quiz Arena — core: helpers, storage, sound, confetti, transport
   ========================================================================= */
(function () {
'use strict';

/* ---------------------------------------------------------------- helpers */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const uid = (n) => {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let o = '';
  const buf = new Uint32Array(n || 10);
  crypto.getRandomValues(buf);
  for (let i = 0; i < (n || 10); i++) o += c[buf[i] % c.length];
  return o;
};
/* No 0/O/1/I/L — codes get read aloud and typed on phones. */
const roomCode = () => {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let o = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) o += c[buf[i] % c.length];
  return o;
};
const secs = ms => (ms / 1000).toFixed(2) + 's';
const mmss = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const nf = n => Math.round(n).toLocaleString('en-US');
const now = () => Date.now();

/* The answer shapes are drawn, not typed: a font-dependent ▲ renders at a
   different weight and baseline on every machine, and these sit next to each
   other constantly. */
const SHAPE_PATHS = [
  'M12 3 22 20.5H2Z',                                   /* triangle */
  'M12 2 22 12 12 22 2 12Z',                            /* diamond  */
  'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0',     /* circle   */
  'M3.2 3.2h17.6v17.6H3.2Z',                            /* square   */
  'M12 2.2 22 9.5l-3.8 11.8H5.8L2 9.5Z',                /* pentagon */
  'M12 2.2 20.5 7v10L12 21.8 3.5 17V7Z'                 /* hexagon  */
];
const shape = (i, cls) =>
  '<svg class="shp ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="' + SHAPE_PATHS[i % 6] + '" fill="currentColor"/></svg>';

const ACOLORS = ['var(--a1)', 'var(--a2)', 'var(--a3)', 'var(--a4)', 'var(--a5)', 'var(--a6)'];
const AHEX    = ['#D62650', '#1B5BDB', '#B96A00', '#0B8C5E', '#6E38CE', '#0A7594'];
const TEAM_PALETTE = ['#D62650', '#1B5BDB', '#B96A00', '#0B8C5E', '#6E38CE', '#0A7594', '#C2410C', '#0F766E'];

/* Icons come from the sprite; `ico` is used in template strings everywhere. */
const ico = (name, cls) =>
  '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';

/* The mark: a Q whose tail is the answer triangle. Its colours are read from
   the theme rather than written in, so a rebranded app is not left with the
   app's own purple sitting in the corner of somebody else's palette. */
function markSVG(px) {
  const id = 'qm' + Math.random().toString(36).slice(2, 7);
  return '<svg class="mark" viewBox="0 0 32 32" role="img" aria-label="Quiz Arena"' +
    (px ? ' style="font-size:' + px + 'px"' : '') + '>' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="var(--brand-fill-2,#6D4BFF)"/>' +
    '<stop offset="1" stop-color="var(--brand-fill,#3A22C4)"/></linearGradient></defs>' +
    '<circle cx="14.6" cy="14.6" r="10" fill="none" stroke="url(#' + id + ')" stroke-width="4.7"/>' +
    '<path d="M20.2 20.2 29 25.3l-5.6 3.6Z" fill="var(--gold,#E39400)"/></svg>';
}

/* ------------------------------------------------------------------ toast */
let toastSeq = 0;
function toast(msg, kind, ms) {
  const host = $('#toasts');
  if (!host) return;
  const d = document.createElement('div');
  d.className = 'toast' + (kind ? ' ' + kind : '');
  const mark = kind === 'ok' ? 'check-circle' : kind === 'bad' ? 'alert' : 'sparkle';
  d.innerHTML = ico(mark) + '<span></span>';
  d.lastChild.textContent = msg;
  host.appendChild(d);
  const id = ++toastSeq;
  setTimeout(() => {
    d.style.transition = 'opacity .25s, transform .25s';
    d.style.opacity = '0';
    d.style.transform = 'translateY(8px)';
    setTimeout(() => d.remove(), 260);
  }, ms || 2600);
  return id;
}

/* ------------------------------------------------------------------ modal */
function modal(html, onMount) {
  const bg = $('#modal-bg'), box = $('#modal');
  box.innerHTML = html;
  bg.classList.add('on');
  const close = () => { bg.classList.remove('on'); box.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.onclick = e => { if (e.target === bg) close(); };
  $$('[data-close]', box).forEach(b => b.onclick = close);
  if (onMount) onMount(box, close);
  const first = box.querySelector('input,select,textarea,button');
  if (first) setTimeout(() => first.focus(), 40);
  return close;
}

/* ---------------------------------------------------------------- storage */
const LS = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const SS = {
  get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ------------------------------------------------------------------ sound
   Every sound here is synthesised on the spot — no files to load, nothing to
   fetch, which is the only way it works from a downloaded page on a locked-down
   laptop. What makes the difference between an instrument and a beep is not the
   waveform, it is everything around it:

     · an envelope with a few milliseconds of attack, so no note begins with a
       click, and a curve down rather than a gate at the end
     · a lowpass that closes as the note dies, the way a struck object loses
       its brightness before it loses its volume
     · partials — a real bell is a fundamental with a couple of quieter
       harmonics over it, not one sine wave
     · a short room on a send, so nothing lands flat against a hard wall
     · a limiter across the end, so two sounds landing together never clip

   Pitches come from one scale, so anything that overlaps still agrees. */
const Sound = (function () {
  let ctx = null, on = true, vol = 1;
  let master = null, wet = null, hiss = null;

  /* C major, which is where everything in here sits */
  const N = {
    C2: 65.41, G2: 98.00, C3: 130.81, E3: 164.81, F3: 174.61, G3: 196.00,
    A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00,
    C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00,
    C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1568.00, C7: 2093.00
  };

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
      build(ctx);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function build(c) {
    /* the limiter is the reason a chord and a whoosh can land on the same
       beat without the projector's speakers spitting */
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 22; lim.ratio.value = 6;
    lim.attack.value = 0.003; lim.release.value = 0.18;
    lim.connect(c.destination);

    master = c.createGain();
    master.gain.value = 0.9;
    master.connect(lim);

    /* a small, dry-ish room: long enough to sound like somewhere, short
       enough that a run of ticks does not turn to mush */
    const rev = c.createConvolver();
    rev.buffer = impulse(c, 1.1, 3.4);
    const tame = c.createBiquadFilter();       /* keep the tail off the top end */
    tame.type = 'lowpass'; tame.frequency.value = 3600;
    wet = c.createGain(); wet.gain.value = 0.9;
    wet.connect(tame); tame.connect(rev); rev.connect(master);

    /* one noise buffer, reused — generating two seconds of random numbers per
       tick would be the most expensive thing on the page */
    hiss = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const d = hiss.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function impulse(c, secs, decay) {
    const n = Math.floor(c.sampleRate * secs);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  const lvl = g => Math.max(0.00012, g * vol);

  /* One note: oscillator → closing lowpass → envelope → out, with a send. */
  function tone(o) {
    const c = ensure(); if (!c || !on) return;
    const t = c.currentTime + (o.at || 0);
    const dur = o.dur || 0.3;
    const peak = lvl(o.gain == null ? 0.1 : o.gain);
    if (peak < 0.0002) return;

    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur * (o.bend || 1));
    if (o.detune) osc.detune.value = o.detune;

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = o.q == null ? 0.7 : o.q;
    lp.frequency.setValueAtTime(Math.min(16000, o.open || o.f * 7), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(160, o.close || o.f * 1.5), t + dur);

    const g = c.createGain();
    const atk = o.atk == null ? 0.007 : o.atk;
    g.gain.setValueAtTime(0.00012, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    if (o.hold) g.gain.setValueAtTime(peak, t + atk + o.hold);
    g.gain.exponentialRampToValueAtTime(0.00012, t + dur);

    osc.connect(lp); lp.connect(g); g.connect(master);
    send(c, g, o.send == null ? 0.22 : o.send);
    osc.start(t); osc.stop(t + dur + 0.06);
  }

  /* A struck thing: the note, an octave over it, and a thin twelfth above
     that, each quieter and shorter than the last. */
  function bell(f, o) {
    o = o || {};
    const dur = o.dur || 0.6, g = o.gain == null ? 0.1 : o.gain;
    tone({ f: f, dur: dur, gain: g, at: o.at, type: 'sine',
           open: f * 4, close: f * 1.2, send: o.send });
    tone({ f: f * 2, dur: dur * 0.62, gain: g * 0.4, at: o.at, type: 'sine',
           open: f * 7, close: f * 2, send: o.send });
    tone({ f: f * 3.01, dur: dur * 0.34, gain: g * 0.17, at: o.at, type: 'triangle',
           open: f * 9, close: f * 3, send: o.send });
  }

  /* Air: filtered noise, for whooshes, clicks and anything with a transient. */
  function air(o) {
    const c = ensure(); if (!c || !on || !hiss) return;
    const t = c.currentTime + (o.at || 0);
    const dur = o.dur || 0.2;
    const peak = lvl(o.gain == null ? 0.06 : o.gain);
    if (peak < 0.0002) return;

    const src = c.createBufferSource();
    src.buffer = hiss; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q == null ? 1.1 : o.q;
    f.frequency.setValueAtTime(o.f || 900, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur * (o.bend || 1));

    const g = c.createGain();
    const atk = o.atk == null ? 0.02 : o.atk;
    g.gain.setValueAtTime(0.00012, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    if (o.hold) g.gain.setValueAtTime(peak, t + atk + o.hold);
    g.gain.exponentialRampToValueAtTime(0.00012, t + dur);

    src.connect(f); f.connect(g); g.connect(master);
    send(c, g, o.send == null ? 0.18 : o.send);
    src.start(t); src.stop(t + dur + 0.06);
  }

  function send(c, from, amt) {
    if (!wet || !amt) return;
    const s = c.createGain(); s.gain.value = amt;
    from.connect(s); s.connect(wet);
  }

  /* several notes, one after another */
  function run(freqs, step, o) {
    o = o || {};
    freqs.forEach((f, i) => bell(f, {
      at: (o.at || 0) + i * step,
      dur: o.dur || 0.5,
      gain: (o.gain == null ? 0.1 : o.gain) * (o.fade ? 1 - i * 0.1 : 1),
      send: o.send
    }));
  }

  return {
    set enabled(v) { on = !!v; },
    get enabled() { return on; },
    /* 0 to 1.4 — a projector in a hard room wants less than a laptop does */
    set volume(v) { vol = Math.max(0, Math.min(1.4, Number(v) || 0)); },
    get volume() { return vol; },
    unlock() { ensure(); },

    /* ---- the scored game ---- */
    tick() {
      air({ f: 2600, to: 1500, dur: 0.035, gain: 0.05, q: 2.4, atk: 0.001, send: 0.05 });
      tone({ f: N.C6, dur: 0.05, gain: 0.03, type: 'sine', atk: 0.002, send: 0.05 });
    },
    urgent() {
      air({ f: 3400, to: 1900, dur: 0.045, gain: 0.085, q: 2.6, atk: 0.001, send: 0.08 });
      tone({ f: N.E6, dur: 0.07, gain: 0.06, type: 'sine', atk: 0.002, send: 0.08 });
    },
    start() {
      air({ f: 500, to: 3200, dur: 0.34, gain: 0.05, q: 0.7, atk: 0.16 });
      run([N.C5, N.E5, N.G5], 0.1, { dur: 0.55, gain: 0.1 });
      tone({ f: N.C3, dur: 0.7, gain: 0.07, type: 'triangle', at: 0.2, open: 700 });
    },
    right() {
      run([N.G5, N.C6], 0.085, { dur: 0.62, gain: 0.1 });
      tone({ f: N.C4, dur: 0.5, gain: 0.05, type: 'triangle', open: 900 });
    },
    /* not a buzzer — a short fall that gets out of the way */
    wrong() {
      tone({ f: N.A3, to: N.F3, dur: 0.3, gain: 0.075, type: 'triangle', open: 800, close: 280 });
      tone({ f: N.A3 / 2, dur: 0.34, gain: 0.05, type: 'sine', open: 420 });
    },
    times() {
      tone({ f: N.G3, to: N.C3, dur: 0.6, gain: 0.085, type: 'triangle', open: 900, close: 220 });
      air({ f: 1400, to: 300, dur: 0.5, gain: 0.05, q: 0.9, atk: 0.03 });
    },
    win() {
      run([N.C5, N.E5, N.G5, N.C6, N.E6], 0.11, { dur: 0.8, gain: 0.105 });
      /* the chord the run resolves into, held under it */
      [N.C4, N.E4, N.G4, N.C5].forEach(f =>
        tone({ f: f, dur: 1.9, gain: 0.045, type: 'triangle', at: 0.44,
               atk: 0.1, hold: 0.5, open: f * 4, close: f * 1.4, send: 0.4 }));
    },

    /* ---- the big screen ----
       A room hears these over a projector while somebody is talking, so they
       are shorter and softer than a game-show sting: enough to punctuate what
       just happened on the wall, never enough to talk over the presenter. */

    /* a number has been called */
    pick() {
      air({ f: 1800, to: 700, dur: 0.07, gain: 0.05, q: 1.6, atk: 0.002, send: 0.1 });
      bell(N.C5, { dur: 0.5, gain: 0.085 });
      bell(N.G5, { dur: 0.6, gain: 0.075, at: 0.075 });
    },
    /* the sweep passing a tile, or a wheel sector passing the pin */
    tock() {
      air({ f: 2200, to: 1100, dur: 0.028, gain: 0.055, q: 3.2, atk: 0.001, send: 0.06 });
      tone({ f: N.G5, dur: 0.045, gain: 0.028, type: 'sine', atk: 0.002, send: 0.06 });
    },
    /* the bed under a spin: a riser that tightens as it goes */
    spin(ms) {
      const d = Math.max(0.3, (ms || 1200) / 1000);
      air({ f: 300, to: 2400, dur: d, gain: 0.045, q: 1.4, atk: d * 0.6, send: 0.3 });
      tone({ f: N.C3, to: N.G3, dur: d, gain: 0.05, type: 'triangle',
             atk: d * 0.55, open: 500, close: 900, send: 0.25 });
    },
    /* the sweep stopping on a number */
    land() {
      tone({ f: N.C3, dur: 0.42, gain: 0.11, type: 'sine', atk: 0.004, open: 600, close: 120 });
      air({ f: 2600, to: 600, dur: 0.16, gain: 0.07, q: 1.2, atk: 0.002, send: 0.3 });
      bell(N.C5, { dur: 0.85, gain: 0.1, send: 0.42 });
      bell(N.E5, { dur: 0.8, gain: 0.07, at: 0.035, send: 0.42 });
      bell(N.G5, { dur: 0.95, gain: 0.06, at: 0.07, send: 0.42 });
    },
    /* a cover lifting off */
    lift() {
      air({ f: 700, to: 3000, dur: 0.17, gain: 0.05, q: 0.9, atk: 0.06, send: 0.28 });
      bell(N.E5, { dur: 0.34, gain: 0.05 });
    },
    /* the held breath before an answer is given */
    roll(ms) {
      const d = Math.max(0.2, (ms || 600) / 1000);
      tone({ f: N.C2, dur: d + 0.1, gain: 0.075, type: 'triangle',
             atk: d * 0.75, open: 260, close: 200, send: 0.2 });
      tone({ f: N.G2, dur: d + 0.08, gain: 0.05, type: 'sine', atk: d * 0.8, open: 300 });
      air({ f: 240, to: 1500, dur: d, gain: 0.05, q: 1.6, atk: d * 0.8, send: 0.3 });
    },
    /* the answer landing: an arpeggio that resolves and is then held */
    sting() {
      run([N.C5, N.E5, N.G5, N.C6], 0.062, { dur: 0.75, gain: 0.1, send: 0.35 });
      [N.C4, N.E4, N.G4].forEach(f =>
        tone({ f: f, dur: 1.5, gain: 0.04, type: 'triangle', at: 0.2,
               atk: 0.08, hold: 0.35, open: f * 4, close: f * 1.3, send: 0.45 }));
      air({ f: 3000, to: 900, dur: 0.3, gain: 0.03, q: 0.8, atk: 0.01, send: 0.4 });
    },
    /* nothing there — a shrug, not a failure */
    dud() {
      tone({ f: N.E3, to: N.C3, dur: 0.26, gain: 0.055, type: 'sine', open: 600, close: 200 });
    },
    /* moving between things */
    swish(ms) {
      const d = Math.max(0.12, (ms || 260) / 1000);
      air({ f: 420, to: 2800, dur: d, gain: 0.05, q: 0.75, atk: d * 0.42, send: 0.3 });
      tone({ f: N.G4, to: N.G5, dur: d * 0.8, gain: 0.025, type: 'sine',
             atk: d * 0.4, open: 3000, close: 1400, send: 0.3 });
    }
  };
})();

/* --------------------------------------------------------------- confetti */
const CONFETTI = ['#6D4BFF', '#E39400', '#0E8F62', '#D62650', '#1B5BDB', '#B03CC8'];
const Confetti = (function () {
  const cv = $('#confetti');
  let raf = 0, bits = [], stopAt = 0, ctx2 = null;
  function fit() { if (!cv) return; cv.width = innerWidth; cv.height = innerHeight; }
  addEventListener('resize', fit);
  function frame() {
    if (!ctx2) return;
    ctx2.clearRect(0, 0, cv.width, cv.height);
    bits = bits.filter(b => b.y < cv.height + 40);
    bits.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.vy += 0.14; b.r += b.vr;
      ctx2.save(); ctx2.translate(b.x, b.y); ctx2.rotate(b.r);
      ctx2.fillStyle = b.c; ctx2.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx2.restore();
    });
    if (bits.length || now() < stopAt) raf = requestAnimationFrame(frame);
    else { raf = 0; ctx2.clearRect(0, 0, cv.width, cv.height); }
  }
  return {
    fire(ms) {
      if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      ctx2 = ctx2 || cv.getContext('2d'); fit();
      stopAt = now() + (ms || 1600);
      const push = () => {
        for (let i = 0; i < 13; i++) {
          bits.push({
            x: Math.random() * cv.width, y: -20 - Math.random() * 120,
            vx: (Math.random() - .5) * 3.4, vy: 2 + Math.random() * 3.4,
            w: 6 + Math.random() * 7, h: 9 + Math.random() * 9,
            r: Math.random() * 6.28, vr: (Math.random() - .5) * .28,
            c: CONFETTI[(Math.random() * CONFETTI.length) | 0]
          });
        }
        if (now() < stopAt) setTimeout(push, 150);
      };
      push();
      if (!raf) raf = requestAnimationFrame(frame);
    }
  };
})();

/* ==========================================================================
   Transport
   Every message is host-authoritative: players send intents, the host
   answers with a full public snapshot. Two channels can run at once and
   duplicates are dropped by message id, so a dashboard tab on the host
   machine keeps working even when the room is running over the internet.
   ======================================================================== */
const PEER_PREFIX = 'quizarena-v1-';

function LocalBus(code, onMsg) {
  const name = 'quizarena:' + code;
  const key = 'qa:bus:' + code;
  let bc = null, seq = 0, alive = true;
  try { bc = new BroadcastChannel(name); } catch (e) { bc = null; }

  const deliver = m => { if (alive && m) onMsg(m); };
  if (bc) bc.onmessage = e => deliver(e.data);

  const onStorage = e => {
    if (e.key !== key || !e.newValue) return;
    try { deliver(JSON.parse(e.newValue)); } catch (err) {}
  };
  addEventListener('storage', onStorage);

  return {
    kind: 'local',
    send(m) {
      if (!alive) return;
      if (bc) { try { bc.postMessage(m); } catch (e) {} }
      /* localStorage mirror covers browsers/contexts where BroadcastChannel
         is unavailable (some file:// setups). Same message id, deduped. */
      try { localStorage.setItem(key, JSON.stringify(Object.assign({ _s: ++seq }, m))); } catch (e) {}
    },
    close() {
      alive = false;
      removeEventListener('storage', onStorage);
      if (bc) { try { bc.close(); } catch (e) {} }
    }
  };
}

/* Host side of the internet transport. */
function PeerHost(code, onMsg, onStatus) {
  let peer = null, conns = [], alive = true, retries = 0, opened = false, watchdog = 0;
  const id = PEER_PREFIX + code;

  function build() {
    if (!alive) return;
    if (typeof window.Peer !== 'function') { onStatus('error', 'WebRTC library missing'); return; }
    onStatus('connecting', 'Publishing room…');
    try { peer = new window.Peer(id, { debug: 0 }); }
    catch (e) { onStatus('error', 'Could not start'); return; }

    /* A blocked or blackholed signalling socket never errors — it just never
       opens. Say so rather than leaving the host staring at "publishing". */
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      if (alive && !opened) onStatus('error', 'Could not reach the connection service');
    }, 15000);

    peer.on('open', () => { opened = true; clearTimeout(watchdog); retries = 0; onStatus('online', 'Open to any device'); });
    peer.on('connection', c => {
      conns.push(c);
      c.on('data', d => { if (alive) onMsg(d, c); });
      c.on('close', () => { conns = conns.filter(x => x !== c); });
      c.on('error', () => { conns = conns.filter(x => x !== c); });
    });
    peer.on('error', err => {
      const type = err && err.type;
      if (type === 'unavailable-id') { onStatus('taken', 'Code already in use'); return; }
      if (type === 'peer-unavailable') return;            /* a player vanished */
      if (type === 'network' || type === 'server-error' || type === 'socket-error') {
        onStatus('retry', 'Reconnecting…');
        if (retries < 4 && alive) {
          const wait = 1200 * Math.pow(2, retries++);
          setTimeout(() => { try { peer.destroy(); } catch (e) {} build(); }, wait);
        } else onStatus('error', 'No connection');
        return;
      }
      onStatus('error', (err && err.message) || 'Connection problem');
    });
    peer.on('disconnected', () => {
      onStatus('retry', 'Reconnecting…');
      if (alive) { try { peer.reconnect(); } catch (e) {} }
    });
  }
  build();

  return {
    kind: 'peer',
    send(m) {
      const s = JSON.stringify(m);
      conns.forEach(c => { if (c.open) { try { c.send(s); } catch (e) {} } });
    },
    count() { return conns.filter(c => c.open).length; },
    close() { alive = false; clearTimeout(watchdog); conns.forEach(c => { try { c.close(); } catch (e) {} }); if (peer) { try { peer.destroy(); } catch (e) {} } }
  };
}

/* Player/spectator side of the internet transport. */
function PeerClient(code, onMsg, onStatus) {
  let peer = null, conn = null, alive = true, retries = 0, opened = false;
  const target = PEER_PREFIX + code;
  const queue = [];

  function build() {
    if (!alive) return;
    if (typeof window.Peer !== 'function') { onStatus('error', 'WebRTC library missing'); return; }
    onStatus('connecting', 'Finding the room…');
    try { peer = new window.Peer({ debug: 0 }); }
    catch (e) { onStatus('error', 'Could not start'); return; }

    peer.on('open', () => {
      conn = peer.connect(target, { reliable: true });
      conn.on('open', () => {
        opened = true; retries = 0;
        onStatus('online', 'Connected');
        while (queue.length) { try { conn.send(JSON.stringify(queue.shift())); } catch (e) {} }
      });
      conn.on('data', d => { if (alive) onMsg(d); });
      conn.on('close', () => { if (alive) { onStatus('retry', 'Lost the host…'); scheduleRetry(); } });
      conn.on('error', () => {});
    });
    peer.on('error', err => {
      const type = err && err.type;
      if (type === 'peer-unavailable') { onStatus(opened ? 'retry' : 'notfound', 'Room not found'); if (opened) scheduleRetry(); return; }
      if (type === 'network' || type === 'server-error' || type === 'socket-error') { onStatus('retry', 'Reconnecting…'); scheduleRetry(); return; }
      onStatus('error', (err && err.message) || 'Connection problem');
    });
  }
  function scheduleRetry() {
    if (!alive || retries >= 5) { if (retries >= 5) onStatus('error', 'Could not reconnect'); return; }
    const wait = 1000 * Math.pow(1.8, retries++);
    setTimeout(() => { try { if (peer) peer.destroy(); } catch (e) {} build(); }, wait);
  }
  build();

  return {
    kind: 'peer',
    send(m) {
      if (conn && conn.open) { try { conn.send(JSON.stringify(m)); return; } catch (e) {} }
      if (queue.length < 40) queue.push(m);
    },
    close() { alive = false; try { if (conn) conn.close(); } catch (e) {} try { if (peer) peer.destroy(); } catch (e) {} }
  };
}

/* A Net multiplexes the buses and drops duplicate deliveries. */
/* ==========================================================================
   Relay transport

   Peer-to-peer needs WebRTC and a signalling service, both of which corporate
   and school networks routinely block. When this page is served by the bundled
   relay server, the game travels over ordinary HTTP long-polling instead —
   the same kind of request that fetched the page, so anything that can load
   the page can play. Detected automatically; nothing to configure.
   ======================================================================== */
const RELAY_BASE = (function () {
  const p = location.pathname;
  return p.slice(0, p.lastIndexOf('/') + 1) + '__qa/';
})();

let relayProbe = null;
function findRelay() {
  if (relayProbe) return relayProbe;
  if (!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') {
    relayProbe = Promise.resolve(false);
    return relayProbe;
  }
  relayProbe = fetch(RELAY_BASE + 'ping', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => !!(j && j.quizarena))
    .catch(() => false);
  return relayProbe;
}

function RelayBus(code, onMsg, onStatus) {
  let alive = true, since = -1, misses = 0, ctrl = null;
  const status = onStatus || function () {};

  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function loop() {
    while (alive) {
      try {
        ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const res = await fetch(RELAY_BASE + 'poll?room=' + encodeURIComponent(code) + '&since=' + since,
          { cache: 'no-store', signal: ctrl && ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = await res.json();
        if (!alive) return;
        since = body.seq;
        misses = 0;
        status('online', 'Open to any device');
        (body.msgs || []).forEach(m => onMsg(m));
      } catch (e) {
        if (!alive) return;
        misses++;
        status(misses > 2 ? 'error' : 'retry', misses > 2 ? 'Lost the server' : 'Reconnecting…');
        await wait(Math.min(8000, 400 * Math.pow(2, misses)));
      }
    }
  }
  loop();

  return {
    kind: 'relay',
    send(m) {
      if (!alive) return;
      fetch(RELAY_BASE + 'send?room=' + encodeURIComponent(code), {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m)
      }).catch(() => {});
    },
    close() { alive = false; if (ctrl) { try { ctrl.abort(); } catch (e) {} } }
  };
}

function Net(opts) {
  const seen = Object.create(null);
  let seenN = 0;
  const buses = [];
  let mseq = 0;
  const selfTag = uid(6);

  function accept(raw) {
    let m = raw;
    if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch (e) { return; } }
    if (!m || typeof m !== 'object') return;
    if (m._from === selfTag) return;                 /* our own echo */
    if (m._id) {
      if (seen[m._id]) return;
      seen[m._id] = 1;
      if (++seenN > 4000) { for (const k in seen) delete seen[k]; seenN = 0; }
    }
    opts.onMessage(m);
  }

  const api = {
    add(bus) { buses.push(bus); return bus; },
    send(m) {
      const wrapped = Object.assign({ _id: selfTag + ':' + (++mseq), _from: selfTag }, m);
      buses.forEach(b => b.send(wrapped));
    },
    accept,
    close() { buses.forEach(b => { try { b.close(); } catch (e) {} }); buses.length = 0; }
  };
  return api;
}



/* ==========================================================================
   Question images

   Whatever a host drags in — a 6MB phone photo, a screenshot — has to survive
   localStorage (a few MB in total), one relay message (256KB), and a
   projector. So every image is re-encoded down to a sane size before it is
   ever stored: longest edge capped, quality stepped down until it fits.
   ======================================================================== */
const IMG_MAX_EDGE = 1280;
const IMG_BUDGET = 140 * 1024;      /* data-URI characters, keeps a relay message small */

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read that file'));
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not an image the browser can open'));
    img.src = src;
  });
}

/* Returns a data URI, or rejects with a message worth showing the host. */
function shrinkImage(src) {
  return loadImage(src).then(img => {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error('That image has no size');
    let scale = Math.min(1, IMG_MAX_EDGE / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const encode = (sc, quality) => {
      canvas.width = Math.max(1, Math.round(w0 * sc));
      canvas.height = Math.max(1, Math.round(h0 * sc));
      /* flatten onto white: the page is light, and dropping the alpha channel
         is what makes jpeg/webp worth using here */
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let out = '';
      try { out = canvas.toDataURL('image/webp', quality); } catch (e) { out = ''; }
      if (out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', quality);
      return out;
    };

    let quality = 0.82;
    let out = encode(scale, quality);
    /* step quality down first, then dimensions — detail matters less than
       the picture being visible at all */
    while (out.length > IMG_BUDGET && quality > 0.4) {
      quality -= 0.12;
      out = encode(scale, quality);
    }
    while (out.length > IMG_BUDGET && scale > 0.28) {
      scale *= 0.78;
      out = encode(scale, quality);
    }
    if (out.length > IMG_BUDGET) throw new Error('That image is too detailed to shrink — try a smaller one');
    return out;
  });
}

/* ==========================================================================
   Motion helpers
   ======================================================================== */
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Count a number up rather than snapping it — a score that climbs reads as
   something that was earned. */
function countUp(el, to, ms) {
  if (!el) return;
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (reduced() || from === to || Math.abs(to - from) < 2) { el.textContent = nf(to); return; }
  const t0 = performance.now(), dur = ms || 650;
  const step = t => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = nf(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* FLIP: capture where rows are, let the caller re-order the DOM, then play
   each row from its old position to its new one. Watching the leaderboard
   physically overtake is the whole point of a live scoreboard. */
function flip(container, key, mutate) {
  if (!container) { mutate(); return; }
  const before = new Map();
  if (!reduced()) {
    container.querySelectorAll('[' + key + ']').forEach(el =>
      before.set(el.getAttribute(key), el.getBoundingClientRect().top));
  }
  mutate();
  if (reduced() || !before.size) return;
  container.querySelectorAll('[' + key + ']').forEach(el => {
    const was = before.get(el.getAttribute(key));
    if (was == null) return;
    const delta = was - el.getBoundingClientRect().top;
    if (!delta) return;
    el.classList.add('moving');
    el.animate(
      [{ transform: 'translateY(' + delta + 'px)' }, { transform: 'none' }],
      { duration: 620, easing: 'cubic-bezier(.22,.8,.28,1)' }
    ).onfinish = () => el.classList.remove('moving');
  });
}

/* Split a room code so each character can drop in on its own beat. */
const codeLetters = code => String(code).split('')
  .map((c, i) => '<span style="animation-delay:' + (i * 55) + 'ms">' + c + '</span>').join('');

/* ------------------------------------------------------------------ export */
window.QA = {
  $, $$, esc, clamp, uid, roomCode, secs, mmss, nf, now,
  shape, ico, markSVG, ACOLORS, AHEX, TEAM_PALETTE,
  countUp, flip, codeLetters, reduced,
  shrinkImage, loadImage, readFileAsDataURL, IMG_BUDGET,
  toast, modal, LS, SS, Sound, Confetti,
  LocalBus, PeerHost, PeerClient, RelayBus, Net, PEER_PREFIX, findRelay
};
})();
