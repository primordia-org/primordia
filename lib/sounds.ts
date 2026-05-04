// lib/sounds.ts
// Fun synthesised UI sound effects via the Web Audio API.
// No audio files - all sounds are generated procedurally so there is nothing
// to download and no CORS headaches.
//
// Usage:
//   import { useSounds } from "@/lib/sounds";
//   const sounds = useSounds();
//   sounds.send();          // user sent a message
//   sounds.receive();       // AI response finished
//   sounds.error();         // something went wrong
//   sounds.menuOpen();      // hamburger opened
//   sounds.menuClose();     // hamburger closed
//   sounds.sparkle();       // evolve dialog opened / session started
//   sounds.accept();        // session accepted 🎉
//   sounds.reject();        // session rejected 😢
//   sounds.click();         // generic button click
//   sounds.pop();           // generic pop / notification
//
// Implementation note - why a persistent shared AudioContext:
//   On Firefox for Android (and some other mobile browsers) every new
//   AudioContext starts in the 'suspended' state even when created inside a
//   user-gesture handler.  The previous design created a fresh AudioContext per
//   sound and called ctx.close() immediately after scheduling nodes.  That
//   caused ctx.close() to cancel the still-pending ctx.resume(), silently
//   killing all audio.
//
//   The fix: one module-level AudioContext that is created on first use, awaits
//   ctx.resume() before scheduling any nodes, and is never closed.  This is
//   also cheaper - no create/GC overhead per sound.

import { useRef, useCallback } from "react";

// ─── Shared AudioContext ──────────────────────────────────────────────────────

let _sharedCtx: AudioContext | null = null;

/**
 * Optional AnalyserNode attached by the /sound-test page.
 * When set, all tone() and noiseClick() outputs route through it so the
 * oscilloscope visualises every sound - not just the test tone.
 * Must be on the same AudioContext as _sharedCtx.
 */
let _analyser: AnalyserNode | null = null;

/**
 * Attach or detach an AnalyserNode from the sounds output chain.
 * The caller is responsible for connecting the node to ctx.destination.
 * Pass null to revert all sounds to connecting directly to ctx.destination.
 */
export function setSharedAnalyser(an: AnalyserNode | null): void {
  _analyser = an;
}

/**
 * Initialise (and resume) the shared AudioContext, then return it.
 * Exported so the /sound-test page can create an AnalyserNode on the same
 * context before any sound plays.  Must be called from a user-gesture handler
 * or an async function that originates from one.
 */
export async function initAndGetSharedCtx(): Promise<AudioContext | null> {
  return getCtx();
}

/**
 * Returns the shared AudioContext, creating and resuming it if necessary.
 * Must only be called from a browser environment (i.e. inside an event handler
 * or useEffect, never at module load time).
 */
async function getCtx(): Promise<AudioContext | null> {
  if (typeof window === "undefined") return null;

  // Reuse the existing context if it is still usable.
  if (_sharedCtx) {
    if (_sharedCtx.state === "closed") {
      _sharedCtx = null; // recreate below
    } else {
      if (_sharedCtx.state === "suspended") await _sharedCtx.resume();
      return _sharedCtx;
    }
  }

  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  _sharedCtx = new AC();
  // Mobile browsers (Firefox Android, older Safari) start new AudioContexts
  // in 'suspended' even inside a user-gesture handler.  Awaiting resume()
  // ensures ctx.currentTime is advancing before any nodes are scheduled.
  if (_sharedCtx.state === "suspended") await _sharedCtx.resume();
  return _sharedCtx;
}

// ─── Scheduling constant ─────────────────────────────────────────────────────

/**
 * All audio is scheduled this many seconds in the future relative to
 * ctx.currentTime.  This is necessary because:
 *
 *  1. The audio rendering thread runs ahead of the JS thread by one render
 *     quantum (64-512 samples = ~1-12 ms depending on hardware and browser).
 *     Scheduling at ctx.currentTime + 0 means the events land in a block the
 *     audio thread has already processed, so they are silently dropped or
 *     rendered at the end-of-ramp value (→ inaudible).
 *
 *  2. async getCtx() adds at least one microtask bounce even when the context
 *     is already running, introducing ~0-2 ms of additional JS overhead.
 *
 * 30 ms is comfortably larger than any realistic render quantum and adds only
 * an imperceptible pre-delay before the sound starts.
 */
const LOOKAHEAD = 0.060;

