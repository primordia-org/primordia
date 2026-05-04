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

import { useRef, useCallback } from "react";

// ─── Low-level helpers ───────────────────────────────────────────────────────

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  // Safari still uses the webkit prefix in some older versions
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  // Safari sometimes starts AudioContexts in 'suspended' state even during a
  // user-gesture handler. Call resume() unconditionally — it's a no-op when
  // already running and fixes silent playback on Safari.
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

type OscType = OscillatorType;

interface ToneOptions {
  type?: OscType;
  freq: number;
  endFreq?: number;        // glide target (if different from freq)
  gain?: number;           // 0–1, default 0.18
  attack?: number;         // seconds, default 0.005
  decay?: number;          // seconds, default 0.08
  start?: number;          // seconds offset from now, default 0
}

/** Play a single tone with optional frequency glide and fade-out. */
function tone(ctx: AudioContext, opts: ToneOptions): void {
  const {
    type = "sine",
    freq,
    endFreq = freq,
    gain = 0.18,
    attack = 0.005,
    decay = 0.08,
    start = 0,
  } = opts;

  const t0 = ctx.currentTime + start;

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
  const t0 = ctx.currentTime + start;
  const bufSize = Math.floor(ctx.sampleRate * 0.02);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf;

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, t0);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);

  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 800;

  src.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  src.start(t0);
  src.stop(t0 + 0.025);
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

function playSend(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Upward whoosh: triangle sweep 200 → 600 Hz
  tone(ctx, { type: "triangle", freq: 200, endFreq: 600, gain: 0.14, decay: 0.12 });
  noiseClick(ctx, 0.02, 0.04);
  ctx.close();
}

function playReceive(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Pleasant two-note chime: C5 then E5
  tone(ctx, { type: "sine", freq: 523.25, gain: 0.16, attack: 0.01, decay: 0.25, start: 0 });
  tone(ctx, { type: "sine", freq: 659.25, gain: 0.14, attack: 0.01, decay: 0.3, start: 0.12 });
  ctx.close();
}

function playError(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Descending buzzy sweep
  tone(ctx, { type: "sawtooth", freq: 350, endFreq: 140, gain: 0.1, attack: 0.01, decay: 0.25 });
  tone(ctx, { type: "sawtooth", freq: 280, endFreq: 110, gain: 0.08, attack: 0.01, decay: 0.2, start: 0.05 });
  ctx.close();
}

function playMenuOpen(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Soft pop + tiny upward tick
  noiseClick(ctx, 0, 0.05);
  tone(ctx, { type: "sine", freq: 440, endFreq: 520, gain: 0.08, attack: 0.005, decay: 0.06, start: 0 });
  ctx.close();
}

function playMenuClose(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Soft downward tick
  tone(ctx, { type: "sine", freq: 500, endFreq: 380, gain: 0.07, attack: 0.005, decay: 0.06 });
  noiseClick(ctx, 0, 0.03);
  ctx.close();
}

function playSparkle(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Three ascending sparkle tones
  const freqs = [880, 1108, 1320];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.12, attack: 0.01, decay: 0.18, start: i * 0.07 });
  });
  ctx.close();
}

function playAccept(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Cheerful ascending arpeggio: C–E–G–C (major)
  const freqs = [523.25, 659.25, 784, 1046.5];
  freqs.forEach((f, i) => {
    tone(ctx, { type: "sine", freq: f, gain: 0.15, attack: 0.01, decay: 0.22, start: i * 0.08 });
  });
  ctx.close();
}

function playReject(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Descending minor third: A3 → F#3
  tone(ctx, { type: "triangle", freq: 220, gain: 0.12, attack: 0.01, decay: 0.2, start: 0 });
  tone(ctx, { type: "triangle", freq: 185, gain: 0.1, attack: 0.01, decay: 0.25, start: 0.15 });
  tone(ctx, { type: "triangle", freq: 156, gain: 0.08, attack: 0.01, decay: 0.3, start: 0.32 });
  ctx.close();
}

function playClick(): void {
  const ctx = getCtx();
  if (!ctx) return;
  noiseClick(ctx, 0, 0.07);
  ctx.close();
}

function playPop(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Short sine blip
  tone(ctx, { type: "sine", freq: 660, endFreq: 440, gain: 0.12, attack: 0.005, decay: 0.08 });
  ctx.close();
}

// ─── React hook ───────────────────────────────────────────────────────────────

/** @internal Raw play functions — exported for the sound-test diagnostic page only. */
export const RAW_SOUND_MAP: Record<SoundName, () => void> = {
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

const SOUND_MAP: Record<SoundName, () => void> = {
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

/**
 * Returns stable callbacks for each sound effect.
 * All functions are no-ops on the server (no AudioContext available).
 * Sounds are played immediately when called; each call creates and immediately
 * closes a fresh AudioContext so there is no long-lived object to manage.
 */
export function useSounds(): SoundEffects {
  // Wrap each play function in a stable useCallback so callers can safely put
  // them in dependency arrays without triggering re-renders.
  const stableRef = useRef<SoundEffects | null>(null);
  if (!stableRef.current) {
    // Build once, reuse for the lifetime of the component.
    stableRef.current = Object.fromEntries(
      (Object.entries(SOUND_MAP) as [SoundName, () => void][]).map(([name, fn]) => [
        name,
        () => {
          try { fn(); } catch { /* never crash the UI over a sound */ }
        },
      ])
    ) as SoundEffects;
  }
  // useCallback isn't needed here because stableRef.current is only created
  // once; just expose the object directly.
  const get = useCallback(() => stableRef.current!, []);
  return get();
}
