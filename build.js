/* Assembles the single-file app from src/ plus the two inlined libraries.

   The whole app ships as one self-contained index.html, but it is written as
   modules so it stays readable. This script is the only thing that knows how
   they go together. */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SRC = path.join(HERE, 'src');
const OUT = process.argv[2] || path.join(HERE, 'index.html');

const read = p => fs.readFileSync(p, 'utf8');

const peer = read(path.join(HERE, 'lib/peerjs.min.js'));
const qr = read(path.join(HERE, 'lib/qrcode.js'));
for (const [name, body] of [['peerjs', peer], ['qrcode', qr]]) {
  if (/<\/script/i.test(body)) throw new Error(name + ' contains a closing script tag');
}

const ARTIFACT = process.argv.indexOf('--artifact') >= 0;

/* The Artifact host wraps the file in its own document skeleton, so that build
   drops everything above <body> and keeps only the <style> blocks. */
let head = read(path.join(SRC, '00-head.html'))
  .replace('/*FONTS*/', () => read(path.join(SRC, '01-fonts.css')));
if (ARTIFACT) head = (head.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');

/* Each module pulls helpers out of window.QA by name. A rename in core that
   misses a consumer only fails at runtime, deep inside a screen nobody reopens
   for a while — so fail the build instead. */
function checkImports(providers, consumers) {
  const exported = new Set();
  for (const f of providers) {
    const src = read(path.join(SRC, f));
    const block = src.match(/window\.QA = \{([\s\S]*?)\n\};/);
    if (block) {
      block[1].split(/[,\s]+/).map(t => t.replace(/:$/, '').trim())
        .filter(t => /^[A-Za-z_$][\w$]*$/.test(t)).forEach(t => exported.add(t));
    }
    /* modules that hang extra helpers on the namespace after core builds it */
    let m; const re = /(?:^|\s)(?:window\.QA|Q)\.([A-Za-z_$][\w$]*)\s*=/g;
    while ((m = re.exec(src))) exported.add(m[1]);
  }
  const problems = [];
  for (const f of consumers) {
    const d = read(path.join(SRC, f)).match(/const \{([^}]*)\} = Q;/);
    if (!d) continue;
    d[1].split(',').map(n => n.trim()).filter(Boolean).forEach(n => {
      if (!exported.has(n)) problems.push(f + ' imports "' + n + '", which nothing exports');
    });
  }
  if (problems.length) throw new Error('broken imports:\n  ' + problems.join('\n  '));
}
checkImports(['20-core.js', '22-avatars.js', '70-puzzles.js', '72-words.js', '74-puzzle-ui.js'],
             ['30-build.js', '40-views.js', '50-host.js', '60-play.js', '74-puzzle-ui.js']);

/* Order matters: core builds window.QA, the puzzle engines are a dependency of
   both the builder and the host, and the router in 60-play boots last. */
const MODULES = ['20-core.js', '22-avatars.js', '72-words.js', '70-puzzles.js',
                 '40-views.js', '30-build.js', '50-host.js', '74-puzzle-ui.js', '60-play.js'];

const parts = [
  head,
  read(path.join(SRC, '05-sprite.html')),
  read(path.join(SRC, '10-body.html')),
  '',
  '<!-- PeerJS 1.5.4 (MIT) — inlined so the page has no external dependency.',
  '     Used only to link players to the host directly; no data goes to a server',
  '     other than the WebRTC signalling handshake. https://peerjs.com -->',
  '<script>' + peer + '</script>',
  '',
  '<!-- qrcode-generator 1.4.4 (MIT) by Kazuhiko Arase — draws the join QR. -->',
  '<script>' + qr + '</script>',
  '',
  '<script>'
].concat(MODULES.map(m => read(path.join(SRC, m))))
 .concat(['</script>'])
 .concat(ARTIFACT ? [''] : ['</body>', '</html>', '']);

fs.writeFileSync(OUT, parts.join('\n'));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
