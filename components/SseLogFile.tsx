"use client";

// components/SseLogFile.tsx
// Client component: follows a text log through the Primordia Core API without
// keeping the page in a pending Server Component/Suspense state.

import { useEffect, useRef, useState } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { withBasePath } from "@/lib/base-path";
import { coreApiFetch } from "@/lib/core-api-key-client";

interface SseLogFileProps {
  /** Core API endpoint that streams plain log text. */
  streamPath: string;
  /** Raw log text already rendered during the initial server response. */
  initialOutput?: string;
  /** 1-based Core API --start cursor to use for the next subscription. */
  initialStartLine?: number;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "paused";

function withStartCursor(path: string, startLine: number): string {
  const url = new URL(path, "http://primordia.local");
  url.searchParams.set("follow", "true");
  url.searchParams.set("start", String(Math.max(1, startLine)));
  return `${url.pathname}${url.search}`;
}

function countCompleteLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function isPageHidden(): boolean {
  return document.visibilityState === "hidden";
}

export function SseLogFile({ streamPath, initialOutput = "", initialStartLine }: SseLogFileProps) {
  const [output, setOutput] = useState(initialOutput);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const startLineRef = useRef(initialStartLine ?? countCompleteLines(initialOutput) + 1);

  useEffect(() => {
    startLineRef.current = initialStartLine ?? countCompleteLines(initialOutput) + 1;
    setOutput(initialOutput);
  }, [initialOutput, initialStartLine]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelayMs = 1000;
    let abort: AbortController | null = null;

    const stopCurrentSubscription = () => {
      abort?.abort();
      abort = null;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const connect = async () => {
      if (cancelled || isPageHidden()) return;
      stopCurrentSubscription();
      abort = new AbortController();
      setConnectionState((current) => current === "connected" ? "connected" : retryDelayMs > 1000 ? "reconnecting" : "connecting");

      try {
        const res = await coreApiFetch(withBasePath(withStartCursor(streamPath, startLineRef.current)), {
          signal: abort.signal,
          headers: { Accept: "text/plain" },
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

        while (!cancelled && !isPageHidden()) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          startLineRef.current += countCompleteLines(chunk);
          setOutput((prev) => prev + chunk);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setNotice(error instanceof Error ? error.message : String(error));
      }

      if (cancelled || isPageHidden()) return;
      setConnectionState("reconnecting");
      retryTimer = setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 10000);
    };

    const onVisibilityChange = () => {
      if (isPageHidden()) {
        stopCurrentSubscription();
        setConnectionState("paused");
        return;
      }
      void connect();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void connect();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopCurrentSubscription();
    };
  }, [streamPath]);

  const connected = connectionState === "connected";
  const label = connected
    ? "Following log"
    : connectionState === "paused" ? "Log stream paused while tab is hidden" : connectionState === "reconnecting" ? "Reconnecting log stream" : "Connecting log stream";

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
        <div className="text-gray-600">Waiting for log output…</div>
      )}
    </div>
  );
}
