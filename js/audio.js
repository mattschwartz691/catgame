// Cat About the House — fully synthesized audio (Web Audio API, no files, no libraries).
//
//   initAudio() / audioReady() / setSfxOn() / setMusicOn() / setMasterVolume()
//   suspendAudio() / resumeAudio()
//   sfx.<name>(opts)      one-shots   (opts always accepts { vol = 1, pan = 0 })
//   loops.<name>.start() / .stop() / .set(level 0..1)
//   music.setMood('calm' | 'playful' | 'zoomies' | 'sleepy')
//
// Signal flow:
//   one-shot voice ─┬─────────────► sfxBus ──┐
//   loops ► loopBus ┘                         ├─► limiter ► soft-clip ► master ► destination
//   music instruments ► musicBus ─────────────┤
//   (sends) sfxSend / musicSend ► convolver ──┘

/* ───────────────────────── module state ───────────────────────── */

let C = null;                 // AudioContext (or OfflineAudioContext under test)
let isTest = false;
let sfxOn = true, musicOn = false, masterVol = 1;
let sfxBus, loopBus, musicBus, sfxSend, musicSend, masterGain;
let whiteBuf, pinkBuf, brownBuf, wobbleBuf, cosWave;
let hasPanner = false;
let timer = 0;
let suspended = false;

const MAX_VOICES = 24;        // normal one-shots
const LOW_VOICES = 16;        // low-priority one-shots (steps, laps, quiet hits) stop here
const UI_VOICES = 30;         // rewards / UI may exceed the normal cap slightly
const MUSIC_LEVEL = 0.2;
const EMPTY = Object.freeze({});
const voiceEnds = [];
const lastPlay = new Map();
const stats = { played: 0, dropped: 0, rateLimited: 0, errors: 0, lastError: '' };
function oops(e) { stats.errors++; stats.lastError = String((e && e.stack) || e); }

/* ───────────────────────── small utilities ───────────────────────── */

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function gn(v) { const g = C.createGain(); g.gain.value = v; return g; }
function bq(type, f, q) {
  const b = C.createBiquadFilter(); b.type = type; b.frequency.value = f;
  if (q !== undefined) b.Q.value = q;
  return b;
}
function chain() { // chain(a, b, c) connects a→b→c, returns last
  for (let i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
  return arguments[arguments.length - 1];
}
// linear breakpoint automation; pts = [[fraction 0..1, value], ...]
function ramp(param, t, dur, pts, mul) {
  const m = mul === undefined ? 1 : mul;
  param.setValueAtTime(pts[0][1] * m, t + pts[0][0] * dur);
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(pts[i][1] * m, t + pts[i][0] * dur);
}
// percussive envelope: fast linear attack, exponential-ish decay reaching ~silence at t+dur
function perc(param, t, a, peak, dur) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(0, t + a, Math.max(0.004, (dur - a) / 5.5));
}
function glide(param, t, f0, f1, dur) {
  param.setValueAtTime(f0, t);
  param.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
}

/* ───────────────────────── voices ───────────────────────── */

// A voice is one output gain (+ optional panner + optional reverb send). Sources created through
// osc()/nz() register their stop time; when the last one ends the voice disconnects itself.
function makeVoice(dest, gain, pan, sendDest, sendAmt) {
  const out = gn(gain);
  let pn = null, sd = null;
  if (pan && hasPanner) { pn = C.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); out.connect(pn); pn.connect(dest); }
  else out.connect(dest);
  if (sendDest && sendAmt > 0) { sd = gn(sendAmt); (pn || out).connect(sd); sd.connect(sendDest); }
  const v = { out, last: 0, lastSrc: null, kill: null };
  v.kill = () => {
    try { out.disconnect(); if (pn) pn.disconnect(); if (sd) sd.disconnect(); } catch (e) { /* already gone */ }
    v.lastSrc = null;
  };
  return v;
}
function track(v, src, t1) {
  if (!v || t1 <= v.last) return;
  if (v.lastSrc) v.lastSrc.onended = null;
  v.last = t1; v.lastSrc = src; src.onended = v.kill;
}
function osc(v, type, f, t0, t1, dest) {
  const o = C.createOscillator();
  o.type = type; o.frequency.value = f;
  if (dest) o.connect(dest);
  o.start(t0); o.stop(t1); track(v, o, t1);
  return o;
}
function nz(v, t0, t1, dest, buf, rate) {
  const s = C.createBufferSource();
  s.buffer = buf || whiteBuf; s.loop = true;
  if (rate) s.playbackRate.value = rate;
  if (dest) s.connect(dest);
  s.start(t0, Math.random() * (s.buffer.duration - 0.05)); s.stop(t1); track(v, s, t1);
  return s;
}
// smooth random modulation (slowed "wobble" buffer) → param
function wob(v, t0, t1, rate, depth, param) {
  const s = nz(v, t0, t1, null, wobbleBuf, rate), g = gn(depth);
  s.connect(g); g.connect(param);
  return g;
}
// filtered noise burst
function burst(v, t, o) {
  const dur = o.dur, s = nz(v, t, t + dur + 0.03, null, o.buf, o.rate);
  const f = bq(o.type || 'bandpass', o.f, o.q === undefined ? 1 : o.q);
  if (o.f1) glide(f.frequency, t, o.f, o.f1, dur);
  const g = gn(0);
  perc(g.gain, t, o.a === undefined ? 0.003 : o.a, o.peak, dur);
  chain(s, f, g, o.dest || v.out);
  return g;
}
// decaying sine (or other) partial, optional pitch glide
function ping(v, t, f, dur, peak, type, dest, f1, a) {
  const o = osc(v, type || 'sine', f, t, t + dur + 0.03), g = gn(0);
  if (f1) glide(o.frequency, t, f, f1, dur * 0.8);
  perc(g.gain, t, a === undefined ? 0.002 : a, peak, dur);
  chain(o, g, dest || v.out);
  return o;
}
// two-operator FM ping (bell / tine tones)
function fm(v, t, f, dur, peak, ratio, index, dest) {
  const t1 = t + dur + 0.03, r = ratio || 1, ix = index === undefined ? 1 : index;
  const car = osc(v, 'sine', f, t, t1), mod = osc(v, 'sine', f * r, t, t1), mg = gn(0), g = gn(0);
  mg.gain.setValueAtTime(f * r * ix, t);
  mg.gain.setTargetAtTime(f * r * ix * 0.06, t, dur * 0.16);
  chain(mod, mg, car.frequency);
  perc(g.gain, t, 0.004, peak, dur);
  chain(car, g, dest || v.out);
  return g;
}

/* ───────────────────────── buffers & master graph ───────────────────────── */

function makeBuffers() {
  const sr = C.sampleRate, n = Math.floor(sr * 2);
  whiteBuf = C.createBuffer(1, n, sr);
  pinkBuf = C.createBuffer(1, n, sr);
  brownBuf = C.createBuffer(1, n, sr);
  const w = whiteBuf.getChannelData(0), p = pinkBuf.getChannelData(0), b = brownBuf.getChannelData(0);
  const F = 4096, ext = n + F, pt = new Float32Array(ext), bt = new Float32Array(ext);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < ext; i++) {
    const x = Math.random() * 2 - 1;
    if (i < n) w[i] = x;
    // Paul Kellet pink filter
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    pt[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02; bt[i] = br * 3.5;
  }
  // loop-seamless: crossfade the head with the continuation past the end
  for (let i = 0; i < n; i++) {
    if (i < F) { const k = i / F; p[i] = pt[i] * k + pt[n + i] * (1 - k); b[i] = bt[i] * k + bt[n + i] * (1 - k); }
    else { p[i] = pt[i]; b[i] = bt[i]; }
  }
  // remove residual DC from brown noise
  let mean = 0; for (let i = 0; i < n; i++) mean += b[i]; mean /= n;
  for (let i = 0; i < n; i++) b[i] -= mean;

  // wobble: smooth random curve, ~10 Hz bandwidth at playbackRate 1, loops seamlessly
  const wn = Math.floor(sr * 8), step = Math.floor(sr / 20), cps = Math.ceil(wn / step);
  wobbleBuf = C.createBuffer(1, cps * step, sr);
  const wd = wobbleBuf.getChannelData(0), cp = new Float32Array(cps + 1);
  for (let i = 0; i < cps; i++) cp[i] = Math.random() * 2 - 1;
  cp[cps] = cp[0];
  for (let i = 0; i < cps; i++) for (let j = 0; j < step; j++) {
    const k = (1 - Math.cos(Math.PI * j / step)) / 2;
    wd[i * step + j] = cp[i] * (1 - k) + cp[i + 1] * k;
  }
  cosWave = C.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
}

function makeImpulse() {
  // small warm room: ~0.9 s decay, high end dies faster than low end
  const sr = C.sampleRate, len = Math.floor(sr * 1.1), buf = C.createBuffer(2, len, sr), pre = Math.floor(sr * 0.006);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr, x = (Math.random() * 2 - 1) * Math.exp(-tt * 7.2);
      const a = 0.55 * Math.exp(-tt * 3.2) + 0.08;     // one-pole coefficient shrinks → darker tail
      lp += a * (x - lp);
      d[i] = lp;
    }
    for (let k = 0; k < 5; k++) {                      // a few early reflections
      const i = pre + Math.floor(sr * rnd(0.004, 0.03));
      d[i] += rnd(-0.5, 0.5);
    }
  }
  return buf;
}

function softClipCurve() {
  const n = 2049, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= 0.5 ? a : 0.5 + 0.38 * Math.tanh((a - 0.5) / 0.38));
  }
  return c;
}

function buildGraph() {
  hasPanner = typeof C.createStereoPanner === 'function';
  makeBuffers();
  masterGain = gn(masterVol);
  masterGain.connect(C.destination);
  const clip = C.createWaveShaper(); clip.curve = softClipCurve();
  const comp = C.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 14;
  comp.attack.value = 0.002; comp.release.value = 0.14;
  chain(comp, clip, masterGain);
  sfxBus = gn(sfxOn ? 1 : 0); musicBus = gn(0); loopBus = gn(1);
  const dcBlock = bq('highpass', 22, 0.707);          // FM / asymmetric waveforms can carry DC
  dcBlock.connect(comp);
  sfxBus.connect(dcBlock); musicBus.connect(dcBlock); loopBus.connect(sfxBus);
  const conv = C.createConvolver(); conv.buffer = makeImpulse();
  const wet = gn(0.9);
  sfxSend = gn(sfxOn ? 1 : 0); musicSend = gn(0);
  sfxSend.connect(conv); musicSend.connect(conv); chain(conv, wet, dcBlock);
  buildMusicBuses();
}

/* ───────────────────────── public: lifecycle ───────────────────────── */

export function initAudio() {
  try {
    if (!C) {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      C = new AC();
      isTest = false;
      buildGraph();
      afterInit();
      if (typeof C.addEventListener === 'function') {
        C.addEventListener('statechange', () => { if (C && !suspended && C.state === 'running') startTimer(); });
      }
    }
    if (!isTest && !suspended && C.state !== 'running' && C.resume) {
      const p = C.resume(); if (p && p.catch) p.catch(() => {});
      // iOS: a (silent) buffer started inside the gesture unlocks output
      const s = C.createBufferSource(); s.buffer = C.createBuffer(1, 1, C.sampleRate);
      s.connect(C.destination); s.start(0);
    }
    if (!suspended) startTimer();
  } catch (e) { oops(e); }
}