// ─── Low-level synthesis helpers ─────────────────────────────────────────────

type OscType = OscillatorType;

interface ToneOptions {
  type?: OscType;
  freq: number;
  endFreq?: number;   // glide target (if different from freq)
  gain?: number;      // 0-1, default 0.18
  attack?: number;    // seconds to ramp from 0 to peak, default 0.010
  sustain?: number;   // seconds held at peak gain before decaying, default 0
  decay?: number;     // seconds from peak to near-silence, default 0.08
  start?: number;     // seconds offset from now, default 0
}

/** Play a single tone with optional frequency glide and fade-out. */
function tone(ctx: AudioContext, opts: ToneOptions): void {
  const {
    type = "sine",
    freq,
    endFreq = freq,
    gain = 0.18,
    attack = 0.010,  // 10 ms - long enough to prevent onset pops on non-zero-phase oscillators
    sustain = 0,     // seconds held at peak gain before decaying (default: begin decay immediately)
    decay = 0.08,
    start = 0,
  } = opts;

  // Always schedule in the future (see LOOKAHEAD note above).
  const t0 = ctx.currentTime + LOOKAHEAD + start;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== freq) {
    osc.frequency.linearRampToValueAtTime(endFreq, t0 + decay);
  }

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(gain, t0 + attack);
  // Web Audio holds the last automation value after the attack ramp ends, so
  // the gain stays at `gain` from t0+attack until the exponential decay begins.
  // This implicit hold IS the sustain phase — no extra setValueAtTime needed.
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + sustain + decay);

  osc.connect(gainNode);
  // Route through the shared analyser when the sound-test page has attached one;
  // otherwise connect directly to the hardware output.
  gainNode.connect(_analyser ?? ctx.destination);

  osc.start(t0);
  osc.stop(t0 + attack + sustain + decay + 0.01);
}

/**
 * Generate a blue-noise AudioBuffer of the requested duration.
 * Blue noise is produced by first-order differentiation of white noise, which
 * boosts high frequencies while still being normalisable to [-1, 1].
 */
function makeBlueNoiseBuf(ctx: AudioContext, durationSec: number): AudioBuffer {
  const bufSize = Math.floor(ctx.sampleRate * durationSec);
  const buf  = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let prev = 0, peak = 0;
  for (let i = 0; i < bufSize; i++) {
    const w = Math.random() * 2 - 1;
    data[i] = w - prev;
    prev = w;
    if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
  }
  // Normalise with a little headroom so we don't clip downstream.
  if (peak > 0) for (let i = 0; i < bufSize; i++) data[i] /= peak * 1.2;
  return buf;
}

/**
 * Blue-noise click: bandpass-filtered blue noise for a focused, crisp "tick".
 * Used by the standalone click sound.
 */
function blueNoiseClick(ctx: AudioContext, start = 0, gain = 0.10): void {
  const t0 = ctx.currentTime + LOOKAHEAD + start;
  const ATTACK   = 0.003;
  const DURATION = 0.030;

  const src = ctx.createBufferSource();
  src.buffer = makeBlueNoiseBuf(ctx, DURATION);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(gain, t0 + ATTACK);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + DURATION);

  // Bandpass centred at 1 kHz: bright enough to be a click, narrow enough not to be harsh.
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1000;
  filter.Q.value = 1.8;

  src.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(_analyser ?? ctx.destination);
  src.start(t0);
  src.stop(t0 + DURATION + 0.01);
}

/**
 * Short burst of blue noise used as a secondary accent in send / menuClose etc.
 * Uses a highpass filter (open, airy) rather than the bandpass used by the
 * standalone click sound.
 */
function noiseClick(ctx: AudioContext, start = 0, gain = 0.06): void {
  const t0 = ctx.currentTime + LOOKAHEAD + start;
  const ATTACK   = 0.003;
  const DURATION = 0.030;

  const src = ctx.createBufferSource();
  src.buffer = makeBlueNoiseBuf(ctx, DURATION);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(gain, t0 + ATTACK);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + DURATION);

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 400;

  src.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(_analyser ?? ctx.destination);

  src.start(t0);
  src.stop(t0 + DURATION + 0.01);
}

// ─── Individual sound effects ─────────────────────────────────────────────────

export type SoundName =
  | "send"
  | "receive"
  | "error"
  | "menuOpen"
  | "menuClose"
  | "sparkle"
  | "accept"
  | "agentDone"
  | "deploy"
  | "merge"
  | "reject"
  | "click"
  | "pop";

