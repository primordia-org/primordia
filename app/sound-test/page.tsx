"use client";

// app/sound-test/page.tsx
// Soundboard with full audio diagnostics:
//   • Browser / AudioContext support check
//   • Live AudioContext state display
//   • Real-time oscilloscope fed by a persistent shared AudioContext
//   • "Test Tone" button to prove the audio pipeline end-to-end
//   • Per-sound buttons that surface errors instead of swallowing them

import { useState, useEffect, useRef, useCallback } from "react";
import { RAW_SOUND_MAP, type SoundName } from "@/lib/sounds";

// ─── Types ────────────────────────────────────────────────────────────────────

type CtxState = "running" | "suspended" | "closed" | "unavailable" | "unknown";

interface DiagInfo {
  supported: boolean;
  stateOnCreate: CtxState;
  error?: string;
  userAgent: string;
}

type ButtonStatus = "idle" | "ok" | "error";
interface SoundStatus { status: ButtonStatus; error?: string }

// ─── Sound catalogue ──────────────────────────────────────────────────────────

interface SoundEntry {
  name: SoundName;
  emoji: string;
  label: string;
  description: string;
}

const SOUNDS: SoundEntry[] = [
  { name: "send",      emoji: "📤", label: "Send",       description: "Upward triangle sweep + noise click. Sent message." },
  { name: "receive",   emoji: "📥", label: "Receive",    description: "Two-note chime (C5 → E5). AI response finished." },
  { name: "error",     emoji: "❌", label: "Error",      description: "Descending sawtooth buzz. API / network error." },
  { name: "menuOpen",  emoji: "☰",  label: "Menu Open",  description: "Soft pop + upward sine tick. Hamburger opened." },
  { name: "menuClose", emoji: "✕",  label: "Menu Close", description: "Downward sine tick + noise click. Hamburger closed." },
  { name: "sparkle",   emoji: "✨", label: "Sparkle",    description: "Three ascending tones. Evolve session submitted." },
  { name: "accept",    emoji: "✅", label: "Accept",     description: "C–E–G–C major arpeggio. Session accepted." },
  { name: "agentDone", emoji: "🧠", label: "Agent Done", description: "A–C♯–E–A (A major) arpeggio, 350 ms decay. Agent finished, session ready." },
  { name: "reject",    emoji: "🗑️", label: "Reject",     description: "Descending minor-third tones. Session rejected." },
  { name: "click",     emoji: "👆", label: "Click",      description: "Short noise burst. Generic button click." },
  { name: "pop",       emoji: "🔔", label: "Pop",        description: "Brief sine blip. Generic notification." },
];

// ─── Oscilloscope canvas ──────────────────────────────────────────────────────

function Oscilloscope({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    function drawIdle() {
      animRef.current = requestAnimationFrame(drawIdle);
      if (!canvas) return;
      ctx2d!.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d!.fillStyle = "#111827";
      ctx2d!.fillRect(0, 0, canvas.width, canvas.height);
      // flat line
      ctx2d!.strokeStyle = "#374151";
      ctx2d!.lineWidth = 1.5;
      ctx2d!.beginPath();
      ctx2d!.moveTo(0, canvas.height / 2);
      ctx2d!.lineTo(canvas.width, canvas.height / 2);
      ctx2d!.stroke();
    }

    if (!analyser) {
      drawIdle();
      return () => cancelAnimationFrame(animRef.current);
    }

    const bufLen = analyser.fftSize;
    const dataArray = new Float32Array(bufLen);

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      if (!canvas || !analyser) return;
      analyser.getFloatTimeDomainData(dataArray);

      // Compute RMS for colour tinting
      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += dataArray[i] ** 2;
      const rms = Math.sqrt(sum / bufLen);
      const level = Math.min(1, rms * 8); // 0–1

      const W = canvas.width;
      const H = canvas.height;
      ctx2d!.clearRect(0, 0, W, H);
      ctx2d!.fillStyle = "#111827";
      ctx2d!.fillRect(0, 0, W, H);

      // Colour: green when quiet → yellow → cyan when loud
      const r = Math.round(level * 100);
      const g = Math.round(200 + level * 55);
      const b = Math.round(level * 200);
      ctx2d!.strokeStyle = `rgb(${r},${g},${b})`;
      ctx2d!.lineWidth = 2;
      ctx2d!.beginPath();

      const sliceWidth = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = dataArray[i]; // –1 to +1
        const y = (v * (H / 2) * 0.9) + H / 2;
        if (i === 0) ctx2d!.moveTo(x, y);
        else ctx2d!.lineTo(x, y);
        x += sliceWidth;
      }
      ctx2d!.stroke();
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={72}
      className="w-full rounded-lg border border-gray-700"
      aria-label="Audio oscilloscope"
    />
  );
}