function afterInit() {
  for (const k in loops) if (loops[k].on) loops[k].start();
  if (musicOn) startMusic();
}

export function audioReady() { return !!C; }

export function setSfxOn(on) {
  sfxOn = !!on;
  if (!C) return;
  const t = C.currentTime, g = sfxOn ? 1 : 0;
  sfxBus.gain.setTargetAtTime(g, t, 0.04); sfxSend.gain.setTargetAtTime(g, t, 0.04);
}

export function setMusicOn(on) {
  on = !!on;
  if (on === musicOn) return;
  musicOn = on;
  if (!C) return;
  if (on) startMusic(); else stopMusic();
}

export function setMasterVolume(v) {
  masterVol = clamp(+v || 0, 0, 1);
  if (C) masterGain.gain.setTargetAtTime(masterVol, C.currentTime, 0.03);
}

export function suspendAudio() {
  suspended = true;
  stopTimer();
  if (C && !isTest && C.suspend && C.state === 'running') { const p = C.suspend(); if (p && p.catch) p.catch(() => {}); }
}

export function resumeAudio() {
  suspended = false;
  if (!C) return;
  if (!isTest && C.resume && C.state !== 'running') { const p = C.resume(); if (p && p.catch) p.catch(() => {}); }
  startTimer();
}

function startTimer() {
  if (timer || isTest || !C) return;
  timer = setInterval(tick, 100);
  tick();
}
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
function tick() {
  if (!C || suspended) return;
  try {
    const h = C.currentTime + 0.3;
    musicTick(h); ambienceTick(h);
  } catch (e) { oops(e); }
}

/* ───────────────────────── one-shot plumbing ───────────────────────── */

export const sfx = {};

function activeVoices(now) {
  let n = 0;
  for (let i = 0; i < voiceEnds.length; i++) if (voiceEnds[i] > now) voiceEnds[n++] = voiceEnds[i];
  voiceEnds.length = n;
  return n;
}

// meta: { arg: name of the positional/legacy first argument, prio: 0 low | 1 normal | 2 ui/reward,
//         gap: min seconds between identical triggers, rev: reverb send, g: level trim, dvol: default vol }
function def(name, meta, impl) {
  const gap = meta.gap || 0.03, g = meta.g === undefined ? 1 : meta.g, prio = meta.prio === undefined ? 1 : meta.prio;
  const cap = prio === 0 ? LOW_VOICES : prio === 2 ? UI_VOICES : MAX_VOICES;
  sfx[name] = function (a, b) {
    if (!C || !sfxOn) return;
    try {
      let o = a;
      if (o === undefined || o === null) o = EMPTY;
      else if (typeof o !== 'object') {            // legacy positional form: sfx.hit('clink', 0.3), sfx.land(4)
        o = {}; if (meta.arg) o[meta.arg] = a; if (typeof b === 'number') o.vol = b;
      }
      const now = C.currentTime;
      const sub = meta.arg ? o[meta.arg] : undefined;
      const key = sub === undefined ? name : name + ':' + sub;
      const last = lastPlay.get(key);
      if (last !== undefined && now >= last && now - last < gap) { stats.rateLimited++; return; }
      if (activeVoices(now) >= cap) { stats.dropped++; return; }
      lastPlay.set(key, now);
      const vol = clamp(o.vol === undefined ? (meta.dvol || 1) : +o.vol || 0, 0, 1.5);
      if (vol <= 0.001) return;
      const v = makeVoice(sfxBus, vol * g, +o.pan || 0, sfxSend, meta.rev || 0);
      const dur = impl(v, now + 0.004, o) || 0.3;
      if (!v.lastSrc) v.kill();
      voiceEnds.push(now + dur);
      stats.played++;
    } catch (e) { oops(e); }
  };
}

/* ───────────────────────── the cat's voice ───────────────────────── */

// Glottal-ish source (saw + pulse, vibrato, jitter, breath noise) → "mouth" lowpass → parallel moving
// formant bandpasses → optional purr-rate trill → amplitude envelope.
function catVoice(v, t, p) {
  const dur = p.dur, t1 = t + dur + 0.04, base = p.base;
  const o1 = osc(v, 'sawtooth', base, t, t1), o2 = osc(v, 'square', base, t, t1);
  o2.detune.value = rnd(4, 9);
  ramp(o1.frequency, t, dur, p.f0, base); ramp(o2.frequency, t, dur, p.f0, base);
  // vibrato grows through the call; plus slow random jitter so it never sounds like a synth
  const vib = osc(v, 'sine', p.vibRate || rnd(5.2, 7), t, t1), vg = gn(0), vd = base * (p.vib === undefined ? 0.014 : p.vib);
  ramp(vg.gain, t, dur, [[0, 0], [0.35, vd * 0.4], [1, vd]]);
  chain(vib, vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
  const jit = wob(v, t, t1, 1.6, base * 0.012, o1.frequency); jit.connect(o2.frequency);
  // source mix + spectral tilt
  const tilt = bq('lowpass', p.tilt || 4000, 0.5), src = gn(1);
  const voiced = p.voiced === undefined ? 1 : p.voiced;
  chain(o1, gn(0.55 * voiced), tilt); chain(o2, gn(0.2 * voiced), tilt); tilt.connect(src);
  const breath = p.breath === undefined ? 0.05 : p.breath;
  if (breath > 0) {
    const bg = gn(breath);
    chain(nz(v, t, t1), bq('highpass', 700, 0.5), bg, src);
    if (p.breathEnv) ramp(bg.gain, t, dur, p.breathEnv, breath);
  }
  // mouth opening / closing (nasal "m" onset, closing "ow")
  const mouth = bq('lowpass', 6000, 0.6);
  ramp(mouth.frequency, t, dur, p.open || [[0, 6000], [1, 6000]]);
  src.connect(mouth);
  const sum = gn(1), q = p.q || 5.5, sc = p.fScale || 1;
  const f1 = bq('bandpass', 700, q), f2 = bq('bandpass', 1800, q * 1.25), f3 = bq('bandpass', (p.F3 || 3300) * sc, q * 1.4);
  ramp(f1.frequency, t, dur, p.F1, sc); ramp(f2.frequency, t, dur, p.F2, sc);
  chain(mouth, f1, gn(1.0), sum); chain(mouth, f2, gn(0.75), sum); chain(mouth, f3, gn(0.5), sum);
  chain(mouth, bq('lowpass', 1400, 0.5), gn(0.1), sum);   // a little unfiltered body
  let tail = sum;
  if (p.trill) {                                           // rolled "mrr": amplitude flutter at purr rate
    const tg = gn(1), tl = osc(v, 'triangle', p.trillRate || rnd(24, 30), t, t1), td = gn(0);
    ramp(td.gain, t, dur, p.trill);
    chain(tl, td, tg.gain); sum.connect(tg); tail = tg;
  }
  const amp = gn(0);
  ramp(amp.gain, t, dur, p.amp);
  chain(tail, amp, bq('highpass', 220, 0.5), v.out);
}

// squeeze a breakpoint list into [pre..1] and hold its first value before that
function shiftPts(pts, pre, lead) {
  const out = lead ? lead.slice() : [[0, pts[0][1]]];
  for (let i = 0; i < pts.length; i++) out.push([pre + pts[i][0] * (1 - pre), pts[i][1]]);
  return out;
}

function meowClassic(v, t, kitten) {
  const base = kitten ? rnd(820, 1020) : rnd(450, 640);
  let dur = kitten ? rnd(0.32, 0.5) : rnd(0.52, 0.95);
  const style = Math.random();
  let f0;
  if (style < 0.5) f0 = [[0, 0.78], [0.12, 0.96], [rnd(0.26, 0.38), rnd(1.15, 1.28)], [0.62, 1.08], [1, rnd(0.66, 0.78)]];     // rise-fall
  else if (style < 0.8) f0 = [[0, 1.0], [0.1, rnd(1.18, 1.3)], [0.45, 1.05], [1, rnd(0.64, 0.74)]];                           // falling "mew"
  else f0 = [[0, 0.8], [0.25, 1.05], [0.6, 1.0], [0.86, rnd(1.2, 1.32)], [1, 1.12]];                                          // questioning "mrow?"
  const k = rnd(0.92, 1.1), pk = rnd(0.26, 0.36);
  let F1 = [[0, 400 * k], [pk, 900 * k], [0.66, 780 * k], [1, 500 * k]];
  let F2 = [[0, 2200 * k], [pk, 1850 * k], [0.62, 1550 * k], [1, 1000 * k]];
  let open = [[0, 550], [0.13, 5200], [0.7, 4400], [1, 1100]];
  let amp = [[0, 0], [0.09, 0.62], [pk, 1], [0.66, 0.8], [1, 0]];
  let trill = null;
  if (!kitten && chance(0.3)) {                    // two-syllable "mrr-ow"
    const pre = rnd(0.13, 0.2), tot = dur + pre, pf = pre / tot;
    f0 = shiftPts(f0, pf, [[0, 0.56], [pf * 0.8, 0.62]]);
    F1 = shiftPts(F1, pf, [[0, 380]]); F2 = shiftPts(F2, pf, [[0, 1500]]);
    open = shiftPts(open, pf, [[0, 700]]);
    amp = shiftPts(amp, pf, [[0, 0], [pf * 0.3, 0.42], [pf * 0.85, 0.38]]);
    amp[3][1] = 0.3;                               // dip between the syllables instead of silence
    trill = [[0, 0.75], [pf * 0.9, 0.7], [Math.min(1, pf * 1.3), 0], [1, 0]];
    dur = tot;
  }
  catVoice(v, t, { dur, base, f0, F1, F2, open, amp, trill, fScale: kitten ? 1.28 : 1, breath: kitten ? 0.07 : 0.05,
    tilt: kitten ? 5000 : 4000, vib: kitten ? 0.01 : 0.015 });
  return dur + 0.1;
}

function meowChirp(v, t) {
  const dur = rnd(0.24, 0.36), base = rnd(430, 520);
  catVoice(v, t, { dur, base,
    f0: [[0, 0.85], [0.3, 1.0], [0.8, rnd(1.5, 1.75)], [1, 1.6]],
    F1: [[0, 450], [0.5, 650], [1, 800]], F2: [[0, 1400], [0.6, 2000], [1, 2400]],
    open: [[0, 900], [0.4, 3000], [1, 5500]],
    amp: [[0, 0], [0.12, 0.8], [0.7, 1], [1, 0]],
    trill: [[0, 0.8], [0.55, 0.6], [0.9, 0.1], [1, 0]], trillRate: rnd(26, 34), breath: 0.04, vib: 0.004 });
  return dur + 0.1;
}

function meowChatter(v, t) {
  const n = 6 + ((Math.random() * 3) | 0), dur = rnd(0.72, 0.86), base = rnd(600, 720);
  const amp = [[0, 0]], f0 = [[0, 1]], slot = 1 / n;
  for (let i = 0; i < n; i++) {
    const s = i * slot + rnd(0, slot * 0.15), a = rnd(0.6, 1), fj = rnd(0.9, 1.15);
    amp.push([s + 0.002, 0], [s + slot * 0.12, a], [s + slot * 0.4, a * 0.45], [s + slot * 0.62, 0]);
    f0.push([s, fj * 1.12], [s + slot * 0.5, fj * 0.9]);
    // tiny teeth click on each "ek"
    burst(v, t + s * dur, { dur: 0.012, peak: 0.1 * a, type: 'highpass', f: 3500, q: 0.7, a: 0.001 });
  }
  amp.push([1, 0]); f0.push([1, 1]);
  catVoice(v, t, { dur, base, f0, amp,
    F1: [[0, 780], [1, 820]], F2: [[0, 2350], [1, 2500]], open: [[0, 5200], [1, 5200]],
    breath: 0.22, voiced: 0.75, vib: 0, q: 4.5 });
  return dur + 0.1;
}

function meowYawn(v, t) {
  const dur = rnd(1.0, 1.3), base = rnd(430, 520);
  catVoice(v, t, { dur, base,
    f0: [[0, 0.95], [0.25, 1.12], [1, 0.58]],
    F1: [[0, 500], [0.3, 850], [0.75, 700], [1, 480]], F2: [[0, 1300], [0.3, 1500], [1, 1050]],
    open: [[0, 900], [0.3, 4200], [0.8, 3000], [1, 900]],
    amp: [[0, 0], [0.28, 0.85], [0.5, 1], [1, 0]],
    voiced: 0.3, breath: 0.34, breathEnv: [[0, 1], [0.4, 0.8], [1, 1.3]], q: 3, vib: 0.008, tilt: 2200 });
  return dur + 0.1;
}

function meowHiss(v, t) {
  const dur = rnd(0.4, 0.55), t1 = t + dur + 0.03;
  const n = nz(v, t, t1), hp = bq('highpass', 2200, 0.7), bp = bq('peaking', 5200, 1.2), g = gn(0);
  bp.gain.value = 9;
  glide(bp.frequency, t, 4200, 6400, dur);
  ramp(g.gain, t, dur, [[0, 0], [0.06, 1], [0.3, 0.75], [1, 0]], 0.3);
  wob(v, t, t1, 4, 0.08, g.gain);                 // spitty flutter
  chain(n, hp, bp, g, v.out);
  burst(v, t, { dur: 0.05, peak: 0.25, type: 'bandpass', f: 1800, q: 1.2 });   // throaty onset
  return dur + 0.05;
}

def('meow', { arg: 'kind', rev: 0.14, gap: 0.12, g: 1.0 }, (v, t, o) => {
  switch (o.kind) {
    case 'chirp': return meowChirp(v, t);
    case 'chatter': return meowChatter(v, t);
    case 'yawn': return meowYawn(v, t);
    case 'hiss': return meowHiss(v, t);
    case 'kitten': return meowClassic(v, t, true);
    default: return meowClassic(v, t, false);
  }
});

/* ───────────────────────── movement ───────────────────────── */

def('step', { arg: 'surface', prio: 0, gap: 0.04, g: 3.0 }, (v, t, o) => {
  const k = rnd(0.85, 1.2), a = rnd(0.7, 1);
  switch (o.surface) {
    case 'tile':
      burst(v, t, { dur: 0.035, peak: 0.11 * a, f: 950 * k, q: 1.4 });
      burst(v, t, { dur: 0.012, peak: 0.03 * a, type: 'highpass', f: 2600, q: 0.7, a: 0.001 });
      break;
    case 'carpet':
      burst(v, t, { dur: 0.06, peak: 0.1 * a, type: 'lowpass', f: 260 * k, q: 0.6, a: 0.006, buf: pinkBuf });
      break;
    case 'soft':
      burst(v, t, { dur: 0.07, peak: 0.1 * a, type: 'lowpass', f: 170 * k, q: 0.6, a: 0.01, buf: pinkBuf });
      break;
    default: // wood
      burst(v, t, { dur: 0.04, peak: 0.07 * a, f: 340 * k, q: 1.3 });
      ping(v, t, 150 * k, 0.05, 0.035 * a, 'sine', null, 90);
  }
  return 0.08;
});

def('jump', { g: 1.8 }, (v, t) => {
  burst(v, t, { dur: 0.17, peak: 0.16, f: rnd(380, 460), f1: rnd(1300, 1700), q: 1.3, a: 0.03 });
  ping(v, t, 125, 0.09, 0.14, 'sine', null, 70);
  return 0.2;
});

def('land', { arg: 'impact', gap: 0.05, g: 1.0 }, (v, t, o) => {
  const k = clamp((o.impact === undefined ? 4 : +o.impact) / 12, 0.05, 1);
  ping(v, t, rnd(100, 120), 0.1 + k * 0.08, 0.1 + 0.42 * k, 'sine', null, 48);
  burst(v, t, { dur: 0.07 + k * 0.05, peak: 0.07 + 0.2 * k, type: 'lowpass', f: 300 + 300 * k, q: 0.7, buf: pinkBuf });
  if (k > 0.5) {                                   // claws on a hard landing
    const n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) burst(v, t + rnd(0.004, 0.03), { dur: 0.01, peak: 0.07 * k, f: rnd(3200, 5200), q: 3, a: 0.001 });
  }
  return 0.25;
});

