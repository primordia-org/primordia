"use client";

// app/ansi-test/page.tsx
// Interactive test page for the AnsiRenderer component.
//
// Features:
//   • Pre-baked samples — static and simulated-streaming install.sh output
//   • Raw textarea — paste or type raw ANSI escape sequences directly
//   • Simulate streaming — replays the current text byte-by-byte at a
//     configurable speed so you can verify \r spinner overwrite behaviour
//   • Side-by-side view — rendered output next to the raw input

import { useState, useRef, useCallback, useEffect } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";

// ─── ANSI shorthands ──────────────────────────────────────────────────────────

const ESC = "\x1b[";
const G   = `${ESC}0;32m`;   // green
const C   = `${ESC}0;36m`;   // cyan
const Y   = `${ESC}0;33m`;   // yellow
const R   = `${ESC}0;31m`;   // red
const DIM = `${ESC}2m`;
const B   = `${ESC}1m`;
const RST = `${ESC}0m`;

/** Erase-to-end-of-line then write a done line. */
function done(msg: string) {
  return `\r${ESC}K${G}✓${RST} ${msg}\n`;
}

/** Initial spinner frame (no newline). */
function step(msg: string) {
  return `\\ ${msg}`;
}

/** A few spinner frames followed by the done line. */
function spinThenDone(msg: string, frames = 6) {
  const chars = ["\\", "|", "/", "-"];
  let out = step(msg);
  for (let i = 1; i <= frames; i++) {
    out += `\r${chars[i % 4]} ${msg}`;
  }
  out += done(msg);
  return out;
}

// ─── Samples ──────────────────────────────────────────────────────────────────

const SAMPLES: { label: string; text: string }[] = [
  {
    label: "Static lines",
    text: [
      `${G}✓${RST} Using git 2.43.0\n`,
      `${G}✓${RST} Using bun 1.2.0\n`,
      `${C}▸${RST} Detected exe.xyz host\n`,
      `${Y}⚠${RST} Proxy changed — will restart\n`,
      `${DIM}  npm registry: reachable${RST}\n`,
      `${B}${R}✗ Install failed${RST} at step: bun run build (line 42, exit 1)\n`,
    ].join(""),
  },
  {
    label: "Spinner → done",
    text: [
      `${G}✓${RST} Using git 2.43.0\n`,
      `${G}✓${RST} Using bun 1.2.0\n`,
      spinThenDone("bun install"),
      spinThenDone("bun run build"),
      spinThenDone("Deploying to new slot (zero-downtime)"),
      `${G}✓${RST} Congratulations! Primordia is running!\n`,
      `\nOpen:     ${B}https://myapp.exe.xyz${RST}\n`,
    ].join(""),
  },
  {
    label: "Full install simulation",
    text: [
      `\n`,
      `  ___     _                  _ _\n`,
      ` | _ \\_ _(_)_ __  ___ _ _ __| (_)__ _\n`,
      ` |  _/ '_| | '  \\/ _ \\ '_/ _\` | / _\` |\n`,
      ` |_| |_| |_|_|_|_\\___/_| \\__,_|_\\__,_|\n`,
      `\n`,
      `${G}✓${RST} Using git 2.43.0\n`,
      `${G}✓${RST} Using bun 1.2.0\n`,
      `${G}✓${RST} Using existing worktree\n`,
      `${C}▸${RST} Detected exe.xyz host\n`,
      spinThenDone("bun install"),
      spinThenDone("bun run build"),
      `${G}✓${RST} Installed reverse-proxy.ts\n`,
      `${G}✓${RST} Using systemd v255\n`,
      spinThenDone("Installing systemd service"),
      `${G}✓${RST} Enabled primordia systemd service\n`,
      `\n`,
      spinThenDone("Copying production DB"),
      `\n`,
      spinThenDone("Deploying to new slot (zero-downtime)"),
      `${G}✓${RST} Pushed to mirror remote\n`,
      `${G}✓${RST} Congratulations! Primordia is running!\n`,
      `\n`,
      `Open:     ${B}https://myapp.exe.xyz${RST}\n`,
      `\n`,
    ].join(""),
  },
  {
    label: "Error / diagnostics",
    text: [
      `${G}✓${RST} Using git 2.43.0\n`,
      spinThenDone("bun install"),
      `\\ bun run build\r| bun run build\r`,
      `\r${ESC}K\n`,
      `${DIM}  --- build output ---${RST}\n`,
      `${DIM}  src/app/page.tsx:12:3 - error TS2345: Argument of type 'string'${RST}\n`,
      `${DIM}  --------------------------${RST}\n`,
      `\n${R}✗ Install failed${RST} at step: ${B}bun run build${RST} (line 99, exit 1)\n`,
      `\n`,
      `${DIM}  --- Server diagnostics ---------------------------------------${RST}\n`,
      `${DIM}  Date:      2026-04-28 17:00:00 UTC${RST}\n`,
      `${DIM}  Hostname:  myapp.exe.xyz${RST}\n`,
      `${DIM}  OS:        Linux 6.1.0 x86_64${RST}\n`,
      `${DIM}  Disk:      12G free of 40G${RST}\n`,
      `${DIM}  Memory:    2.1G free of 4.0G${RST}\n`,
      `${DIM}  --------------------------------------------------------------${RST}\n`,
    ].join(""),
  },
  {
    label: "Minimal (no ANSI)",
    text: "- Type-checking...\n- Running install.sh...\n- Merging branch...\n- Installing dependencies...\n",
  },
];