// ─── Diagnostics card ─────────────────────────────────────────────────────────

function DiagCard({ diag }: { diag: DiagInfo | null }) {
  if (!diag) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-xs text-gray-500 animate-pulse">
        Checking audio environment…
      </div>
    );
  }

  const stateColor: Record<CtxState, string> = {
    running:     "text-green-400",
    suspended:   "text-yellow-400",
    closed:      "text-red-400",
    unavailable: "text-red-400",
    unknown:     "text-gray-400",
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "AudioContext",
      value: diag.supported
        ? <span className="text-green-400">✅ Supported</span>
        : <span className="text-red-400">❌ Not supported — your browser cannot play synthesised audio</span>,
    },
    {
      label: "State on create",
      value: (
        <span className={stateColor[diag.stateOnCreate]}>
          {diag.stateOnCreate === "running"
            ? "✅ running"
            : diag.stateOnCreate === "suspended"
            ? "⚠️ suspended (normal on Firefox/Android/Safari — sounds.ts awaits resume() before scheduling)"
            : diag.stateOnCreate}
        </span>
      ),
    },
    {
      label: "Browser",
      value: <span className="text-gray-300 break-all">{diag.userAgent}</span>,
    },
  ];

  if (diag.error) {
    rows.push({
      label: "Init error",
      value: <span className="text-red-400 font-mono break-all">{diag.error}</span>,
    });
  }

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden text-xs">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex gap-3 px-4 py-2 border-b border-gray-800 last:border-0">
          <span className="text-gray-500 w-32 flex-shrink-0">{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SoundTestPage() {
  const [diag, setDiag] = useState<DiagInfo | null>(null);
  const [statuses, setStatuses] = useState<Partial<Record<SoundName, SoundStatus>>>({});
  const [ctxLiveState, setCtxLiveState] = useState<CtxState>("unknown");

  // Shared persistent AudioContext for the oscilloscope
  const sharedCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // ── Run diagnostics on mount ──────────────────────────────────────────────
  useEffect(() => {
    const ua = navigator.userAgent;
    // Simplify UA to browser + OS
    const simplified = (() => {
      const m =
        ua.match(/\(([^)]+)\)/) ?? [];
      const os = m[1]?.split(";")[0] ?? "";
      if (ua.includes("Chrome/"))   return `Chrome ${ua.match(/Chrome\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Firefox/"))  return `Firefox ${ua.match(/Firefox\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Safari/") && !ua.includes("Chrome")) return `Safari ${ua.match(/Version\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Edg/"))      return `Edge ${ua.match(/Edg\/(\S+)/)?.[1] ?? ""} (${os})`;
      return ua.slice(0, 80);
    })();

    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) {
        setDiag({ supported: false, stateOnCreate: "unavailable", userAgent: simplified });
        return;
      }
      const ctx = new AC();
      const state = ctx.state as CtxState;
      void ctx.close();
      setDiag({ supported: true, stateOnCreate: state, userAgent: simplified });
    } catch (e) {
      setDiag({ supported: false, stateOnCreate: "unknown", error: String(e), userAgent: simplified });
    }
  }, []);

  // ── Create / destroy shared context ──────────────────────────────────────
  const initSharedCtx = useCallback(() => {
    if (sharedCtxRef.current && sharedCtxRef.current.state !== "closed") return;
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      if (ctx.state === "suspended") void ctx.resume();

      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.8;
      an.connect(ctx.destination);

      sharedCtxRef.current = ctx;
      analyserRef.current = an;
      setCtxLiveState(ctx.state as CtxState);
      setAnalyser(an);

      ctx.addEventListener("statechange", () => {
        setCtxLiveState(ctx.state as CtxState);
      });
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    return () => {
      analyserRef.current?.disconnect();
      void sharedCtxRef.current?.close();
    };
  }, []);

  // ── Play test tone through shared context (proves pipeline works) ─────────
  function playTestTone() {
    initSharedCtx();
    const ctx = sharedCtxRef.current;
    const an = analyserRef.current;
    if (!ctx || !an) return;
    if (ctx.state === "suspended") void ctx.resume();

    const t0 = ctx.currentTime;
    const freqs = [440, 554.37, 659.25, 880]; // A4-C#5-E5-A5

    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0 + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.18, t0 + i * 0.1 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.1 + 0.35);

      osc.connect(gain);
      gain.connect(an); // → analyser → destination
      osc.start(t0 + i * 0.1);
      osc.stop(t0 + i * 0.1 + 0.36);
    });
  }

  // ── Play a named sound and capture errors ─────────────────────────────────
  async function playSound(name: SoundName) {
    initSharedCtx(); // ensure oscilloscope shared ctx is live
    setStatuses((prev) => ({ ...prev, [name]: { status: "idle" } }));
    try {
      await RAW_SOUND_MAP[name]();
      setStatuses((prev) => ({ ...prev, [name]: { status: "ok" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatuses((prev) => ({ ...prev, [name]: { status: "error", error: msg } }));
    }
  }

  const statusColor: Record<ButtonStatus, string> = {
    idle: "text-gray-500",
    ok:   "text-green-400",
    error:"text-red-400",
  };

  return (
    <main className="min-h-dvh bg-gray-950 text-gray-100 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Title */}
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">🔊 Sound Effects</h1>
          <p className="text-gray-400 text-sm">
            All sounds are synthesised via the Web Audio API — no audio files.
            Diagnostics below help debug why you might not hear anything.
          </p>
        </div>

        {/* ── Diagnostics ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Diagnostics</h2>
          <DiagCard diag={diag} />
          {analyser && (
            <div className="mt-1.5 flex items-center gap-2 text-xs">
              <span className="text-gray-600">Shared context:</span>
              <span className={ctxLiveState === "running" ? "text-green-400" : "text-yellow-400"}>
                {ctxLiveState}
              </span>
            </div>
          )}
        </section>

        {/* ── Oscilloscope + test tone ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Oscilloscope
          </h2>
          <Oscilloscope analyser={analyser} />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={playTestTone}
              className="px-4 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 active:scale-95 text-white text-sm font-medium transition-all"
            >
              ▶ Play Test Tone
            </button>
            <span className="text-xs text-gray-500">
              Routes through the oscilloscope — if you see the waveform move but hear nothing,
              check your system / tab volume.
            </span>
          </div>
          {!analyser && (
            <p className="mt-2 text-xs text-yellow-500">
              ⚠ Oscilloscope inactive — click any button to initialise the shared AudioContext.
            </p>
          )}
        </section>

        {/* ── Sound buttons ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Sounds
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Each button calls the raw async play function so errors surface inline rather than
            being silently swallowed. All sounds share one persistent AudioContext that is
            resumed before scheduling, fixing silent playback on Firefox Android and Safari.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SOUNDS.map(({ name, emoji, label, description }) => {
              const s = statuses[name];
              return (
                <div key={name} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => playSound(name)}
                    className="text-left flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-700 hover:border-gray-500 hover:bg-gray-800 active:scale-[0.97] transition-all duration-100 group"
                  >
                    <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{emoji}</span>
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-sm text-white">
                        {label}
                        <code className="ml-2 text-xs font-mono text-gray-500">
                          sounds.{name}()
                        </code>
                      </span>
                      <span className="text-xs text-gray-500 leading-snug">{description}</span>
                    </span>
                  </button>
                  {/* Status line */}
                  {s && s.status !== "idle" && (
                    <p className={`text-xs px-1 ${statusColor[s.status]}`}>
                      {s.status === "ok"
                        ? "✓ played without error"
                        : `✗ error: ${s.error}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <p className="text-xs text-gray-700">
          Source: <code className="font-mono">lib/sounds.ts</code>
        </p>
      </div>
    </main>
  );
}