def('swipe', { g: 1.0 }, (v, t) => {
  const dur = rnd(0.1, 0.13), t1 = t + dur + 0.03;
  const n = nz(v, t, t1), f = bq('bandpass', 900, 1.6), g = gn(0);
  ramp(f.frequency, t, dur, [[0, 800], [0.45, rnd(2600, 3200)], [1, 1100]]);
  ramp(g.gain, t, dur, [[0, 0], [0.4, 0.2], [1, 0]]);
  chain(n, f, g, v.out);
  return dur + 0.03;
});

def('bap', { g: 1.5 }, (v, t) => {
  ping(v, t, rnd(210, 250), 0.07, 0.3, 'sine', null, 105);
  burst(v, t, { dur: 0.045, peak: 0.12, type: 'lowpass', f: 700, q: 0.7, buf: pinkBuf });
  return 0.1;
});

def('pounce', { g: 0.6 }, (v, t) => {
  const dur = 0.3, t1 = t + dur + 0.03;
  const n = nz(v, t, t1), f = bq('bandpass', 500, 1.2), g = gn(0);
  ramp(f.frequency, t, dur, [[0, 450], [0.55, rnd(2800, 3400)], [1, 700]]);
  ramp(g.gain, t, dur, [[0, 0], [0.18, 0.2], [0.5, 0.32], [1, 0]]);
  chain(n, f, g, v.out);
  ping(v, t, 180, 0.22, 0.1, 'triangle', null, 520, 0.03);
  ping(v, t, 120, 0.08, 0.16, 'sine', null, 65);
  return 0.35;
});

def('scratch', { arg: 'surface', prio: 0, gap: 0.07, g: 1.0 }, (v, t, o) => {
  // noise raked by a rough saw-shaped amplitude flutter: each tooth is a claw catching a fibre
  const S = { rope: [2700, 1.4, 85, 0.26, 950], fabric: [1900, 0.9, 120, 0.2, 600], carpet: [1150, 0.8, 70, 0.24, 420], wood: [3300, 2.6, 48, 0.2, 720] };
  const s = S[o.surface] || S.rope, dur = rnd(0.13, 0.17), t1 = t + dur + 0.03, k = rnd(0.88, 1.15);
  const n = nz(v, t, t1), f = bq('bandpass', s[0] * k, s[1]), rake = gn(0.55), g = gn(0);
  glide(f.frequency, t, s[0] * k * 1.15, s[0] * k * 0.8, dur);
  const teeth = osc(v, 'sawtooth', s[2] * rnd(0.85, 1.2), t, t1);
  chain(teeth, gn(0.45), rake.gain);
  ramp(g.gain, t, dur, [[0, 0], [0.12, s[3]], [0.7, s[3] * 0.8], [1, 0]]);
  chain(n, f, rake, g, v.out);
  const lo = bq('bandpass', s[4] * k, 1.2), lg = gn(0.35);
  chain(n, lo, lg, rake);
  return dur + 0.03;
});

/* ───────────────────────── prop impacts ───────────────────────── */

function modal(v, t, base, ratios, amps, decs, peak, type) {
  for (let i = 0; i < ratios.length; i++) ping(v, t, base * ratios[i], decs[i], peak * amps[i], type);
}

const HIT = {
  soft(v, t) {
    burst(v, t, { dur: 0.08, peak: 0.3, type: 'lowpass', f: 220, q: 0.6, a: 0.006, buf: pinkBuf });
    ping(v, t, 120, 0.07, 0.2, 'sine', null, 70, 0.005);
    return 0.12;
  },
  boing(v, t) {
    const f = rnd(230, 290), dur = 0.3, t1 = t + dur + 0.03;
    const o = osc(v, 'sine', f, t, t1), g = gn(0), l = osc(v, 'sine', rnd(24, 30), t, t1), lg = gn(0);
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    lg.gain.setValueAtTime(f * 0.22, t); lg.gain.setTargetAtTime(0, t, 0.09);
    chain(l, lg, o.frequency);
    perc(g.gain, t, 0.004, 0.42, dur);
    chain(o, g, v.out);
    ping(v, t, f * 2.02, 0.12, 0.08, 'triangle');
    burst(v, t, { dur: 0.03, peak: 0.12, type: 'lowpass', f: 900, q: 0.7 });
    return 0.35;
  },
  tick(v, t) {
    const f = rnd(2250, 2650);
    burst(v, t, { dur: 0.035, peak: 1.0, f, q: 9, a: 0.001 });
    ping(v, t, f * 1.34, 0.03, 0.14, 'sine');
    burst(v, t, { dur: 0.008, peak: 0.12, type: 'highpass', f: 5000, q: 0.7, a: 0.001 });
    return 0.06;
  },
  jingle(v, t) {
    const b = rnd(2450, 2800), n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const tt = t + (i ? rnd(0.025, 0.11) : 0), a = i ? rnd(0.3, 0.6) : 1;
      modal(v, tt, b * rnd(0.995, 1.005), [1, 1.47, 2.09, 2.56], [0.14, 0.09, 0.056, 0.035], [0.4, 0.3, 0.2, 0.14], a);
    }
    burst(v, t, { dur: 0.01, peak: 0.1, type: 'highpass', f: 6000, q: 0.7, a: 0.001 });
    return 0.5;
  },
  clink(v, t) {
    const b = rnd(1500, 2200);
    modal(v, t, b, [1, 2.32, 3.86, 5.12], [0.3, 0.16, 0.08, 0.04], [0.18, 0.12, 0.07, 0.05], 1);
    burst(v, t, { dur: 0.008, peak: 0.16, type: 'highpass', f: 4000, q: 0.7, a: 0.001 });
    return 0.22;
  },
  thud(v, t) {
    ping(v, t, rnd(140, 170), 0.11, 0.45, 'sine', null, 58);
    burst(v, t, { dur: 0.06, peak: 0.22, type: 'lowpass', f: 420, q: 0.8, buf: pinkBuf });
    return 0.15;
  },
  wood(v, t) {
    const b = rnd(340, 430);
    modal(v, t, b, [1, 2.62, 4.15], [0.4, 0.2, 0.08], [0.09, 0.05, 0.03], 1);
    burst(v, t, { dur: 0.03, peak: 0.25, f: 950, q: 1.5, a: 0.001 });
    return 0.13;
  },
  paper(v, t) {
    burst(v, t, { dur: 0.05, peak: 0.5, f: rnd(2200, 3000), q: 0.7, a: 0.002 });
    burst(v, t + rnd(0.012, 0.03), { dur: 0.04, peak: 0.3, f: rnd(3200, 4500), q: 0.9, a: 0.002 });
    burst(v, t, { dur: 0.04, peak: 0.1, type: 'lowpass', f: 500, q: 0.7 });
    return 0.1;
  },
  metal(v, t) {
    const b = rnd(680, 920);
    modal(v, t, b, [1, 1.48, 2.37, 3.21, 4.62], [0.25, 0.2, 0.14, 0.09, 0.05], [0.55, 0.45, 0.32, 0.22, 0.12], 1);
    burst(v, t, { dur: 0.015, peak: 0.25, f: 3200, q: 1, a: 0.001 });
    return 0.6;
  },
  plastic(v, t) {
    const f = rnd(1050, 1400);
    burst(v, t, { dur: 0.045, peak: 1.0, f, q: 5, a: 0.001 });
    ping(v, t, f * 0.5, 0.05, 0.36, 'triangle', null, f * 0.38);
    return 0.09;
  },
  book(v, t) {
    ping(v, t, rnd(88, 104), 0.12, 0.5, 'sine', null, 50);
    burst(v, t, { dur: 0.09, peak: 0.3, type: 'lowpass', f: 600, q: 0.7, buf: pinkBuf });
    burst(v, t + 0.004, { dur: 0.04, peak: 0.12, f: 2400, q: 0.6 });     // page slap
    return 0.18;
  },
};

