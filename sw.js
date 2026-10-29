// Timer Gong, service worker.
// - App: prima la rete, poi la copia salvata, cosi' si apre anche senza connessione.
// - session.wav: l'audio della sessione generato qui, con risposte a pezzi (Range) come vuole iOS.
importScripts('audio.js');

const CACHE = 'timer-gong-v7';
const FILES = ['./', 'index.html', 'audio.js', 'gong.wav', 'manifest.webmanifest',
               'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

let last = { key: '', buf: null };
function sessionBuffer(url) {
  const key = url.search;
  if (last.key !== key) {
    const steps = (url.searchParams.get('s') || '').split(',').map(Number).filter(x => x > 0).slice(0, 20);
    const prep = Math.max(0, Math.min(60, Number(url.searchParams.get('p')) || 0));
    last = { key, buf: TimerAudio.sessionWav(steps, prep) };
  }
  return last.buf;
}

function rangeResponse(buf, req) {
  const size = buf.byteLength;
  const head = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const h = req.headers.get('range');
  if (!h) return new Response(buf, { status: 200, headers: { ...head, 'Content-Length': String(size) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  let start, end;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else if (m && m[1] !== '') { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!m || start === undefined || start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/session.wav')) {
    const buf = sessionBuffer(url);
    e.respondWith(buf ? rangeResponse(buf, e.request) : new Response('', { status: 404 }));
    return;
  }

  // richieste a pezzi di file statici (gong.wav): con rete le gestisce il browser,
  // senza rete rispondiamo dalla copia salvata
  if (e.request.headers.has('range')) {
    e.respondWith(fetch(e.request).catch(() =>
      caches.match(url.pathname.endsWith('/gong.wav') ? 'gong.wav' : e.request)
        .then(r => r ? r.arrayBuffer().then(b => rangeResponse(b, e.request)) : Response.error())));
    return;
  }

  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.status === 200) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
