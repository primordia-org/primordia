"use client";

// components/SseLogFile.tsx
// Client component: follows a text log over SSE without keeping the page in a
// pending Server Component/Suspense state.

import { useEffect, useRef, useState } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { withBasePath } from "@/lib/base-path";

interface SseLogFileProps {
  /** SSE endpoint that emits { text: string } and optional { done: true }. */
  streamPath: string;
  /** Raw log text already rendered during the initial server response. */
  initialOutput?: string;
}

export function SseLogFile({ streamPath, initialOutput = "" }: SseLogFileProps) {
  const [output, setOutput] = useState(initialOutput);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const separator = streamPath.includes("?") ? "&" : "?";
    const path = initialOutput ? `${streamPath}${separator}n=0` : streamPath;
    const source = new EventSource(withBasePath(path));
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { text?: string; done?: true; error?: string };
        if (parsed.text) setOutput((prev) => prev + parsed.text);
        if (parsed.error) setError(parsed.error);
        if (parsed.done) {
          setConnected(false);
          source.close();
        }
      } catch {
        // Ignore malformed events; the stream may continue with the next event.
      }
    };

    source.onerror = () => {
      setConnected(false);
      setError("Log stream disconnected. It will retry automatically.");
    };

    return () => {
      source.close();
      if (sourceRef.current === source) sourceRef.current = null;
    };
  }, [initialOutput, streamPath]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
        {connected ? "Following log" : "Log stream disconnected"}
      </div>
      {error && <div className="text-[11px] text-amber-300">{error}</div>}
      {output ? (
        <AnsiRenderer text={output} className="text-gray-400" />
      ) : (
        <div className="text-gray-600">Waiting for log output…</div>
      )}
    </div>
  );
}