def('hit', { arg: 'kind', gap: 0.03, rev: 0.06, dvol: 0.6, g: 1.0 }, (v, t, o) => (HIT[o.kind] || HIT.thud)(v, t));

function shard(v, t, f, peak, dur, type) {   // one fragment that bounces a few times
  let tt = t, gap = rnd(0.07, 0.14), a = peak;
  const n = 2 + ((Math.random() * 3) | 0);
  for (let i = 0; i < n; i++) {
    ping(v, tt, f * rnd(0.99, 1.01), dur, a, type);
    ping(v, tt, f * 1.53, dur * 0.6, a * 0.4, type);
    tt += gap; gap *= 0.62; a *= 0.6;
  }
}

def('smash', { arg: 'kind', gap: 0.08, rev: 0.22, g: 1.0 }, (v, t, o) => {
  const kind = o.kind || 'glass';
  if (kind === 'pot') {
    ping(v, t, 125, 0.16, 0.6, 'sine', null, 52);
    burst(v, t, { dur: 0.1, peak: 0.6, f: 750, q: 0.9, a: 0.001 });
    burst(v, t, { dur: 0.05, peak: 0.3, f: 2200, q: 0.8, a: 0.001 });
    for (let i = 0; i < 8; i++) {
      const tt = t + 0.015 + Math.pow(Math.random(), 1.6) * 0.5, f = rnd(480, 1700);
      ping(v, tt, f, rnd(0.03, 0.07), 0.2 * (1 - (tt - t)), 'triangle');
      burst(v, tt, { dur: 0.02, peak: 0.12, f: f * 1.8, q: 3, a: 0.001 });
    }
    shard(v, t + rnd(0.2, 0.35), rnd(700, 1100), 0.12, 0.05, 'triangle');
    // dirt spilling
    const d = 0.55, n = nz(v, t, t + d + 0.03, null, pinkBuf), f = bq('bandpass', 1000, 0.6), g = gn(0), cr = gn(0.6);
    glide(f.frequency, t, 1100, 420, d);
    ramp(g.gain, t, d, [[0, 0], [0.08, 0.5], [0.4, 0.3], [1, 0]]);
    wob(v, t, t + d + 0.03, 6, 0.4, cr.gain);
    chain(n, f, cr, g, v.out);
    return 1.0;
  }
  const glass = kind !== 'ceramic';
  // the burst
  burst(v, t, { dur: glass ? 0.1 : 0.08, peak: glass ? 0.6 : 0.4, type: 'highpass', f: glass ? 2600 : 1800, q: 0.7, a: 0.001 });
  burst(v, t, { dur: 0.12, peak: 0.5, f: glass ? 1300 : 1000, f1: 600, q: 0.9, a: 0.001 });
  ping(v, t, glass ? 170 : 140, 0.1, 0.35, 'sine', null, 65);
  // fragments scattering, densest at the start
  const N = glass ? 16 : 10, lo = glass ? 2300 : 1100, hi = glass ? 7800 : 3900;
  for (let i = 0; i < N; i++) {
    const dt = 0.012 + -Math.log(1 - Math.random() * 0.96) * (glass ? 0.2 : 0.14), f = rnd(lo, hi);
    const a = (glass ? 0.2 : 0.24) * Math.max(0.15, 1 - dt * 1.1) * rnd(0.5, 1);
    const d = glass ? rnd(0.07, 0.24) : rnd(0.035, 0.1);
    ping(v, t + dt, f, d, a); ping(v, t + dt, f * rnd(1.42, 1.61), d * 0.6, a * 0.5);
    if (!glass) burst(v, t + dt, { dur: 0.015, peak: a * 0.8, f: f * 1.3, q: 3.5, a: 0.001 });
  }
  // falling tinkles: a few pieces bounce and settle
  for (let i = 0; i < 3; i++) shard(v, t + rnd(0.18, 0.55), rnd(lo * 1.1, hi * 0.8), glass ? 0.12 : 0.14, glass ? 0.12 : 0.05);
  return 1.25;
});

/* ───────────────────────── UI ───────────────────────── */

const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

def('pop', { prio: 2, g: 1.3 }, (v, t) => {
  const f = rnd(420, 480);
  ping(v, t, f, 0.11, 0.4, 'sine', null, f * 2.3);
  burst(v, t, { dur: 0.012, peak: 0.08, f: 2500, q: 1, a: 0.001 });
  return 0.14;
});
def('tap', { prio: 2, g: 1.0 }, (v, t) => {
  ping(v, t, rnd(1150, 1250), 0.045, 0.22, 'sine', null, 780);
  burst(v, t, { dur: 0.01, peak: 0.07, f: 3200, q: 1.2, a: 0.001 });
  return 0.07;
});
function panel(v, t, up) {
  const dur = 0.2, t1 = t + dur + 0.03, n = nz(v, t, t1), f = bq('bandpass', 400, 1.1), g = gn(0);
  glide(f.frequency, t, up ? 350 : 2200, up ? 2400 : 300, dur);
  ramp(g.gain, t, dur, up ? [[0, 0], [0.5, 0.16], [1, 0]] : [[0, 0], [0.2, 0.16], [1, 0]]);
  chain(n, f, g, v.out);
  ping(v, t, up ? 330 : 520, 0.16, 0.1, 'sine', null, up ? 620 : 300, 0.03);
  return 0.24;
}
def('open', { prio: 2 }, (v, t) => panel(v, t, true));
def('close', { prio: 2 }, (v, t) => panel(v, t, false));
def('error', { prio: 2, g: 0.5 }, (v, t) => {
  const lp = bq('lowpass', 1200, 0.7); lp.connect(v.out);
  ping(v, t, 330, 0.1, 0.26, 'triangle', lp, 315);
  ping(v, t + 0.1, 247, 0.16, 0.26, 'triangle', lp, 232);
  return 0.3;
});

function sparkle(v, t, n, span, peak) {
  for (let i = 0; i < n; i++) ping(v, t + rnd(0, span), rnd(4200, 8800), rnd(0.05, 0.14), peak * rnd(0.4, 1));
}

def('collect', { arg: 'n', prio: 2, rev: 0.2, g: 0.6 }, (v, t, o) => {
  const n = clamp((+o.n || 0) | 0, 0, 10), f = 880 * Math.pow(2, PENT[n] / 12);
  fm(v, t, f, 0.3, 0.26, 2, 0.7);
  fm(v, t + 0.07, f * 1.5, 0.42, 0.24, 2, 0.6);
  ping(v, t, f * 0.5, 0.12, 0.1, 'triangle');
  sparkle(v, t + 0.03, 3 + Math.min(3, n >> 1), 0.2, 0.05);
  return 0.5;
});

def('combo', { arg: 'n', prio: 2, rev: 0.1, g: 1.0 }, (v, t, o) => {
  const n = clamp((+o.n || 1) | 0, 1, 10), f = 523.25 * Math.pow(2, PENT[n] / 12);
  const lp = bq('lowpass', 4500, 0.7); lp.connect(v.out);
  const p = ping(v, t, f, 0.16, 0.3, 'triangle', lp);
  p.frequency.setValueAtTime(f * 0.75, t); p.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  ping(v, t + 0.02, f * 2, 0.12, 0.09, 'sine');
  if (n >= 5) sparkle(v, t + 0.03, n - 3, 0.15, 0.04);
  return 0.22;
});

function bellNote(v, t, m, dur, peak) {
  const f = mtof(m);
  fm(v, t, f, dur, peak, 2, 0.9);
  ping(v, t, f * 0.5, dur * 0.6, peak * 0.35, 'triangle');
}

def('taskDone', { prio: 2, rev: 0.25, gap: 0.3, g: 0.85 }, (v, t) => {
  const seq = [72, 76, 79, 84];
  for (let i = 0; i < seq.length; i++) bellNote(v, t + i * 0.09, seq[i], 0.4, 0.2);
  const tc = t + 0.42;
  bellNote(v, tc, 84, 0.8, 0.16); bellNote(v, tc + 0.012, 88, 0.8, 0.14); bellNote(v, tc + 0.024, 91, 0.8, 0.12);
  ping(v, tc, mtof(60), 0.6, 0.12, 'sine');
  sparkle(v, tc, 4, 0.3, 0.035);
  return 1.25;
});

def('unlock', { prio: 2, rev: 0.3, gap: 0.5, g: 0.85 }, (v, t) => {
  const seq = [67, 72, 76, 79, 84, 88];
  // rising swell underneath
  const d = 0.6, n = nz(v, t, t + d + 0.03), f = bq('bandpass', 600, 1.2), g = gn(0);
  glide(f.frequency, t, 500, 5000, d);
  ramp(g.gain, t, d, [[0, 0], [0.85, 0.1], [1, 0]]);
  chain(n, f, g, v.out);
  for (let i = 0; i < seq.length; i++) bellNote(v, t + i * 0.085, seq[i], 0.45, 0.17);
  const tc = t + 0.58, ch = [72, 76, 79, 84, 91];
  for (let i = 0; i < ch.length; i++) bellNote(v, tc + i * 0.014, ch[i], 1.3, 0.12);
  ping(v, tc, mtof(48), 1.1, 0.16, 'sine'); ping(v, tc, mtof(36), 0.9, 0.08, 'triangle');
  bellNote(v, tc + 0.3, 96, 0.9, 0.08); bellNote(v, tc + 0.45, 100, 0.8, 0.06);
  sparkle(v, tc, 10, 0.9, 0.04);
  return 2.0;
});

def('piano', { arg: 'note', rev: 0.25, gap: 0.04, g: 0.8 }, (v, t, o) => {
  const n = clamp((+o.note || 0) | 0, 0, 23), f = 261.63 * Math.pow(2, n / 12) * rnd(0.9992, 1.0008);
  const D = 1.7 * Math.pow(261.63 / f, 0.45), A = [1, 0.42, 0.22, 0.1, 0.055, 0.03];
  for (let k = 1; k <= 6; k++) {
    const fk = f * k * Math.sqrt(1 + 0.00045 * k * k);
    ping(v, t, fk, D / (1 + 0.5 * (k - 1)), 0.2 * A[k - 1], 'sine', null, 0, 0.004);
  }
  ping(v, t, f * 1.0028, D * 0.9, 0.08, 'sine', null, 0, 0.004);          // second string, slow beating
  burst(v, t, { dur: 0.02, peak: 0.07, type: 'lowpass', f: 1800, q: 0.6, a: 0.002 });   // felt hammer
  return D + 0.05;
});

