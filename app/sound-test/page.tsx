"use client";

// app/sound-test/page.tsx
// Soundboard with full audio diagnostics:
//   • Browser / AudioContext support check
//   • Live oscilloscope - taps the lib/sounds.ts singleton so EVERY sound
//     button animates the waveform, not just the dedicated test tone
//   • Per-sound buttons that surface errors instead of swallowing them

import { useState, useEffect, useRef } from "react";
import {
  RAW_SOUND_MAP,
  setSharedAnalyser,
  initAndGetSharedCtx,
  type SoundName,
} from "@/lib/sounds";

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
  { name: "send",      emoji: "📤", label: "Send",
    description: "Triangle glide 200→600 Hz + blue-noise accent at 20 ms. Sent message." },
  { name: "receive",   emoji: "📥", label: "Receive",
    description: "Sine chime: C5 at 0 ms then E5 at 120 ms. AI response finished." },
  { name: "error",     emoji: "❌", label: "Error",
    description: "Dual sawtooth descend: 350→140 Hz and 280→110 Hz offset by 50 ms. API / network error." },
  { name: "menuOpen",  emoji: "☰",  label: "Menu Open",
    description: "Blue-noise burst + sine tick sweeping 440→520 Hz. Menu opened." },
  { name: "menuClose", emoji: "✕",  label: "Menu Close",
    description: "Sine tick sweeping 500→380 Hz + blue-noise burst. Menu closed." },
  { name: "sparkle",   emoji: "✨", label: "Sparkle",
    description: "Three ascending sines at 880, 1108, 1320 Hz, 70 ms apart. Session submitted." },
  { name: "accept",    emoji: "✅", label: "Accept",
    description: "C5–E5–G5–C6 major arpeggio, sine, 80 ms spacing, 220 ms decay." },
  { name: "agentDone",  emoji: "🧠", label: "Agent Done",
    description: "A4–C♯5–E5–A5 (A major) arpeggio, sine, 100 ms spacing, 350 ms decay. Agent finished." },
  { name: "agentError", emoji: "😨", label: "Agent Error",
    description: "A5–F♯5–D♯5 descend (minor thirds, 130 ms apart) then leap up to C6. Suspenseful, unresolved." },
  { name: "deploy",    emoji: "🚀", label: "Deploy",
    description: '"Taaaa ta Daaaa!" at 120 BPM: C5+G5 triangle held 3 sixteenths, same held 1 sixteenth, then full triangle C major chord C4–G4–C5–E5–G5–C6 with cymbal crash.' },
  { name: "merge",     emoji: "🔀", label: "Merge",
    description: "E5→C5 and G4→C5 sweep simultaneously (converging branches), then C5+E5+G5 chord settles." },
  { name: "reject",    emoji: "🗑️", label: "Reject",
    description: '"GOOD bye": E5+G4 sine chord together, then C4 alone rings out (450 ms decay). Cheerful dismissal.' },
  { name: "click",     emoji: "👆", label: "Click",
    description: "Blue noise through 1 kHz bandpass (Q=1.8), 30 ms. Generic button click." },
  { name: "pop",       emoji: "🔔", label: "Pop",
    description: "Sine glide 660→440 Hz, 80 ms decay. Generic notification." },
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
      ctx2d!.fillStyle = "#111827";
      ctx2d!.fillRect(0, 0, canvas.width, canvas.height);
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

      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += dataArray[i] ** 2;
      const level = Math.min(1, Math.sqrt(sum / bufLen) * 8);

      const W = canvas.width;
      const H = canvas.height;
      ctx2d!.fillStyle = "#111827";
      ctx2d!.fillRect(0, 0, W, H);

      const r = Math.round(level * 100);
      const g = Math.round(200 + level * 55);
      const b = Math.round(level * 200);
      ctx2d!.strokeStyle = `rgb(${r},${g},${b})`;
      ctx2d!.lineWidth = 2;
      ctx2d!.beginPath();

      const sliceWidth = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const y = (dataArray[i] * (H / 2) * 0.9) + H / 2;
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
        Checking audio environment...
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
        : <span className="text-red-400">❌ Not supported</span>,
    },
    {
      label: "State on create",
      value: (
        <span className={stateColor[diag.stateOnCreate]}>
          {diag.stateOnCreate === "running"
            ? "✅ running"
            : diag.stateOnCreate === "suspended"
            ? "⚠️ suspended (normal on Firefox/Android/Safari - sounds.ts awaits resume() before scheduling)"
            : diag.stateOnCreate}
        </span>
      ),
    },
    { label: "Browser", value: <span className="text-gray-300 break-all">{diag.userAgent}</span> },
  ];

  if (diag.error) {
    rows.push({ label: "Init error", value: <span className="text-red-400 font-mono break-all">{diag.error}</span> });
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
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // ── Diagnostics on mount ───────────────────────────────────────────────────
  useEffect(() => {
    const ua = navigator.userAgent;
    const simplified = (() => {
      const os = (ua.match(/\(([^)]+)\)/) ?? [])[1]?.split(";")[0] ?? "";
      if (ua.includes("Chrome/"))  return `Chrome ${ua.match(/Chrome\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Firefox/")) return `Firefox ${ua.match(/Firefox\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Safari/") && !ua.includes("Chrome")) return `Safari ${ua.match(/Version\/(\S+)/)?.[1] ?? ""} (${os})`;
      if (ua.includes("Edg/"))     return `Edge ${ua.match(/Edg\/(\S+)/)?.[1] ?? ""} (${os})`;
      return ua.slice(0, 80);
    })();

    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) { setDiag({ supported: false, stateOnCreate: "unavailable", userAgent: simplified }); return; }
      const ctx = new AC();
      const state = ctx.state as CtxState;
      void ctx.close();
      setDiag({ supported: true, stateOnCreate: state, userAgent: simplified });
    } catch (e) {
      setDiag({ supported: false, stateOnCreate: "unknown", error: String(e), userAgent: simplified });
    }
  }, []);

  // ── Set up analyser on the sounds.ts singleton ─────────────────────────────
  // The analyser is attached to the same AudioContext all sounds use, so every
  // tone() and noiseClick() call routes through it → oscilloscope reacts.
  const setupAnalyser = async () => {
    if (analyserRef.current) return; // already done
    try {
      const ctx = await initAndGetSharedCtx();
      if (!ctx || analyserRef.current) return;

      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.8;
      // Analyser sits between all sounds and the hardware output:
      // tone/noiseClick → gainNode → analyser → destination
      an.connect(ctx.destination);

      setSharedAnalyser(an);   // tell sounds.ts to route all output through it
      analyserRef.current = an;
      setAnalyser(an);
      setCtxLiveState(ctx.state as CtxState);

      ctx.addEventListener("statechange", () => {
        setCtxLiveState(ctx.state as CtxState);
      });
    } catch { /* silently ignore */ }
  };

  // Try on mount (works on desktop; may be a no-op on mobile until first click)
  useEffect(() => {
    void setupAnalyser();
    return () => {
      // Detach on unmount so the sounds routing goes back to ctx.destination
      if (analyserRef.current) {
        setSharedAnalyser(null);
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Play a named sound and capture errors ──────────────────────────────────
  async function playSound(name: SoundName) {
    await setupAnalyser(); // ensure analyser exists before sound plays
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

        <div>
          <h1 className="text-2xl font-bold text-white mb-1">🔊 Sound Effects</h1>
          <p className="text-gray-400 text-sm">
            All sounds are synthesised via the Web Audio API - no audio files.
            The oscilloscope monitors the shared AudioContext, so every button animates the waveform.
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
              <span className="text-gray-700">· oscilloscope connected</span>
            </div>
          )}
        </section>

        {/* ── Oscilloscope ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Oscilloscope
          </h2>
          <Oscilloscope analyser={analyser} />
          <p className="mt-2 text-xs text-gray-500">
            Taps the shared AudioContext singleton - every sound button below animates this waveform.
            {!analyser && (
              <span className="text-yellow-500"> Click any button to initialise the context.</span>
            )}
          </p>
        </section>

        {/* ── Sound buttons ── */}
        <section>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
            Sounds
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SOUNDS.map(({ name, emoji, label, description }) => {
              const s = statuses[name];
              return (
                <div key={name} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => void playSound(name)}
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
                  {s && s.status !== "idle" && (
                    <p className={`text-xs px-1 ${statusColor[s.status]}`}>
                      {s.status === "ok" ? "✓ played without error" : `✗ error: ${s.error}`}
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