/** The object returned by useSounds(). Each key is a callable sound. */
export type SoundEffects = Record<SoundName, () => void>;

async function playSend(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Upward whoosh: triangle sweep 200 → 600 Hz
  tone(ctx, { type: "triangle", freq: 200, endFreq: 600, gain: 0.14, decay: 0.12 });
  noiseClick(ctx, 0.02, 0.04);
}

async function playReceive(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Pleasant two-note chime: C5 then E5
  tone(ctx, { type: "sine", freq: 523.25, gain: 0.16, attack: 0.01, decay: 0.25, start: 0 });
  tone(ctx, { type: "sine", freq: 659.25, gain: 0.14, attack: 0.01, decay: 0.3, start: 0.12 });
}

async function playError(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Descending buzzy sweep
  tone(ctx, { type: "sawtooth", freq: 350, endFreq: 140, gain: 0.1, attack: 0.01, decay: 0.25 });
  tone(ctx, { type: "sawtooth", freq: 280, endFreq: 110, gain: 0.08, attack: 0.01, decay: 0.2, start: 0.05 });
}

async function playMenuOpen(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Soft pop + tiny upward tick
  noiseClick(ctx, 0, 0.05);
  tone(ctx, { type: "sine", freq: 440, endFreq: 520, gain: 0.08, attack: 0.005, decay: 0.06, start: 0 });
}

async function playMenuClose(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Soft downward tick
  tone(ctx, { type: "sine", freq: 500, endFreq: 380, gain: 0.07, attack: 0.005, decay: 0.06 });
  noiseClick(ctx, 0, 0.03);
}

async function playSparkle(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Three ascending sparkle tones
  const freqs = [880, 1108, 1320];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.12, attack: 0.01, decay: 0.18, start: i * 0.07 });
  });
}

async function playAccept(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Cheerful ascending arpeggio: C-E-G-C (major)
  const freqs = [523.25, 659.25, 784, 1046.5];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.15, attack: 0.01, decay: 0.22, start: i * 0.08 });
  });
}

async function playAgentDone(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // A major arpeggio: A4-C♯5-E5-A5 - the same progression as the /sound-test
  // oscilloscope test tone, which the user approved for this slot.
  // Longer decay (0.35 s) and wider note spacing (0.1 s) than the accept
  // arpeggio, giving it a more open, "work complete" character.
  const freqs = [440, 554.37, 659.25, 880];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.18, attack: 0.01, decay: 0.35, start: i * 0.1 });
  });
}

async function playDeploy(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  //
  // Rhythm: "Taaaa  ta  Daaaa!"
  //
  // Reference: 120 BPM → one 16th note = 0.125 s
  // Beat subdivisions: 1  e  &  a  |  2  e  &  a
  // Onsets:            *           *  *
  //                    └─ "Taaaa"  ┘  └─ "ta"
  //                 held 3×16th    held 1×16th
  //                                         └─ chord blooms here
  //
  const S = 0.125; // one 16th note at 120 BPM

  // ── "Taaaa" (beat "1", t=0) ──────────────────────────────
  // C5+G5 open fifth sustained through "1 e &" (3 × 16th = 375 ms).
  // sustain = 3S − attack − tiny gap so the note clears before "ta" strikes.
  tone(ctx, { type: "triangle", freq: 523.25, gain: 0.22, attack: 0.005, sustain: 3 * S - 0.020, decay: 0.05, start: 0 }); // C5
  tone(ctx, { type: "triangle", freq: 784,    gain: 0.17, attack: 0.005, sustain: 3 * S - 0.020, decay: 0.05, start: 0 }); // G5
  noiseClick(ctx, 0.01, 0.07); // snare accent on the "1"

  // ── "ta" (beat "a", t = 3S = 375 ms) ────────────────────────
  // Same C5+G5, held through "a" (1 × 16th = 125 ms).
  const T2 = 3 * S; // 0.375 s
  tone(ctx, { type: "triangle", freq: 523.25, gain: 0.19, attack: 0.005, sustain: 1 * S - 0.020, decay: 0.05, start: T2 });
  tone(ctx, { type: "triangle", freq: 784,    gain: 0.15, attack: 0.005, sustain: 1 * S - 0.020, decay: 0.05, start: T2 });

  // ── "Daaaa!" (beat "2", t = 4S = 500 ms) ────────────────────
  // Full C major chord across four octaves with staggered entry (0–50 ms)
  // so the chord swells open like a real brass section.
  const B = 4 * S; // 0.500 s
  tone(ctx, { type: "triangle", freq: 261.63, gain: 0.10, attack: 0.030, decay: 0.90, start: B + 0.00 }); // C4 bass
  tone(ctx, { type: "sine",     freq: 392,    gain: 0.09, attack: 0.025, decay: 0.85, start: B + 0.01 }); // G4
  tone(ctx, { type: "triangle", freq: 523.25, gain: 0.14, attack: 0.020, decay: 0.80, start: B + 0.00 }); // C5
  tone(ctx, { type: "sine",     freq: 659.25, gain: 0.11, attack: 0.020, decay: 0.78, start: B + 0.03 }); // E5
  tone(ctx, { type: "triangle", freq: 784,    gain: 0.12, attack: 0.015, decay: 0.75, start: B + 0.01 }); // G5
  tone(ctx, { type: "sine",     freq: 1046.5, gain: 0.11, attack: 0.015, decay: 0.70, start: B + 0.05 }); // C6 shimmer
  noiseClick(ctx, B, 0.08); // cymbal crash on the bloom
}