/* ───────────────────────── water, food, household ───────────────────────── */

function bubble(v, t, f, peak) { ping(v, t, f, 0.06, peak, 'sine', null, f * rnd(1.6, 2.2), 0.004); }

def('splash', { rev: 0.1, gap: 0.08, g: 1.0 }, (v, t) => {
  burst(v, t, { dur: 0.16, peak: 0.4, f: 900, f1: 500, q: 0.8, a: 0.004 });
  const d = 0.45, n = nz(v, t, t + d + 0.03), hp = bq('highpass', 2200, 0.6), g = gn(0), cr = gn(0.6);
  ramp(g.gain, t, d, [[0, 0], [0.05, 0.3], [0.3, 0.14], [1, 0]]);
  wob(v, t, t + d + 0.03, 8, 0.4, cr.gain);
  chain(n, hp, cr, g, v.out);
  ping(v, t, 150, 0.1, 0.25, 'sine', null, 70);
  for (let i = 0; i < 5; i++) bubble(v, t + rnd(0.04, 0.38), rnd(350, 900), rnd(0.05, 0.12));
  return 0.5;
});

def('lap', { prio: 0, gap: 0.06, g: 1.5 }, (v, t) => {
  bubble(v, t, rnd(480, 640), 0.12);
  burst(v, t + 0.012, { dur: 0.02, peak: 0.05, f: rnd(2200, 3000), q: 1.5, a: 0.002 });
  return 0.09;
});

def('crunch', { prio: 0, gap: 0.08, g: 1.5 }, (v, t) => {
  const n = 3 + ((Math.random() * 3) | 0);
  let tt = t;
  for (let i = 0; i < n; i++) {
    burst(v, tt, { dur: rnd(0.012, 0.022), peak: rnd(0.12, 0.22), f: rnd(1500, 4200), q: 2, a: 0.001 });
    tt += rnd(0.012, 0.03);
  }
  burst(v, t, { dur: 0.05, peak: 0.16, f: rnd(600, 800), q: 1.2, a: 0.002 });
  return 0.14;
});

def('flush', { rev: 0.12, gap: 0.5, g: 0.7 }, (v, t) => {
  const d = 3.0, t1 = t + d + 0.05;
  // handle clunk
  ping(v, t, 190, 0.07, 0.3, 'sine', null, 85);
  burst(v, t, { dur: 0.02, peak: 0.2, f: 1900, q: 3, a: 0.001 });
  // the rush
  const tr = t + 0.07, dr = d - 0.3;
  const n = nz(v, tr, t1), n2 = nz(v, tr, t1, null, pinkBuf);
  const f = bq('bandpass', 700, 0.7), g = gn(0), mix = gn(1);
  ramp(f.frequency, tr, dr, [[0, 600], [0.12, 1150], [0.6, 700], [0.85, 380], [1, 260]]);
  chain(n, gn(0.6), mix); chain(n2, gn(1.6), mix);
  chain(mix, f, g, v.out);
  const hi = bq('highpass', 3200, 0.5), hg = gn(0.22);
  chain(n, hi, hg, g);
  ramp(g.gain, tr, dr, [[0, 0], [0.07, 0.42], [0.5, 0.36], [0.72, 0.26], [0.9, 0.1], [1, 0]]);
  // gurgle as the bowl empties
  const l = osc(v, 'sine', 9, tr, t1), lg = gn(0);
  ramp(l.frequency, tr, dr, [[0, 9], [0.55, 9], [1, 4.5]]);
  ramp(lg.gain, tr, dr, [[0, 0], [0.5, 0], [0.7, 0.14], [0.9, 0.08], [1, 0]]);
  chain(l, lg, g.gain);
  for (let i = 0; i < 6; i++) bubble(v, t + rnd(1.9, 2.75), rnd(220, 480), rnd(0.06, 0.12));
  // refill hiss
  const rh = nz(v, t + 2.2, t1), rf = bq('highpass', 4200, 0.6), rg = gn(0);
  ramp(rg.gain, t + 2.2, 0.8, [[0, 0], [0.3, 0.04], [1, 0]]);
  chain(rh, rf, rg, v.out);
  return 3.1;
});

def('click', { prio: 2, g: 1.0 }, (v, t) => {
  burst(v, t, { dur: 0.012, peak: 0.35, f: rnd(1700, 2100), q: 5, a: 0.0008 });
  burst(v, t + 0.028, { dur: 0.016, peak: 0.25, f: rnd(1200, 1500), q: 4, a: 0.0008 });
  ping(v, t + 0.028, 230, 0.03, 0.14, 'sine', null, 150);
  return 0.08;
});

def('tvOn', { gap: 0.2, g: 0.8 }, (v, t) => {
  ping(v, t, 72, 0.14, 0.4, 'sine', null, 50);
  burst(v, t, { dur: 0.012, peak: 0.2, f: 1500, q: 2, a: 0.001 });
  burst(v, t + 0.02, { dur: 0.3, peak: 0.1, type: 'highpass', f: 3000, q: 0.6, a: 0.03 });         // static bloom
  ping(v, t + 0.02, 5200, 0.4, 0.016, 'sine', null, 11500, 0.05);                                   // flyback whine
  // degauss "bwong"
  const d = 0.42, t1 = t + d + 0.03, o = osc(v, 'sawtooth', 100, t + 0.02, t1), lp = bq('lowpass', 480, 1), g = gn(0);
  const l = osc(v, 'sine', 13, t + 0.02, t1), lg = gn(0.09);
  perc(g.gain, t + 0.02, 0.01, 0.2, d);
  chain(l, lg, g.gain); chain(o, lp, g, v.out);
  return 0.5;
});

def('tvOff', { gap: 0.2, g: 1.0 }, (v, t) => {
  ping(v, t, 950, 0.2, 0.22, 'sine', null, 60);
  ping(v, t, 11000, 0.14, 0.014, 'sine', null, 3000);
  burst(v, t, { dur: 0.012, peak: 0.22, f: 1700, q: 2, a: 0.001 });
  burst(v, t, { dur: 0.09, peak: 0.07, type: 'highpass', f: 3500, q: 0.6 });
  ping(v, t, 65, 0.1, 0.25, 'sine', null, 45);
  return 0.26;
});

def('paperRip', { gap: 0.1, g: 0.7 }, (v, t) => {
  const d = rnd(0.42, 0.55), t1 = t + d + 0.03;
  const n = nz(v, t, t1), f = bq('bandpass', 2600, 0.8), cr = gn(0.45), g = gn(0);
  ramp(f.frequency, t, d, [[0, 2000], [0.6, rnd(3600, 4400)], [1, 2800]]);
  wob(v, t, t1, 22, 0.55, cr.gain);                 // fibres letting go in fits and starts
  ramp(g.gain, t, d, [[0, 0], [0.08, 0.3], [0.6, 0.34], [1, 0]]);
  chain(n, f, cr, g, v.out);
  chain(n, bq('highpass', 6000, 0.6), gn(0.25), cr);
  for (let i = 0; i < 5; i++) burst(v, t + rnd(0, d * 0.9), { dur: 0.025, peak: 0.07, f: rnd(350, 600), q: 2.5, a: 0.002 });  // roll rattling
  return d + 0.05;
});

def('boxRustle', { gap: 0.1, g: 1.0 }, (v, t) => {
  const d = rnd(0.34, 0.45), t1 = t + d + 0.03;
  const n = nz(v, t, t1, null, pinkBuf), f = bq('bandpass', 800, 0.8), cr = gn(0.4), g = gn(0);
  ramp(f.frequency, t, d, [[0, 650], [0.4, 1300], [1, 750]]);
  wob(v, t, t1, 9, 0.6, cr.gain);
  ramp(g.gain, t, d, [[0, 0], [0.15, 0.9], [0.55, 0.7], [1, 0]]);
  chain(n, f, cr, g, v.out);
  for (let i = 0; i < 3; i++) {
    const tt = t + rnd(0, d * 0.8);
    burst(v, tt, { dur: 0.04, peak: 0.2, f: rnd(240, 380), q: 3, a: 0.002 });   // hollow cardboard knocks
  }
  return d + 0.05;
});

def('catch', { rev: 0.18, gap: 0.1, g: 1.0 }, (v, t) => {
  burst(v, t, { dur: 0.035, peak: 0.42, type: 'lowpass', f: 1500, q: 1, a: 0.001 });       // chomp
  ping(v, t, 260, 0.05, 0.22, 'sine', null, 140);
  burst(v, t + 0.055, { dur: 0.03, peak: 0.22, f: 1100, q: 1.5, a: 0.001 });
  const s = [2093, 2637, 3136];
  for (let i = 0; i < 3; i++) fm(v, t + 0.09 + i * 0.055, s[i], 0.26, 0.11, 2, 0.5);
  sparkle(v, t + 0.12, 4, 0.2, 0.04);
  return 0.5;
});

def('zoomies', { rev: 0.2, gap: 0.3, g: 0.85 }, (v, t) => {
  const d = 0.75, t1 = t + d + 0.03, n = nz(v, t, t1), f = bq('bandpass', 300, 1.4), g = gn(0);
  glide(f.frequency, t, 280, 4500, d);
  ramp(g.gain, t, d, [[0, 0], [0.7, 0.22], [0.92, 0.3], [1, 0]]);
  chain(n, f, g, v.out);
  const lp = bq('lowpass', 5000, 0.7); lp.connect(v.out);
  for (let i = 0; i < 9; i++) {
    const m = 60 + PENT[i] + (i > 5 ? 0 : 0);
    ping(v, t + 0.1 + i * 0.058, mtof(m + 12), 0.12, 0.09 + i * 0.012, 'triangle', lp);
  }
  fm(v, t + 0.66, mtof(96), 0.5, 0.16, 2, 0.8);
  sparkle(v, t + 0.62, 7, 0.35, 0.05);
  return 1.2;
});

function breath(v, t, d, f0, f1, peak, flutter) {
  const t1 = t + d + 0.03, n = nz(v, t, t1, null, pinkBuf), f = bq('bandpass', f0, 1.6), g = gn(0), fl = gn(0.8);
  glide(f.frequency, t, f0, f1, d);
  ramp(g.gain, t, d, [[0, 0], [0.35, peak], [0.7, peak * 0.75], [1, 0]]);
  if (flutter) { const l = osc(v, 'triangle', rnd(26, 32), t, t1); chain(l, gn(flutter), fl.gain); }
  chain(n, f, fl, g, v.out);
  return f;
}
def('snoreIn', { prio: 0, gap: 0.2, g: 0.35 }, (v, t) => {
  const d = rnd(0.65, 0.8);
  breath(v, t, d, 420, 760, 1.0, 0.22);
  chain(nz(v, t, t + d), bq('bandpass', 2400, 1), gn(0.006), v.out);
  return d + 0.05;
});
def('snoreOut', { prio: 0, gap: 0.2, g: 0.4 }, (v, t) => {
  const d = rnd(0.85, 1.05);
  breath(v, t, d, 400, 290, 0.8, 0.06);
  // tiny nose whistle
  const o = osc(v, 'sine', 920, t, t + d + 0.03), g = gn(0);
  glide(o.frequency, t, rnd(900, 1000), 700, d);
  ramp(g.gain, t, d, [[0, 0], [0.3, 0.012], [0.8, 0.006], [1, 0]]);
  chain(o, g, v.out);
  return d + 0.05;
});

