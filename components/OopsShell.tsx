"use client";

// components/OopsShell.tsx
// Mobile-friendly owner shell. Renders a scrollable history of command runs
// above a sticky input bar. Each command streams stdout + stderr from POST
// /api/oops as SSE, showing output in real time.

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { withBasePath } from "../lib/base-path";

interface HistoryEntry {
  id: number;
  cmd: string;
  output: string;
  /** null = still running */
  exitCode: number | null;
}

export default function OopsShell() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmd, setCmd] = useState("");
  const [running, setRunning] = useState(false);
  const nextId = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom when new output arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function run() {
    if (!cmd.trim() || running) return;
    const trimmed = cmd.trim();
    setCmd("");
    setRunning(true);

    const id = nextId.current++;
    setHistory((prev) => [...prev, { id, cmd: trimmed, output: "", exitCode: null }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(withBasePath("/api/oops"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: trimmed }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        setHistory((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, output: `HTTP ${res.status}: ${text}`, exitCode: 1 } : e,
          ),
        );
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as
              | { text: string }
              | { done: true; exitCode: number };
            if ("done" in parsed) {
              setHistory((prev) =>
                prev.map((e) => (e.id === id ? { ...e, exitCode: parsed.exitCode } : e)),
              );
            } else {
              setHistory((prev) =>
                prev.map((e) =>
                  e.id === id ? { ...e, output: e.output + parsed.text } : e,
                ),
              );
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : String(err);
        setHistory((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, output: e.output + `\nFetch error: ${msg}`, exitCode: 1 } : e,
          ),
        );
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    run();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      run();
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Output history ── */}
      <div className="flex-1 overflow-y-auto rounded-xl bg-gray-950 border border-gray-800 p-4 font-mono text-sm min-h-48 mb-4">
        {history.length === 0 && (
          <p className="text-gray-600 text-xs">No commands yet. Type one below and press Run.</p>
        )}

        {history.map((entry) => (
          <div key={entry.id} className="mb-5 last:mb-0">
            {/* Prompt line */}
            <div className="flex items-start gap-2">
              <span className="text-green-400 select-none shrink-0 leading-relaxed">$</span>
              <span className="text-gray-200 break-all leading-relaxed">{entry.cmd}</span>
            </div>

            {/* Output text */}
            {entry.output && (
              <pre className="mt-1 ml-4 text-gray-400 whitespace-pre-wrap break-all text-xs leading-relaxed">
                {entry.output}
              </pre>
            )}

            {/* Exit status badge */}
            <div className="mt-1 ml-4">
              {entry.exitCode === null ? (
                <span className="text-xs text-yellow-500 animate-pulse">running…</span>
              ) : entry.exitCode === 0 ? (
                <span className="text-xs text-green-700">exited 0</span>
              ) : (
                <span className="text-xs text-red-500">exited {entry.exitCode}</span>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ── */}
      <form onSubmit={handleSubmit} className="flex items-end gap-3">
        <div className="flex-1 flex items-center bg-gray-900 border border-gray-700 rounded-xl px-3 py-3 focus-within:border-gray-500 transition-colors">
          <span className="text-green-400 font-mono text-sm mr-2 select-none shrink-0 leading-relaxed">
            $
          </span>
          <textarea
            className="flex-1 bg-transparent text-gray-200 font-mono text-sm resize-none outline-none placeholder-gray-600 leading-relaxed"
            placeholder="sudo systemctl restart primordia"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.max(1, cmd.split("\n").length)}
            disabled={running}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={running || !cmd.trim()}
          className="px-5 py-4 rounded-xl bg-green-800 hover:bg-green-700 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium text-sm transition-colors shrink-0"
        >
          {running ? "…" : "Run"}
        </button>
      </form>

      <p className="mt-2 text-xs text-gray-600 text-center">
        Enter to run · Shift+Enter for newline
      </p>
    </div>
  );
}
