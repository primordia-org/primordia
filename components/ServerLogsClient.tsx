"use client";

// components/ServerLogsClient.tsx
// Streams the primordia systemd service journal in real time.
// Auto-connects to GET /api/admin/logs on mount and appends SSE text chunks
// to a scrollable terminal window. Auto-scrolls to the bottom unless the user
// has scrolled up (paused). A "Clear" button wipes accumulated output.

import { useState, useRef, useEffect, useCallback } from "react";
import { withBasePath } from "../lib/base-path";

export default function ServerLogsClient() {
  const [output, setOutput] = useState<string>("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // true when auto-scroll is active (user hasn't scrolled up)
  const [autoScroll, setAutoScroll] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const connect = useCallback(() => {
    // Clean up any existing connection
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setError(null);
    setConnected(false);

    (async () => {
      try {
        const res = await fetch(withBasePath("/api/admin/logs"), { signal: abort.signal });
        if (!res.ok) {
          const text = await res.text();
          setError(`HTTP ${res.status}: ${text}`);
          return;
        }

        setConnected(true);
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
                setConnected(false);
                if (parsed.exitCode !== 0) {
                  setError(`journalctl exited with code ${parsed.exitCode}`);
                }
              } else {
                setOutput((prev) => prev + parsed.text);
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setConnected(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => abortRef.current?.abort();
  }, [connect]);

  // Auto-scroll when output changes
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [output, autoScroll]);

  // Detect manual scroll-up to pause auto-scroll
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  function handleClear() {
    setOutput("");
  }

  function handleReconnect() {
    setOutput("");
    connect();
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-3">
        <span className={`flex items-center gap-1.5 text-xs ${connected ? "text-green-400" : "text-gray-500"}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-gray-600"}`} />
          {connected ? "Live" : "Disconnected"}
        </span>

        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="text-xs text-blue-400 hover:text-blue-300 underline"
          >
            ↓ Resume scroll
          </button>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1 rounded text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Clear
          </button>
          {!connected && (
            <button
              type="button"
              onClick={handleReconnect}
              className="px-3 py-1 rounded text-xs text-green-300 bg-green-900/40 hover:bg-green-900/60 border border-green-700/40 transition-colors"
            >
              Reconnect
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-xl bg-gray-950 border border-gray-800 p-4 font-mono text-xs text-gray-300 leading-relaxed min-h-64"
      >
        {!output && !error && (
          <p className="text-gray-600">Waiting for log output…</p>
        )}
        <pre className="whitespace-pre-wrap break-all">{output}</pre>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