/* ───────────────────────── birds & vacuum blips ───────────────────────── */

function birdNote(v, t, f0, f1, d, peak) {
  const o = osc(v, 'sine', f0, t, t + d + 0.02), g = gn(0);
  glide(o.frequency, t, f0, f1, d);
  ramp(g.gain, t, d, [[0, 0], [0.2, peak], [0.6, peak * 0.8], [1, 0]]);
  chain(o, g, v.out);
  const h = osc(v, 'sine', f0 * 2, t, t + d + 0.02), hg = gn(0);
  glide(h.frequency, t, f0 * 2, f1 * 2, d);
  ramp(hg.gain, t, d, [[0, 0], [0.2, peak * 0.15], [1, 0]]);
  chain(h, hg, v.out);
}
function birdPhrase(v, t) {
  const style = (Math.random() * 3) | 0, k = rnd(0.85, 1.2);
  let tt = t;
  if (style === 0) {                                // "tweet tweet-tweet"
    const n = 2 + ((Math.random() * 3) | 0), up = chance(0.5);
    for (let i = 0; i < n; i++) {
      const d = rnd(0.07, 0.11);
      birdNote(v, tt, (up ? 3100 : 4700) * k, (up ? 4500 : 3000) * k, d, 0.2);
      tt += d + rnd(0.05, 0.13);
    }
  } else if (style === 1) {                         // trill
    const n = 6 + ((Math.random() * 5) | 0);
    for (let i = 0; i < n; i++) {
      birdNote(v, tt, (i % 2 ? 3700 : 4500) * k, (i % 2 ? 4100 : 4000) * k, 0.035, 0.17);
      tt += 0.055;
    }
    birdNote(v, tt + 0.03, 4200 * k, 3000 * k, 0.14, 0.18);
    tt += 0.2;
  } else {                                          // two-note whistle "fee-bee"
    birdNote(v, tt, 4300 * k, 4150 * k, 0.24, 0.2);
    tt += 0.3;
    birdNote(v, tt, 3550 * k, 3350 * k, 0.3, 0.18);
    tt += 0.32;
    if (chance(0.4)) { birdNote(v, tt + 0.05, 3550 * k, 3300 * k, 0.2, 0.14); tt += 0.28; }
  }
  return tt - t + 0.05;
}
def('birdTweet', { rev: 0.3, gap: 0.2, g: 0.6 }, (v, t) => birdPhrase(v, t));

def('vacuumBump', { gap: 0.1, g: 1.0 }, (v, t) => {
  ping(v, t, 150, 0.1, 0.42, 'sine', null, 68);
  burst(v, t, { dur: 0.05, peak: 0.3, f: 650, q: 3, a: 0.001 });
  burst(v, t + 0.03, { dur: 0.02, peak: 0.1, f: 2100, q: 4, a: 0.001 });     // plastic bumper rattle
  burst(v, t + 0.055, { dur: 0.02, peak: 0.06, f: 1800, q: 4, a: 0.001 });
  return 0.16;
});
def('vacuumBeep', { prio: 2, rev: 0.08, gap: 0.2, g: 0.6 }, (v, t) => {
  const lp = bq('lowpass', 3200, 0.7); lp.connect(v.out);
  const beep = (tt, f) => {
    const o = osc(v, 'square', f, tt, tt + 0.13), g = gn(0);
    ramp(g.gain, tt, 0.11, [[0, 0], [0.08, 0.1], [0.7, 0.1], [1, 0]]);
    chain(o, g, lp);
    ping(v, tt, f, 0.11, 0.1, 'sine');
  };
  beep(t, 880); beep(t + 0.13, 1318.5);
  return 0.3;
});

/* ───────────────────────── loops ───────────────────────── */

function makeLoop(base, build, onLevel) {
  const L = {
    on: false, level: 1, _g: null, _srcs: null, _kill: 0, _applied: -1, _x: null,
    start() {
      L.on = true;
      if (!C) return;
      try {
        if (L._kill) { clearTimeout(L._kill); L._kill = 0; }
        if (!L._g) {
          L._g = gn(0); L._g.connect(loopBus); L._srcs = [];
          L._x = build(L, L._g, C.currentTime) || null;
        }
        L._applied = -1; L.set(L.level);
      } catch (e) { oops(e); }
    },
    stop() {
      L.on = false;
      if (!C || !L._g) return;
      L._g.gain.setTargetAtTime(0, C.currentTime, 0.1);
      if (!L._kill) L._kill = setTimeout(L._teardown, isTest ? 60000 : 800);
    },
    set(level) {
      level = level < 0 ? 0 : level > 1 ? 1 : +level || 0;
      L.level = level;
      if (!C || !L._g || !L.on) return;
      if (Math.abs(level - L._applied) < 0.008 && !(level === 0 && L._applied !== 0)) return;   // no automation spam
      L._applied = level;
      const t = C.currentTime;
      L._g.gain.setTargetAtTime(level * base, t, 0.09);
      if (onLevel) onLevel(L._x, level, t);
    },
    _teardown() {
      L._kill = 0;
      if (!L._g) return;
      for (let i = 0; i < L._srcs.length; i++) { try { L._srcs[i].stop(); } catch (e) { /* not started */ } }
      try { L._g.disconnect(); } catch (e) { /* gone */ }
      L._g = null; L._srcs = null; L._x = null;
    },
  };
  return L;
}
function Lo(L, type, f, t) {
  const o = C.createOscillator();
  if (type === 'cos') o.setPeriodicWave(cosWave); else o.type = type;
  o.frequency.value = f; o.start(t); L._srcs.push(o);
  return o;
}
function Ln(L, buf, t, rate) {
  const s = C.createBufferSource(); s.buffer = buf; s.loop = true;
  if (rate) s.playbackRate.value = rate;
  s.start(t, Math.random() * (buf.duration - 0.05)); L._srcs.push(s);
  return s;
}
function Lw(L, t, rate, depth, param) { const g = gn(depth); chain(Ln(L, wobbleBuf, t, rate), g, param); return g; }

export const loops = {
  // Purr: ~25 Hz pulse train (lowpassed saw) + noise gated at the same rate; a 1.45 s breath cycle
  // makes the inhale slightly faster/brighter than the exhale with a dip at each turnaround.
  purr: makeLoop(0.2, (L, out, t) => {
    const T = 1.45;
    const br = Lo(L, 'sine', 1 / T, t);                 // + inhale, − exhale
    const dip = Lo(L, 'cos', 2 / T, t);                 // peaks at the turnarounds
    const saw = Lo(L, 'sawtooth', 25, t);
    chain(br, gn(1.6), saw.frequency);
    Lw(L, t, 0.3, 0.7, saw.frequency);
    const lp = bq('lowpass', 250, 0.9);
    chain(br, gn(80), lp.frequency);
    const sum = gn(1);
    chain(saw, lp, gn(0.34), sum);
    const gate = gn(0.5);                               // 0..1 at pulse rate
    chain(saw, gn(0.5), gate.gain);
    const nb = bq('bandpass', 380, 0.8);
    chain(br, gn(110), nb.frequency);
    chain(Ln(L, pinkBuf, t), nb, gate);
    chain(gate, gn(3.4), sum);
    const hiG = gn(0.35), hb = bq('bandpass', 1000, 1.1);     // airy part, stronger on the inhale
    chain(br, gn(0.25), hiG.gain);
    chain(Ln(L, whiteBuf, t), hb, hiG, gate);
    const breathG = gn(0.7);
    chain(dip, gn(-0.26), breathG.gain);
    chain(br, gn(0.07), breathG.gain);
    chain(sum, breathG, bq('highpass', 30, 0.5), out);
  }),

  vacuum: makeLoop(0.19, (L, out, t) => {
    const s1 = Lo(L, 'sawtooth', 112, t), s2 = Lo(L, 'sawtooth', 225.3, t), lp = bq('lowpass', 750, 0.8);
    const w = Lw(L, t, 0.12, 3, s1.frequency); w.connect(s2.frequency);
    chain(s1, gn(0.3), lp); chain(s2, gn(0.18), lp); chain(lp, out);
    const n = Ln(L, whiteBuf, t);
    chain(n, bq('bandpass', 1500, 0.6), gn(0.3), out);                 // airflow
    chain(n, bq('bandpass', 5200, 2), gn(0.07), out);
    const wh = Lo(L, 'triangle', 2850, t); Lw(L, t, 0.2, 25, wh.frequency);
    chain(wh, gn(0.014), out);                                          // turbine whine
    const brush = gn(0.5); chain(Lo(L, 'sine', 31, t), gn(0.12), brush.gain);
    chain(n, bq('bandpass', 420, 1.5), brush, gn(0.35), out);           // brush roll flutter
  }),

  fly: makeLoop(0.13, (L, out, t) => {
    const o = Lo(L, 'sawtooth', 205, t), o2 = Lo(L, 'square', 411, t);
    const w1 = Lw(L, t, 1.4, 20, o.frequency), w2 = Lw(L, t, 0.25, 14, o.frequency);
    chain(w1, gn(2), o2.frequency); chain(w2, gn(2), o2.frequency);
    const hp = bq('highpass', 380, 0.7), pk = bq('peaking', 1500, 0.8), amp = gn(0.65);
    pk.gain.value = 8;
    Lw(L, t, 0.9, 0.35, amp.gain);
    chain(o, gn(0.5), hp); chain(o2, gn(0.12), hp);
    chain(hp, pk, bq('lowpass', 5200, 0.6), amp, out);
  }),

  faucet: makeLoop(0.16, (L, out, t) => {
    const n = Ln(L, whiteBuf, t), p = Ln(L, pinkBuf, t);
    chain(n, bq('highpass', 1100, 0.6), bq('bandpass', 3000, 0.45), gn(0.6), out);
    const gb = bq('bandpass', 560, 1.3), gg = gn(0.9);
    Lw(L, t, 1.5, 230, gb.frequency); Lw(L, t, 2.5, 0.6, gg.gain);
    chain(p, gb, gg, out);
    const sp = bq('bandpass', 1500, 2.5), sg = gn(0.25);
    Lw(L, t, 3.2, 600, sp.frequency);
    chain(n, sp, sg, out);                                              // splatter in the basin
  }),

  tvStatic: makeLoop(0.2, (L, out, t) => {
    const p = Ln(L, pinkBuf, t), n = Ln(L, whiteBuf, t);
    const voice = (f, fr, ar, lvl) => {                                 // murmuring "speech" band
      const b = bq('bandpass', f, 2.2), g = gn(0.5);
      Lw(L, t, fr, f * 0.45, b.frequency); Lw(L, t, ar, 0.5, g.gain);
      chain(p, b, g, gn(lvl), out);
    };
    voice(520, 0.55, 0.9, 2.2); voice(1250, 0.7, 1.1, 1.1); voice(2300, 0.5, 0.8, 0.4);
    chain(n, bq('highpass', 4500, 0.5), gn(0.03), out);
    chain(Lo(L, 'sine', 100, t), gn(0.02), out);
  }),

  wind: makeLoop(0.27, (L, out, t) => {
    const p = Ln(L, pinkBuf, t), b = bq('bandpass', 500, 0.9), n = Ln(L, whiteBuf, t);
    Lw(L, t, 0.4, 140, b.frequency);
    const g = gn(0.8); Lw(L, t, 0.3, 0.2, g.gain);
    chain(p, b, g, gn(2.4), out);
    chain(n, bq('highpass', 2500, 0.5), bq('lowpass', 6500, 0.5), gn(0.1), out);
    return b;
  }, (b, level, t) => { if (b) b.frequency.setTargetAtTime(380 + 950 * level, t, 0.12); }),

  ambience: makeLoop(0.045, (L, out, t) => {
    chain(Ln(L, brownBuf, t), bq('lowpass', 240, 0.5), gn(0.55), out);
    chain(Ln(L, pinkBuf, t), bq('bandpass', 1800, 0.3), gn(0.16), out);
    amb.nextBird = t + rnd(2, 6); amb.nextTick = t + rnd(8, 20); amb.ticks = 0;
  }),
};

