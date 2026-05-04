// lib/sounds.ts
// Fun synthesised UI sound effects via the Web Audio API.
// No audio files — all sounds are generated procedurally so there is nothing
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
// Implementation note — why a persistent shared AudioContext:
//   On Firefox for Android (and some other mobile browsers) every new
//   AudioContext starts in the 'suspended' state even when created inside a
//   user-gesture handler.  The previous design created a fresh AudioContext per
//   sound and called ctx.close() immediately after scheduling nodes.  That
//   caused ctx.close() to cancel the still-pending ctx.resume(), silently
//   killing all audio.
//
//   The fix: one module-level AudioContext that is created on first use, awaits
//   ctx.resume() before scheduling any nodes, and is never closed.  This is
//   also cheaper — no create/GC overhead per sound.

import { useRef, useCallback } from "react";

// ─── Shared AudioContext ──────────────────────────────────────────────────────

let _sharedCtx: AudioContext | null = null;

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
 *     quantum (64–512 samples = ~1–12 ms depending on hardware and browser).
 *     Scheduling at ctx.currentTime + 0 means the events land in a block the
 *     audio thread has already processed, so they are silently dropped or
 *     rendered at the end-of-ramp value (→ inaudible).
 *
 *  2. async getCtx() adds at least one microtask bounce even when the context
 *     is already running, introducing ~0–2 ms of additional JS overhead.
 *
 * 30 ms is comfortably larger than any realistic render quantum and adds only
 * an imperceptible pre-delay before the sound starts.
 */
const LOOKAHEAD = 0.030;

// ─── Low-level synthesis helpers ─────────────────────────────────────────────

type OscType = OscillatorType;

interface ToneOptions {
  type?: OscType;
  freq: number;
  endFreq?: number;   // glide target (if different from freq)
  gain?: number;      // 0–1, default 0.18
  attack?: number;    // seconds, default 0.005
  decay?: number;     // seconds, default 0.08
  start?: number;     // seconds offset from now, default 0
}

/** Play a single tone with optional frequency glide and fade-out. */
function tone(ctx: AudioContext, opts: ToneOptions): void {
  const {
    type = "sine",
    freq,
    endFreq = freq,
    gain = 0.18,
    attack = 0.010,  // 10 ms — long enough to prevent onset pops on non-zero-phase oscillators
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
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.01);
}

/** Tiny burst of noise shaped like a click. */
function noiseClick(ctx: AudioContext, start = 0, gain = 0.06): void {
  // Always schedule in the future (see LOOKAHEAD note above).
  const t0 = ctx.currentTime + LOOKAHEAD + start;
  const ATTACK = 0.003;   // 3 ms ramp — avoids the instantaneous gain jump that causes onset pops
  const DURATION = 0.030; // 30 ms total — long enough to be audible even with some timing jitter

  const bufSize = Math.floor(ctx.sampleRate * DURATION);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const gainNode = ctx.createGain();
  // Ramp up from 0 instead of jumping instantly — eliminates the onset pop.
  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(gain, t0 + ATTACK);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + DURATION);

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 400; // lowered from 800 Hz — more body, more audible

  src.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

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
  // Cheerful ascending arpeggio: C–E–G–C (major)
  const freqs = [523.25, 659.25, 784, 1046.5];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.15, attack: 0.01, decay: 0.22, start: i * 0.08 });
  });
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
  noiseClick(ctx, 0, 0.12); // gain raised — click must be clearly audible on its own
}

async function playPop(): Promise<void> {
  const ctx = await getCtx();
  if (!ctx) return;
  // Short sine blip
  tone(ctx, { type: "sine", freq: 660, endFreq: 440, gain: 0.12, attack: 0.005, decay: 0.08 });
}

// ─── Sound maps ───────────────────────────────────────────────────────────────

/** @internal Async raw play functions — used by the sound-test diagnostic page. */
export const RAW_SOUND_MAP: Record<SoundName, () => Promise<void>> = {
  send: playSend,
  receive: playReceive,
  error: playError,
  menuOpen: playMenuOpen,
  menuClose: playMenuClose,
  sparkle: playSparkle,
  accept: playAccept,
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
