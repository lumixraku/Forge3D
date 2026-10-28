// Original cute background track for the promo video, synthesized from scratch
// (no samples, no third-party audio). Deterministic: same output every run.
// Usage: node promo/music.mjs [out.wav]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'music.wav');
const SR = 44100, DUR = 27, N = SR * DUR;
const BEAT = 0.5, BAR = BEAT * 4, EIGHTH = BEAT / 2; // 120 BPM
const L = new Float32Array(N), R = new Float32Array(N);
const echoL = new Float32Array(N), echoR = new Float32Array(N); // send bus for melody / bells

// Seeded PRNG so noise-based drums are identical every render.
let seed = 1234567;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

// Adds a voice to the mix. fn(t) returns the mono sample at local time t.
function add(t0, len, fn, { gain = 1, pan = 0, send = 0 } = {}) {
  const s0 = Math.max(0, Math.floor(t0 * SR)), s1 = Math.min(N, Math.floor((t0 + len) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s0; i < s1; i++) {
    const v = fn(i / SR - t0);
    L[i] += v * gl; R[i] += v * gr;
    if (send) { echoL[i] += v * gl * send; echoR[i] += v * gr * send; }
  }
}
const attack = (t, a = 0.004) => Math.min(1, t / a);

// ---------- instruments ----------
const pluck = (f, decay = 7) => (t) => attack(t) * Math.exp(-t * decay) * (Math.sin(TAU * f * t) + 0.45 * Math.sin(TAU * 2 * f * t) * Math.exp(-t * 6) + 0.15 * Math.sin(TAU * 3 * f * t) * Math.exp(-t * 10));
const bell = (f) => (t) => attack(t, 0.002) * (Math.sin(TAU * f * t) * Math.exp(-t * 3.5) + 0.35 * Math.sin(TAU * 2.76 * f * t) * Math.exp(-t * 7) + 0.15 * Math.sin(TAU * 5.4 * f * t) * Math.exp(-t * 12));
const bass = (f) => (t) => attack(t, 0.01) * Math.exp(-t * 3) * (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t));
const kick = () => (t) => Math.exp(-t * 18) * Math.sin(TAU * (50 * t + 70 * (1 - Math.exp(-t * 30)) / 30));
// Noise with a one-pole high-pass so it sounds like a light shaker / snap.
function noiseVoice(decay, hp = 0.9) {
  let prev = 0, prevOut = 0;
  return (t) => { const x = rand() * 2 - 1; const y = hp * (prevOut + x - prev); prev = x; prevOut = y; return y * Math.exp(-t * decay); };
}
// Rising then falling filtered noise for transitions.
function whoosh(len) {
  let lp = 0;
  return (t) => { const u = t / len; const env = Math.sin(Math.PI * Math.min(1, u)) ** 2; const k = 0.04 + 0.5 * env; lp += k * ((rand() * 2 - 1) - lp); return lp * env; };
}
const pop = () => (t) => Math.exp(-t * 35) * Math.sin(TAU * (380 * t + 900 * t * t * 8));
const tick = () => (t) => Math.exp(-t * 120) * Math.sin(TAU * 2400 * t);

// ---------- song ----------
// C - G - Am - F, the classic bright loop.
const CHORDS = [[60, 64, 67], [55, 59, 62, 67], [57, 60, 64], [53, 57, 60, 65]];
const ROOTS = [36, 43, 45, 41];
// Melody in eighth notes per bar (null = rest), two 4-bar phrases.
const MELODY = [
  [72, null, 76, 79, 76, null, 74, 72], [74, null, 71, 74, 79, null, 77, 74],
  [72, null, 76, 81, 79, null, 76, 72], [77, 76, 74, 72, 74, null, null, null],
  [79, null, 76, 79, 84, null, 81, 79], [74, 76, 77, 79, 77, null, 74, 71],
  [72, 76, 79, 81, 79, null, 76, 74], [77, 79, 81, 79, 76, null, 72, null],
];
const BARS = 12; // 0..24s, then a final cadence that rings out