// ambience events (scheduled by the shared lookahead timer)
const amb = { nextBird: 0, nextTick: 0, ticks: 0 };
function ambienceTick(h) {
  const L = loops.ambience;
  if (!L.on || !L._g || !sfxOn) return;
  const now = C.currentTime, lvl = L.level;
  if (amb.nextBird < now - 0.5) amb.nextBird = now + rnd(1, 5);
  if (amb.nextTick < now - 0.5) { amb.nextTick = now + rnd(5, 20); amb.ticks = 0; }
  while (amb.nextBird < h) {
    // distant bird outside the window: quiet, dulled, wet
    const v = makeVoice(sfxBus, 0.16 * lvl * rnd(0.5, 1), rnd(-0.7, 0.7), sfxSend, 0.9);
    const lp = bq('lowpass', rnd(3200, 4500), 0.5), o = v.out;
    const pre = gn(1); chain(pre, lp, o);
    birdPhrase({ out: pre, last: 0, lastSrc: null, kill: v.kill }, amb.nextBird);
    amb.nextBird += chance(0.35) ? rnd(0.9, 2) : rnd(6, 18);      // sometimes an answering call
  }
  while (amb.nextTick < h) {
    const v = makeVoice(sfxBus, 0.5 * lvl, 0.3, sfxSend, 0.3), tt = amb.nextTick;
    burst(v, tt, { dur: 0.012, peak: 0.05, f: amb.ticks % 2 ? 2300 : 2700, q: 6, a: 0.001 });
    ping(v, tt, 900, 0.02, 0.012, 'sine');
    if (amb.ticks <= 0) amb.ticks = 5 + ((Math.random() * 6) | 0);
    amb.ticks--;
    amb.nextTick += amb.ticks > 0 ? 1 : rnd(25, 60);
  }
}

/* ───────────────────────── composed music: "Cat About the House" theme ───────────────────────── */
//
// One 32-bar tune (A A B A, swung eighths, written in C) played by a single lookahead scheduler.
// The four moods are arrangements of the same tune; a mood change takes effect at the next bar line
// and keeps the place in the form, so the melody carries straight on in the new feel.
//
//   calm     marimba lead, two-feel bass, soft chord + brushes
//   playful  pizzicato + marimba lead, walking bass, off-beat chord stabs, brushes / shaker / kick
//   zoomies  same, much faster, lead doubled an octave up, four-on-the-floor + snare + hats
//   sleepy   music-box lullaby: melody over a soft pad, no bass line, no drums

const MOODS = {
  calm: { bpm: 100, swing: 0.62 }, playful: { bpm: 126, swing: 0.64 },
  zoomies: { bpm: 168, swing: 0.57 }, sleepy: { bpm: 76, swing: 0.58 },
};
const THEME_KEY = 0;            // transpose the whole tune (semitones); 0 = C major
const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteNum(s) {           // 'C#5' → 73
  let pc = NOTE_PC[s[0]], i = 1;
  if (s[i] === '#') { pc++; i++; } else if (s[i] === 'b') { pc--; i++; }
  return 12 * (+s.slice(i) + 1) + pc;
}
// chord → [root pitch class, intervals of the upper voices]
const CHORDS = {
  C6: [0, [4, 7, 9]], C7: [0, [4, 7, 10]], A7: [9, [4, 7, 10]], Dm7: [2, [3, 7, 10]], D7: [2, [4, 7, 10]],
  G7: [7, [4, 7, 10]], F6: [5, [4, 7, 9]], 'F#dim': [6, [3, 6, 9]],
};
// mel: 'E5/1 -/2 ...' (note/length in eighths, '-' = rest, must add up to 8) · bass: four quarter notes
// chords: 'C6' or 'Dm7 G7' (two beats each)
function themeBar(mel, bass, chords, brk) {
  const b = { mel: [], bass: [], ch: [], brk: !!brk, src: mel, chords };
  let pos = 0;
  for (const tok of mel.split(' ')) {
    const p = tok.split('/'), d = +p[1];
    if (p[0] !== '-') b.mel.push([pos, noteNum(p[0]), d]);
    pos += d;
  }
  for (const n of bass.split(' ')) b.bass.push(n === '-' ? 0 : noteNum(n));
  const cs = chords.split(' ');
  for (let i = 0; i < cs.length; i++) {
    const c = CHORDS[cs[i]], notes = [];
    for (const iv of c[1]) { let n = 48 + ((c[0] + iv) % 12); while (n < 55) n += 12; notes.push(n); }   // G3..F#4
    notes.sort((x, y) => x - y);
    b.ch.push({ pos: (i * 8) / cs.length, len: 8 / cs.length, notes, root: 48 + c[0] });
  }
  return b;
}
const HOOK = 'C5/1 E5/1 G5/1 A5/2 G5/1 E5/2';          // up the arpeggio, lean on the off-beat, fall back
const TB = themeBar;
const PHRASE_A = [
  TB(HOOK,                                      'C3 E3 G3 E3',   'C6'),
  TB('C#5/1 E5/1 G5/1 A5/2 G5/1 E5/2',          'A2 C#3 E3 Eb3', 'A7'),        // same shape, one sly semitone up
  TB('F5/3 D5/1 F5/1 A5/1 G5/2',                'D3 F3 A2 Ab2',  'Dm7'),       // answer
  TB('-/1 F5/1 D5/1 B4/2 D5/1 G4/2',            'G2 B2 D3 B2',   'G7'),
  TB('C5/1 E5/1 G5/1 C6/2 A5/1 G5/2',           'C3 E3 G3 E3',   'C6'),        // hook again, reaching higher
  TB('C#5/1 E5/1 G5/1 Bb5/2 A5/1 G5/2',         'A2 C#3 E3 Eb3', 'A7'),
  TB('F5/1 A5/1 G5/1 F5/1 E5/1 D5/1 B4/1 D5/1', 'D3 A2 G2 B2',   'Dm7 G7'),    // tumble home
];
const END_OPEN  = TB('E5/3 G5/1 E5/2 -/2',            'C3 E3 G2 B2',  'C6 G7');   // 1st time: hangs on the third
const END_TO_B  = TB('C5/3 G4/1 C5/2 -/2',            'C3 G2 Bb2 E3', 'C6 C7');   // 2nd time: tonic, leans toward F
const END_LOOP  = TB('C5/3 G4/1 C5/1 G4/1 A4/1 B4/1', 'C3 E3 G2 B2',  'C6 G7');   // last time: tonic + pickup into the loop
const PHRASE_B = [
  TB('A5/3 F5/1 A5/2 C6/2',                     'F2 A2 C3 A2',   'F6'),
  TB('A5/3 F#5/1 A5/2 C6/2',                    'F#2 A2 C3 A2',  'F#dim'),
  TB('G5/3 E5/1 G5/1 E5/1 C5/2',                'G2 C3 E3 Bb2',  'C6'),
  TB('C#5/2 E5/2 G5/1 E5/1 A5/2',               'A2 C#3 E3 C#3', 'A7'),
  TB('F5/3 D5/1 F5/2 A5/2',                     'D3 F3 A2 C3',   'Dm7'),
  TB('F#5/3 D5/1 F#5/2 A5/2',                   'D3 F#3 A2 F#2', 'D7'),
  TB('G5/2 A5/1 B5/2 A5/1 G5/2',                'G2 B2 D3 F3',   'G7'),
  TB('D5/1 -/4 G4/1 A4/1 B4/1',                 'G2 - - B2',     'G7', true),  // stop-time break + pickup
];
const INTRO = TB('-/5 G4/1 A4/1 B4/1', 'G2 B2 D3 B2', 'G7');
const FORM = [].concat(PHRASE_A, [END_OPEN], PHRASE_A, [END_TO_B], PHRASE_B, PHRASE_A, [END_LOOP]);   // 32 bars

const M = {
  playing: false, mood: 'calm', cur: 'calm',
  next: 0,          // audio time of the next eighth-note step
  barT: 0,          // audio time of the current bar line
  step: 0,          // eighth within the bar, 0..7
  bar: -1,          // -1 = intro, then 0..31 through FORM
  live: new Set(),
};
const B = {};   // instrument buses

function buildMusicBuses() {
  const mk = (name, gain, send, pan) => {
    const g = gn(gain);
    let outNode = g;
    if (pan && hasPanner) { const p = C.createStereoPanner(); p.pan.value = pan; g.connect(p); outNode = p; }
    outNode.connect(musicBus);
    if (send > 0) { const s = gn(send); outNode.connect(s); s.connect(musicSend); }
    B[name] = g;
  };
  mk('ep', 1.3, 0.3, -0.15); mk('pad', 0.7, 0.45, 0); mk('box', 0.85, 0.5, 0.15);
  mk('pluck', 1.5, 0.22, 0.25); mk('bass', 0.45, 0, 0); mk('perc', 1.0, 0.1, 0.1); mk('lead', 1.1, 0.35, -0.05);
}

// music voices: per-note gain into an instrument bus; sources are tracked so stopMusic can silence them
function mv(bus) {
  const v = makeVoice(bus, 1, 0, null, 0), kill = v.kill;
  v.kill = () => { M.live.delete(v); kill(); };
  M.live.add(v);
  return v;
}
const mosc = osc;

