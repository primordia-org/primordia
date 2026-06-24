"use client";

// components/SseLogFile.tsx
// Client component: follows a text log over SSE without keeping the page in a
// pending Server Component/Suspense state.

import { useEffect, useState } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { withBasePath } from "@/lib/base-path";

interface SseLogFileProps {
  /** SSE endpoint that emits { text: string }, status events, and optional { done: true }. */
  streamPath: string;
  /** Raw log text already rendered during the initial server response. */
  initialOutput?: string;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "closed";

type LogStreamEvent =
  | { text: string }
  | { status: "missing" | "ready"; message?: string }
  | { error: string }
  | { done: true; exitCode?: number };

function appendNoHistoryParam(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}n=0`;
}

function parseSseEvents(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const parts = normalized.split("\n\n");
  return {
    events: parts.slice(0, -1),
    remainder: parts[parts.length - 1] ?? "",
  };
}

function eventData(eventText: string): string | null {
  const dataLines = eventText
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

export function SseLogFile({ streamPath, initialOutput = "" }: SseLogFileProps) {
  const [output, setOutput] = useState(initialOutput);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [missingLog, setMissingLog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1000;
    let hasReceivedInitialHistory = Boolean(initialOutput);
    let abort: AbortController | null = null;

    const handleParsedEvent = (parsed: LogStreamEvent) => {
      if ("text" in parsed) {
        setOutput((prev) => prev + parsed.text);
        setMissingLog(false);
        setNotice(null);
        hasReceivedInitialHistory = true;
        return;
      }

      if ("status" in parsed) {
        setMissingLog(parsed.status === "missing");
        if (parsed.message) setNotice(parsed.message);
        if (parsed.status === "ready") setNotice(null);
        return;
      }

      if ("error" in parsed) {
        setNotice(parsed.error);
        return;
      }

      if ("done" in parsed) {
        setConnectionState("closed");
      }
    };

    const connect = async () => {
      if (cancelled) return;
      abort?.abort();
      abort = new AbortController();
      setConnectionState((current) => current === "connected" ? "connected" : retryDelayMs > 1000 ? "reconnecting" : "connecting");

      const path = hasReceivedInitialHistory ? appendNoHistoryParam(streamPath) : streamPath;

      try {
        const res = await fetch(withBasePath(path), {
          signal: abort.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ""}`);
        }
        if (!res.body) throw new Error("Log stream response did not include a body.");

        setConnectionState("connected");
        setNotice(null);
        retryDelayMs = 1000;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parsedBuffer = parseSseEvents(buffer);
          buffer = parsedBuffer.remainder;

          for (const eventText of parsedBuffer.events) {
            const rawData = eventData(eventText);
            if (!rawData) continue;
            try {
              handleParsedEvent(JSON.parse(rawData) as LogStreamEvent);
            } catch {
              // Ignore malformed SSE events and continue reading the stream.
            }
          }
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setNotice(error instanceof Error ? error.message : String(error));
      }

      if (cancelled) return;
      setConnectionState("reconnecting");
      retryTimer = setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 10000);
    };

    void connect();

    return () => {
      cancelled = true;
      abort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [initialOutput, streamPath]);

  const connected = connectionState === "connected";
  const label = connected
    ? missingLog ? "Waiting for log file" : "Following log"
    : connectionState === "reconnecting" ? "Reconnecting log stream" : "Connecting log stream";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
        {label}
      </div>
      {notice && <div className="text-[11px] text-amber-300">{notice}</div>}
      {output ? (
        <AnsiRenderer text={output} className="text-gray-400" />
      ) : (
        <div className="text-gray-600">
          {missingLog ? "The preview server log file does not exist yet." : "Waiting for log output…"}
        </div>
      )}
    </div>
  );
}