async function playMerge(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Two voices sweeping toward C5 from opposite sides - evocative of two
  // branches converging - then a clean C major chord settles in place.
  tone(ctx, { type: "sine", freq: 659.25, endFreq: 523.25, gain: 0.12, attack: 0.01, decay: 0.20, start: 0.00 }); // E5→C5
  tone(ctx, { type: "sine", freq: 392,    endFreq: 523.25, gain: 0.12, attack: 0.01, decay: 0.20, start: 0.00 }); // G4→C5
  // Resolution chord:
  tone(ctx, { type: "sine", freq: 523.25, gain: 0.14, attack: 0.01, decay: 0.30, start: 0.18 }); // C5
  tone(ctx, { type: "sine", freq: 659.25, gain: 0.10, attack: 0.01, decay: 0.28, start: 0.18 }); // E5
  tone(ctx, { type: "sine", freq: 784,    gain: 0.09, attack: 0.01, decay: 0.26, start: 0.18 }); // G5
}

async function playReject(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Descending minor third: A3 → F#3
  tone(ctx, { type: "triangle", freq: 220, gain: 0.12, attack: 0.01, decay: 0.2, start: 0 });
  tone(ctx, { type: "triangle", freq: 185, gain: 0.1, attack: 0.01, decay: 0.25, start: 0.15 });
  tone(ctx, { type: "triangle", freq: 156, gain: 0.08, attack: 0.01, decay: 0.3, start: 0.32 });
}

async function playClick(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Blue-noise bandpass: crispier than a sine pluck, not as harsh as white-noise highpass.
  blueNoiseClick(ctx, 0, 0.10);
}

async function playPop(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Short sine blip
  tone(ctx, { type: "sine", freq: 660, endFreq: 440, gain: 0.12, attack: 0.005, decay: 0.08 });
}

// ─── Sound maps ───────────────────────────────────────────────────────────────

/** @internal Async raw play functions - used by the sound-test diagnostic page. */
export const RAW_SOUND_MAP: Record<SoundName, () => Promise<void>> = {
  send: playSend,
  receive: playReceive,
  error: playError,
  menuOpen: playMenuOpen,
  menuClose: playMenuClose,
  sparkle: playSparkle,
  accept: playAccept,
  agentDone: playAgentDone,
  deploy: playDeploy,
  merge: playMerge,
  reject: playReject,
  click: playClick,
  pop: playPop,
};

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Returns stable callbacks for each sound effect.
 * All functions are no-ops on the server (no AudioContext available).
 * Each call schedules audio on the shared persistent AudioContext; errors are
 * silently swallowed so a broken audio environment never crashes the UI.
 */
export function useSounds(): SoundEffects {
  const stableRef = useRef<SoundEffects | null>(null);
  if (!stableRef.current) {
    stableRef.current = Object.fromEntries(
      (Object.entries(RAW_SOUND_MAP) as [SoundName, () => Promise<void>][]).map(([name, fn]) => [
        name,
        () => { void fn().catch(() => { /* never crash the UI over a sound */ }); },
      ])
    ) as SoundEffects;
  }
  const get = useCallback(() => stableRef.current!, []);
  return get();
}