function epNote(t, m, dur, vel, bus) {
  const f = mtof(m), v = mv(bus || B.ep), t1 = t + dur + 0.6;
  const car = mosc(v, 'sine', f, t, t1), car2 = mosc(v, 'sine', f * 1.003, t, t1);
  const mod = mosc(v, 'sine', f, t, t1), mg = gn(0), g = gn(0);
  const ix = f * (0.5 + vel * 1.8) * Math.min(1, 520 / f);
  mg.gain.setValueAtTime(ix, t); mg.gain.setTargetAtTime(ix * 0.12, t, 0.22);
  chain(mod, mg, car.frequency);
  const tine = mosc(v, 'sine', f * 4, t, t + 0.25), tg = gn(0);          // bright "tine" attack
  perc(tg.gain, t, 0.002, vel * 0.035, 0.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.3, t + 0.006);
  g.gain.setTargetAtTime(vel * 0.05, t + 0.006, Math.max(0.15, dur * 0.4));
  g.gain.setTargetAtTime(0, t + dur, 0.1);
  chain(car, g, v.out); chain(car2, gn(0.5), g); chain(tine, tg, v.out);
}
function padNote(t, m, dur, vel) {
  const f = mtof(m), v = mv(B.pad), t1 = t + dur + 2.2;
  const a = mosc(v, 'triangle', f, t, t1), b = mosc(v, 'triangle', f, t, t1), c = mosc(v, 'sine', f * 2, t, t1);
  a.detune.value = -6; b.detune.value = 7;
  const lp = bq('lowpass', 900, 0.5), g = gn(0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.16, t + Math.min(1.1, dur * 0.4));
  g.gain.setTargetAtTime(0, t + dur, 0.5);
  chain(a, lp); chain(b, lp); chain(c, gn(0.12), lp); chain(lp, g, v.out);
}
function boxNote(t, m, vel) {
  const f = mtof(m), v = mv(B.box);
  ping(v, t, f, 1.5, vel * 0.26, 'sine', null, 0, 0.002);
  ping(v, t, f * 2.0, 0.5, vel * 0.07, 'sine');
  ping(v, t, f * 5.4, 0.12, vel * 0.03, 'sine');
}
function pluckNote(t, m, vel, long) {
  const f = mtof(m), v = mv(B.pluck), d = long ? 0.5 : 0.3, t1 = t + d + 0.03;
  const a = mosc(v, 'triangle', f, t, t1), s = mosc(v, 'sawtooth', f, t, t1);
  const lp = bq('lowpass', f * 6, 1.2), g = gn(0);
  lp.frequency.setValueAtTime(Math.min(9000, f * 7), t); lp.frequency.setTargetAtTime(f * 1.4, t, 0.05);
  perc(g.gain, t, 0.003, vel * 0.34, d);
  chain(a, lp); chain(s, gn(0.35), lp); chain(lp, g, v.out);
}
// marimba-ish bar: fundamental + the tuned 4th-harmonic "knock" + a mallet click
function marimbaNote(t, m, dur, vel) {
  const f = mtof(m), v = mv(B.lead);
  ping(v, t, f, clamp(dur, 0.28, 0.9) + 0.18, vel * 0.3, 'sine', null, 0, 0.003);
  ping(v, t, f * 4, 0.1, vel * 0.075, 'sine');
  ping(v, t, f * 9.2, 0.03, vel * 0.022, 'sine');
}
function bassNote(t, m, dur, vel) {
  const f = mtof(m), v = mv(B.bass), t1 = t + dur + 0.3;
  const a = mosc(v, 'sine', f, t, t1), b = mosc(v, 'triangle', f, t, t1);
  const lp = bq('lowpass', 520, 0.6), g = gn(0);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.42, t + 0.014);
  g.gain.setTargetAtTime(vel * 0.12, t + 0.014, Math.max(0.08, dur * 0.5));
  g.gain.setTargetAtTime(0, t + dur, 0.05);
  chain(a, g); chain(b, gn(0.35), lp); chain(lp, g); g.connect(v.out);
}
function percHit(t, kind, vel) {
  const v = mv(B.perc);
  if (kind === 'brush') {
    burst(v, t, { dur: 0.09, peak: vel * 0.3, f: 3800, q: 0.5, a: 0.008, buf: pinkBuf });
  } else if (kind === 'shaker') {
    burst(v, t, { dur: 0.04, peak: vel * 0.12, type: 'highpass', f: 6500, q: 0.6, a: 0.005 });
  } else if (kind === 'hat') {
    burst(v, t, { dur: 0.03, peak: vel * 0.1, type: 'highpass', f: 8000, q: 0.7, a: 0.001 });
  } else if (kind === 'kick') {
    ping(v, t, 105, 0.16, vel * 0.3, 'sine', null, 44, 0.003);
    burst(v, t, { dur: 0.015, peak: vel * 0.06, type: 'lowpass', f: 1200, q: 0.6, a: 0.001 });
  } else if (kind === 'snare') {
    burst(v, t, { dur: 0.11, peak: vel * 0.22, f: 2600, q: 0.5, a: 0.002 });
    ping(v, t, 210, 0.06, vel * 0.12, 'triangle', null, 150);
  } else { // rim
    burst(v, t, { dur: 0.02, peak: vel * 0.2, f: 1750, q: 5, a: 0.001 });
  }
}

const hum = () => rnd(0, 0.007);          // timing humanisation (only ever late, never before the grid)
const K = (m) => m + THEME_KEY;

function stab(t, ch, dur, vel) {           // short rolled chord on the electric piano
  for (let i = 0; i < ch.notes.length; i++) epNote(t + i * 0.012, K(ch.notes[i]), dur, vel * (0.88 + i * 0.06));
}

// Everything that sounds on one eighth-note step `s` of bar `b`. e = straight eighth length (s), spb = beat length.
function musicStep(t, b, s, barIdx, mood, spb) {
  const e = spb / 2, onBeat = (s & 1) === 0, q = s >> 1;
  let ch = b.ch[0];
  for (let i = 1; i < b.ch.length; i++) if (b.ch[i].pos <= s) ch = b.ch[i];
  const chordStart = ch.pos === s;
  const quiet = b.brk && s > 0;            // stop-time bar: the band drops out under the pickup

  // lead
  for (let i = 0; i < b.mel.length; i++) {
    const n = b.mel[i];
    if (n[0] !== s) continue;
    const m = K(n[1]), d = n[2] * e, acc = s === 3 ? 1 : s === 0 ? 0.95 : onBeat ? 0.86 : 0.78;
    if (mood === 'calm') marimbaNote(t + hum(), m, d * 1.3, 0.66 * acc);
    else if (mood === 'playful') { pluckNote(t, m, 0.72 * acc, n[2] >= 2); marimbaNote(t, m, d, 0.4 * acc); }
    else if (mood === 'zoomies') { pluckNote(t, m + 12, 0.56 * acc, false); pluckNote(t, m, 0.5 * acc, n[2] >= 2); marimbaNote(t, m, d, 0.34 * acc); }
    else boxNote(t + hum() * 2, m + 12, 0.62 * acc);
  }

  if (mood === 'sleepy') {
    if (chordStart) {
      const d = ch.len * e - 0.2;
      for (let i = 0; i < ch.notes.length; i++) padNote(t + i * 0.05, K(ch.notes[i]), d, 0.5);
      padNote(t, K(ch.root), d, 0.5);
    }
    return;
  }

  // bass: two-feel when calm, walking quarters otherwise
  if (onBeat && b.bass[q]) {
    if (mood === 'calm') { if (q === 0 || q === 2) bassNote(t, K(b.bass[q]), spb * 1.5, q === 0 ? 0.72 : 0.6); }
    else bassNote(t + (q ? hum() : 0), K(b.bass[q]), spb * 0.82, q === 0 ? 0.8 : q === 2 ? 0.72 : 0.64);
  }
  if (quiet) {
    if (mood === 'zoomies' && s >= 4) percHit(t, 'snare', 0.3 + (s - 4) * 0.09);    // roll into the last A
    else if (mood === 'playful' && s === 4) percHit(t, 'rim', 0.4);
    return;
  }

  if (mood === 'calm') {
    if (chordStart) stab(t, ch, ch.len * e * 0.8, 0.24);
    if (s === 2 || s === 6) percHit(t + hum(), 'brush', 0.34);
  } else if (mood === 'playful') {
    if (s === 2 || s === 6) stab(t + hum(), ch, 0.14, s === 2 ? 0.36 : 0.31);        // "oom-CHA"
    if (s === 0 || s === 4) percHit(t, 'kick', 0.46);
    if (s === 2 || s === 6) percHit(t + hum(), 'brush', 0.6);
    if (onBeat) percHit(t + hum(), 'shaker', 0.3);
    else if (s === 3 || s === 7) percHit(t + hum(), 'shaker', 0.42);                 // ride skip-note
    if (s === 7 && barIdx % 4 === 3) percHit(t, 'rim', 0.36);
  } else { // zoomies
    if (s === 2 || s === 6) stab(t, ch, 0.12, 0.36);
    else if (s === 3) stab(t, ch, 0.1, 0.24);
    if (onBeat) percHit(t, 'kick', s === 0 ? 0.75 : 0.62);
    if (s === 2 || s === 6) percHit(t, 'snare', 0.6);
    percHit(t + hum(), 'hat', onBeat ? 0.45 : 0.72);
    if (barIdx % 8 === 7 && (s === 5 || s === 7)) percHit(t, 'snare', 0.4);          // phrase-end fill
  }
}

const stepOffset = (s, spb, swing) => ((s >> 1) + ((s & 1) ? swing : 0)) * spb;

function musicTick(h) {
  if (!M.playing) return;
  const now = C.currentTime;
  if (M.next < now - 0.08) {                                 // timers were throttled / tab was hidden: resync
    const shift = now + 0.06 - M.next;
    M.next += shift; M.barT += shift;
  }
  let guard = 0;
  while (M.next < h && guard++ < 64) {
    if (M.step === 0) M.cur = M.mood;                        // mood changes land on the bar line
    const mo = MOODS[M.cur], spb = 60 / mo.bpm;
    musicStep(M.next, M.bar < 0 ? INTRO : FORM[M.bar], M.step, M.bar, M.cur, spb);
    if (++M.step >= 8) {
      M.step = 0; M.barT += 4 * spb; M.next = M.barT;
      if (++M.bar >= FORM.length) M.bar = 0;
    } else M.next = M.barT + stepOffset(M.step, spb, mo.swing);
  }
}

function startMusic() {
  if (!C || M.playing) return;
  const t = C.currentTime;
  M.playing = true;
  M.cur = M.mood; M.step = 0; M.bar = -1; M.barT = M.next = t + 0.12;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setTargetAtTime(MUSIC_LEVEL, t, 0.25);
  musicSend.gain.cancelScheduledValues(t);
  musicSend.gain.setTargetAtTime(1, t, 0.25);
  if (!suspended) startTimer();
}

function stopMusic() {
  if (!C || !M.playing) return;
  M.playing = false;
  const t = C.currentTime;
  musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(0, t, 0.07);
  musicSend.gain.cancelScheduledValues(t); musicSend.gain.setTargetAtTime(0, t, 0.07);
  // cut every sounding / pre-scheduled note once the fade is done, so nothing returns on a quick re-enable
  M.live.forEach((v) => { v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(0, t, 0.06); });
}

export const music = {
  setMood(m) { if (MOODS[m]) M.mood = m; },
  get mood() { return M.mood; },
};

/* ───────────────────────── test hooks ───────────────────────── */

// Point the module at an (Offline)AudioContext. Pass null to return to the un-initialised state.
export function __setContextForTest(ctx) {
  stopTimer();
  for (const k in loops) { const L = loops[k]; if (L._kill) clearTimeout(L._kill); L._kill = 0; L._g = null; L._srcs = null; L._x = null; L.on = false; L.level = 1; }
  M.playing = false; M.live.clear(); M.mood = 'calm';
  voiceEnds.length = 0; lastPlay.clear();
  stats.played = stats.dropped = stats.rateLimited = stats.errors = 0; stats.lastError = '';
  sfxOn = true; musicOn = false; masterVol = 1; suspended = false;
  C = ctx || null; isTest = !!ctx;
  if (C) buildGraph();
}
// Run the lookahead schedulers (music + ambience) synchronously up to `seconds` ahead (offline rendering).
export function __pumpForTest(seconds) {
  if (!C) return;
  const h = C.currentTime + seconds;
  for (let i = 0; i < 100 && M.playing && M.next < h; i++) musicTick(h);
  ambienceTick(h);
}
export function __stats() { return { played: stats.played, dropped: stats.dropped, rateLimited: stats.rateLimited, errors: stats.errors, lastError: stats.lastError, voices: C ? activeVoices(C.currentTime) : 0, liveMusic: M.live.size }; }
// The composed tune, for tests / inspection.
export function __theme() { return { key: THEME_KEY, moods: MOODS, form: FORM, intro: INTRO, pos: { bar: M.bar, step: M.step, mood: M.cur } }; }