// ─── Streaming simulation ─────────────────────────────────────────────────────

/**
 * Replay `text` character-by-character at `delayMs` per char, calling
 * `onChunk(accumulated)` on each step. Returns an abort function.
 */
function simulateStream(
  text: string,
  delayMs: number,
  onChunk: (accumulated: string) => void,
  onDone: () => void,
): () => void {
  let i = 0;
  let timer: ReturnType<typeof setTimeout>;
  let cancelled = false;

  function tick() {
    if (cancelled || i >= text.length) {
      if (!cancelled) onDone();
      return;
    }
    i++;
    onChunk(text.slice(0, i));
    timer = setTimeout(tick, delayMs);
  }
  timer = setTimeout(tick, delayMs);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnsiTestPage() {
  const [sampleIdx, setSampleIdx] = useState(0);
  const [rawInput, setRawInput] = useState(SAMPLES[0].text);
  const [renderedText, setRenderedText] = useState(SAMPLES[0].text);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamDelay, setStreamDelay] = useState(30);
  const cancelStream = useRef<(() => void) | null>(null);

  // When sample changes, load its text and stop any in-flight stream.
  function selectSample(idx: number) {
    cancelStream.current?.();
    cancelStream.current = null;
    setIsStreaming(false);
    setSampleIdx(idx);
    setRawInput(SAMPLES[idx].text);
    setRenderedText(SAMPLES[idx].text);
  }

  // Sync rendered output immediately when the textarea changes.
  function handleRawChange(val: string) {
    cancelStream.current?.();
    cancelStream.current = null;
    setIsStreaming(false);
    setRawInput(val);
    setRenderedText(val);
  }

  // Start a simulated stream replay of rawInput.
  const startStream = useCallback(() => {
    cancelStream.current?.();
    setRenderedText("");
    setIsStreaming(true);
    const source = rawInput;
    cancelStream.current = simulateStream(
      source,
      streamDelay,
      (accumulated) => setRenderedText(accumulated),
      () => {
        setIsStreaming(false);
        cancelStream.current = null;
      },
    );
  }, [rawInput, streamDelay]);

  function stopStream() {
    cancelStream.current?.();
    cancelStream.current = null;
    setIsStreaming(false);
  }

  // Clean up on unmount.
  useEffect(() => () => { cancelStream.current?.(); }, []);

  // Show escape sequences as visible text for the raw panel.
  const displayRaw = rawInput
    .replace(/\x1b/g, "␛")
    .replace(/\r/g, "␍");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="text-sm font-semibold text-gray-100 mr-auto">
          AnsiRenderer Test Page
        </h1>

        {/* Sample picker */}
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span>Sample</span>
          <select
            value={sampleIdx}
            onChange={(e) => selectSample(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-200"
          >
            {SAMPLES.map((s, i) => (
              <option key={i} value={i}>{s.label}</option>
            ))}
          </select>
        </label>

        {/* Stream speed */}
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-24">
            Speed&nbsp;
            <span className="text-gray-200 font-mono">{streamDelay}ms/char</span>
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={streamDelay}
            onChange={(e) => setStreamDelay(Number(e.target.value))}
            className="w-24 accent-violet-500"
          />
        </label>

        {/* Stream controls */}
        <button
          onClick={isStreaming ? stopStream : startStream}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            isStreaming
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-violet-600 hover:bg-violet-500 text-white"
          }`}
        >
          {isStreaming ? "Stop" : "Simulate stream"}
        </button>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-6 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: raw input textarea */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
            Raw input
            <span className="ml-2 text-gray-600 font-normal normal-case">
              (ESC shown as ␛, CR as ␍)
            </span>
          </h2>
          <textarea
            value={displayRaw}
            onChange={(e) => {
              // Convert ␛ → ESC and ␍ → \r so users can paste/edit using
              // the visible placeholders.
              const cooked = e.target.value
                .replace(/␛/g, "\x1b")
                .replace(/␍/g, "\r");
              handleRawChange(cooked);
            }}
            className="flex-1 min-h-[400px] bg-gray-900 border border-gray-700 rounded p-3 text-xs font-mono text-gray-300 resize-none focus:outline-none focus:border-gray-500"
            spellCheck={false}
          />
          <p className="text-xs text-gray-600">
            {rawInput.length} bytes · edit directly or pick a sample above
          </p>
        </section>

        {/* Right: rendered output */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-2">
            Rendered output
            {isStreaming && (
              <span className="flex items-center gap-1 text-yellow-400 font-normal normal-case animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                streaming…
              </span>
            )}
          </h2>

          {/* Mirrors the deploy section card style in EvolveSessionView */}
          <div className="rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
              <span className="font-semibold text-xs text-gray-300">
                🚀 Deploying to production
              </span>
              {isStreaming && (
                <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
                  Running…
                </span>
              )}
            </div>
            <div className="px-4 py-3">
              {renderedText ? (
                <AnsiRenderer text={renderedText} />
              ) : (
                <p className="text-gray-600 text-xs italic">
                  {isStreaming ? "Waiting for first bytes…" : "No output yet."}
                </p>
              )}
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
