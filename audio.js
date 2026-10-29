/* Timer Gong: sintesi del gong e file WAV della sessione.
   Usato dalla pagina (riserva blob) e dal service worker (session.wav). */
(function (root) {
  'use strict';
  var SR = 11025;          // campionamento: basta per le parziali del gong, file leggeri
  var MAXAUDIO = 3600;     // oltre 60 minuti niente file audio (memoria del telefono)
  var TAIL = 17;           // secondi dopo la fine: risonanza dei due gong finali

  // rapporto di frequenza, ampiezza, moltiplicatore del decadimento
  var PARTIALS = [[1, 1, 1], [1.004, 0.75, 0.95], [2.756, 0.5, 0.7], [2.766, 0.32, 0.65],
                  [5.404, 0.3, 0.45], [8.933, 0.16, 0.3], [13.34, 0.08, 0.2]];

  function synthGong(f0, dur, tau) {
    var n = Math.floor(SR * dur), d = new Float32Array(n), TWO = 2 * Math.PI, i, k;
    for (k = 0; k < PARTIALS.length; k++) {
      var r = PARTIALS[k][0], a = PARTIALS[k][1], T = tau * PARTIALS[k][2];
      if (f0 * r > SR * 0.45) continue;
      var w = TWO * f0 * r / SR, bloom = r > 2 ? 0.06 : 0.004;
      for (i = 0; i < n; i++) {
        var t = i / SR;
        d[i] += a * Math.sin(w * i) * Math.exp(-t / T) * (1 - Math.exp(-t / bloom));
      }
    }
    // colpo del battente: breve rumore filtrato
    var seed = 1, y = 0, nn = Math.min(n, Math.floor(SR * 0.05));
    for (i = 0; i < nn; i++) {
      seed = (seed * 16807) % 2147483647;
      var x = (seed / 2147483647) * 2 - 1;
      y += 0.25 * (x - y);
      var tt = i / SR;
      d[i] += y * 0.9 * Math.exp(-tt / 0.012) * (1 - Math.exp(-tt / 0.001));
    }
    var peak = 0;
    for (i = 0; i < n; i++) { var v = Math.abs(d[i]); if (v > peak) peak = v; }
    var g = peak > 0 ? 0.9 / peak : 1, fade = Math.floor(SR * 0.4);
    for (i = 0; i < n; i++) {
      d[i] *= g;
      if (i > n - fade) d[i] *= (n - i) / fade;
    }
    return d;
  }

  var cache = null;
  function gongs() {
    if (!cache) cache = { short: synthGong(238, 6, 1.5), end: synthGong(168, 13, 3.4) };
    return cache;
  }

  function wav(n) {
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function w(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    return { buf: buf, pcm: new Int16Array(buf, 44, n) };
  }

  function add(pcm, src, at, gain) {
    var s0 = Math.round(at * SR), n = pcm.length;
    for (var i = 0; i < src.length && s0 + i < n; i++) {
      var v = pcm[s0 + i] + src[i] * gain * 30000;
      pcm[s0 + i] = v > 32767 ? 32767 : (v < -32768 ? -32768 : v);
    }
  }

  // Sequenza: durate in minuti, attesa iniziale in secondi. Un gong a ogni inizio, due alla fine.
  function timeline(stepsMin, prep) {
    var durs = stepsMin.map(function (m) { return Math.round(m * 60); });
    var cum = [0];
    durs.forEach(function (d) { cum.push(cum[cum.length - 1] + d); });
    var T = prep + cum[cum.length - 1];
    var events = durs.map(function (_, i) { return { p: prep + cum[i], kind: 'start' }; });
    events.push({ p: T, kind: 'end' });
    return { durs: durs, cum: cum, T: T, events: events };
  }

  function sessionWav(stepsMin, prep) {
    if (!stepsMin.length) return null;
    var tl = timeline(stepsMin, prep);
    if (tl.T > MAXAUDIO) return null;
    var g = gongs(), w = wav(Math.ceil((tl.T + TAIL) * SR));
    tl.events.forEach(function (e) {
      if (e.kind === 'end') { add(w.pcm, g.end, e.p, 1); add(w.pcm, g.end, e.p + 3.4, 0.6); }
      else add(w.pcm, g.short, e.p, 1);
    });
    return w.buf;
  }

  function gongWav() {
    var d = gongs().short, w = wav(d.length);
    add(w.pcm, d, 0, 1);
    return w.buf;
  }

  root.TimerAudio = { SR: SR, MAXAUDIO: MAXAUDIO, timeline: timeline, sessionWav: sessionWav, gongWav: gongWav };
})(typeof globalThis !== 'undefined' ? globalThis : self);
