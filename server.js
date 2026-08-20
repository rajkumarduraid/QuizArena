#!/usr/bin/env node
/**
 * Quiz Arena relay server
 * =======================
 * Serves index.html and carries the game between devices over ordinary HTTP
 * long-polling. Nothing but plain web requests, so networks that block
 * WebRTC and peer-to-peer traffic — most workplaces and schools — still work.
 *
 *   node server.js            # port 8080
 *   node server.js 3000       # or pick your own
 *
 * Requires Node 14 or newer. No dependencies, no install step.
 *
 * The page finds the relay by itself: it asks this server for __qa/ping on
 * load, and switches from peer-to-peer to the relay when it answers.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;
const PAGE = path.join(__dirname, 'index.html');

/* Guard rails — this is a party game, but it is still a listening socket. */
const HOLD_MS = 25000;        /* how long a poll waits before answering empty */
const MAX_BODY = 256 * 1024;  /* per message                                  */
const KEEP_MSGS = 200;        /* per room backlog                             */
const MAX_ROOMS = 200;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const CODE_RE = /^[A-Z0-9]{6}$/;

/** code -> { seq, msgs: [{seq, data}], waiters: [], touched } */
const rooms = new Map();

function room(code) {
  let r = rooms.get(code);
  if (!r) {
    if (rooms.size >= MAX_ROOMS) sweep(true);
    r = { seq: 0, msgs: [], waiters: [], touched: Date.now() };
    rooms.set(code, r);
  }
  r.touched = Date.now();
  return r;
}

function sweep(force) {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, r] of rooms) {
    if (r.touched < cutoff && !r.waiters.length) rooms.delete(code);
  }
  if (force && rooms.size >= MAX_ROOMS) {
    /* Still full: drop the least recently used idle room. */
    let oldest = null;
    for (const [code, r] of rooms) {
      if (r.waiters.length) continue;
      if (!oldest || r.touched < oldest[1].touched) oldest = [code, r];
    }
    if (oldest) rooms.delete(oldest[0]);
  }
}
setInterval(sweep, 10 * 60 * 1000).unref();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function flush(r, waiter) {
  const msgs = r.msgs.filter(m => m.seq > waiter.since).map(m => m.data);
  clearTimeout(waiter.timer);
  json(waiter.res, 200, { seq: r.seq, msgs });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ routes */
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (e) { res.writeHead(400).end('Bad request'); return; }

  const route = url.pathname.replace(/^.*\/__qa\//, '__qa/');

  /* --- the page announces itself here --------------------------------- */
  if (route === '__qa/ping') {
    json(res, 200, { quizarena: 1, rooms: rooms.size });
    return;
  }

  /* --- a client posts one message into a room ------------------------- */
  if (route === '__qa/send' && req.method === 'POST') {
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    if (!CODE_RE.test(code)) { json(res, 400, { error: 'bad room code' }); return; }
    let data;
    try { data = JSON.parse(await readBody(req)); }
    catch (e) { json(res, 400, { error: 'bad body' }); return; }

    const r = room(code);
    r.seq++;
    r.msgs.push({ seq: r.seq, data });
    if (r.msgs.length > KEEP_MSGS) r.msgs.splice(0, r.msgs.length - KEEP_MSGS);

    const waiting = r.waiters.splice(0);
    waiting.forEach(w => flush(r, w));
    json(res, 200, { ok: true, seq: r.seq });
    return;
  }

  /* --- a client waits for whatever comes next ------------------------- */
  if (route === '__qa/poll' && req.method === 'GET') {
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    if (!CODE_RE.test(code)) { json(res, 400, { error: 'bad room code' }); return; }
    const r = room(code);
    const since = Number(url.searchParams.get('since'));

    /* since < 0 means "just tell me where we are" — a joiner does not want
       the backlog replayed at it, only what happens from now on. */
    if (!Number.isFinite(since) || since < 0) { json(res, 200, { seq: r.seq, msgs: [] }); return; }
    if (r.seq > since) {
      json(res, 200, { seq: r.seq, msgs: r.msgs.filter(m => m.seq > since).map(m => m.data) });
      return;
    }

    const waiter = { res, since, timer: null };
    waiter.timer = setTimeout(() => {
      const i = r.waiters.indexOf(waiter);
      if (i >= 0) r.waiters.splice(i, 1);
      json(res, 200, { seq: r.seq, msgs: [] });
    }, HOLD_MS);
    r.waiters.push(waiter);
    req.on('close', () => {
      const i = r.waiters.indexOf(waiter);
      if (i >= 0) { r.waiters.splice(i, 1); clearTimeout(waiter.timer); }
    });
    return;
  }

  /* --- the page itself ------------------------------------------------ */
  if (req.method === 'GET' || req.method === 'HEAD') {
    fs.readFile(PAGE, (err, buf) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found next to server.js');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache'
      });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain' });
  res.end('Method not allowed');
});

server.headersTimeout = HOLD_MS + 15000;
server.requestTimeout = 0;         /* long polls are meant to hang about */
server.keepAliveTimeout = HOLD_MS + 10000;

function addresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

if (!fs.existsSync(PAGE)) {
  console.error('\n  Could not find index.html next to server.js.');
  console.error('  Keep both files in the same folder.\n');
  process.exit(1);
}

server.listen(PORT, () => {
  const ips = addresses();
  console.log('\n  ⚡ Quiz Arena is running\n');
  console.log('  On this computer:   http://localhost:' + PORT);
  if (ips.length) {
    console.log('\n  Share ONE of these with your players:');
    ips.forEach(ip => console.log('      http://' + ip + ':' + PORT));
    console.log('\n  They must be on the same network as this computer.');
  } else {
    console.log('\n  No network address found — others will not be able to reach this.');
  }
  console.log('\n  Leave this window open for the whole quiz. Ctrl+C to stop.\n');
});

process.on('SIGINT', () => { console.log('\n  Stopped.\n'); process.exit(0); });