for (let b = 0; b < BARS; b++) {
  const t0 = b * BAR, ch = CHORDS[b % 4];
  // Arpeggio on every eighth, up an octave, gently panned left.
  const arp = [0, 1, 2, 1, 2, 1, 0, 1].map((i) => ch[i % ch.length] + 12);
  arp.forEach((m, i) => add(t0 + i * EIGHTH, 0.6, pluck(midi(m), 9), { gain: b === 0 ? 0.09 : 0.11, pan: -0.35 }));
  if (b === 0) continue; // intro bar: arpeggio + sparkle only
  add(t0, BAR, bass(midi(ROOTS[b % 4])), { gain: 0.32 });
  add(t0 + 2 * BEAT, BAR / 2, bass(midi(ROOTS[b % 4] + 7)), { gain: 0.18 });
  if (b >= 2) {
    for (let k = 0; k < 4; k++) {
      if (k === 0 || k === 2) add(t0 + k * BEAT, 0.3, kick(), { gain: 0.42 });
      if (k === 1 || k === 3) add(t0 + k * BEAT, 0.15, noiseVoice(28, 0.6), { gain: 0.16, pan: 0.1 });
    }
    for (let e = 0; e < 8; e++) add(t0 + e * EIGHTH, 0.06, noiseVoice(70, 0.95), { gain: e % 2 ? 0.05 : 0.03, pan: 0.4 });
    const mel = MELODY[(b - 2) % 8];
    mel.forEach((m, i) => { if (m != null) add(t0 + i * EIGHTH, 0.9, pluck(midi(m), 4.5), { gain: 0.2, pan: 0.25, send: 0.5 }); });
  }
}
// Final cadence at 24s: a C chord strum plus a bell run, ringing to the end.
const END = BARS * BAR;
[48, 60, 64, 67, 72].forEach((m, i) => add(END + i * 0.03, 3, pluck(midi(m), 1.6), { gain: 0.16, pan: (i - 2) * 0.15 }));
add(END, 3, bass(midi(36)), { gain: 0.3 });
[84, 88, 91, 96].forEach((m, i) => add(END + 0.25 + i * 0.12, 2.5, bell(midi(m)), { gain: 0.1, pan: 0.3, send: 0.6 }));

// ---------- sound effects synced to the video (times from forge3d-shark-demo.html) ----------
[3.8, 13.6, 19.0, 24.4].forEach((c) => add(c - 0.35, 0.7, whoosh(0.7), { gain: 0.5 }));
// Pops: title, step titles, node callouts, cards, outro.
[0.6, 1.1, 4.0, 7.5, 8.0, 8.6, 9.2, 9.8, 10.4, 13.7, 14.1, 14.85, 15.6, 16.35, 17.4, 19.1, 20.4, 21.0, 24.8, 25.2]
  .forEach((p, i) => add(p, 0.12, pop(), { gain: 0.14, pan: i % 2 ? 0.2 : -0.2 }));
// Mouse clicks: Run and Download model.
[12.7, 23.6].forEach((c) => add(c, 0.05, tick(), { gain: 0.35 }));
// Sparkle on the title and on the "every result" banner.
[[0.9, 88], [1.05, 91], [1.2, 96], [17.4, 84], [17.55, 88], [17.7, 91]]
  .forEach(([t, m]) => add(t, 1.5, bell(midi(m)), { gain: 0.07, pan: 0.3, send: 0.4 }));

// ---------- echo bus: dotted-eighth ping-pong ----------
const D = Math.floor(EIGHTH * 1.5 * SR);
for (let i = D; i < N; i++) { echoL[i] += echoR[i - D] * 0.38; echoR[i] += echoL[i - D] * 0.38; }
for (let i = 0; i < N; i++) { L[i] += echoL[i] * 0.35; R[i] += echoR[i] * 0.35; }

// ---------- master: fades, normalize, soft clip, 16-bit WAV ----------
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = Math.min(1, t / 0.4) * Math.min(1, (DUR - t) / 1.5);
  L[i] *= g; R[i] *= g;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.85 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.tanh(L[i] * norm) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.tanh(R[i] * norm) * 32767), 46 + i * 4);
}
fs.writeFileSync(out, buf);
console.log(`wrote ${out} (${DUR}s, peak before normalize ${peak.toFixed(2)})`);
