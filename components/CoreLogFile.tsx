"use client";

// components/CoreLogFile.tsx
// Client component: follows a text log through the Primordia Core API without
// keeping the page in a pending Server Component/Suspense state.

import { useEffect, useRef, useState, type RefObject } from "react";
import { AnsiRenderer } from "@/components/AnsiRenderer";
import { withBasePath } from "@/lib/base-path";
import { coreApiFetch } from "@/lib/core-api-key-client";

interface CoreLogFileProps {
  /** Core API endpoint that streams NDJSON log events with a .line field. */
  streamPath: string;
  /** Start/stop the Core subscription. Useful for collapsed details panels. */
  active?: boolean;
  /** True when active=false because the user explicitly paused following. */
  paused?: boolean;
  /** Optional scroll container to keep pinned to bottom while already at bottom. */
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  /** Raw log text already rendered during the initial server response. */
  initialOutput?: string;
  /** 1-based Core API --start cursor to use for the next subscription. */
  initialStartLine?: number;
}

type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "paused";

function withStartCursor(path: string, startLine: number): string {
  const url = new URL(path, "http://primordia.local");
  url.searchParams.set("follow", "true");
  url.searchParams.set("json", "true");
  url.searchParams.set("start", String(Math.max(1, startLine)));
  return `${url.pathname}${url.search}`;
}

function countCompleteLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

function appendCoreLogNdjson(buffer: string, chunk: string): { text: string; lineCount: number; remainder: string } {
  const normalized = `${buffer}${chunk}`.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const parts = normalized.split("\n");
  const remainder = parts.pop() ?? "";
  let text = "";
  let lineCount = 0;

  for (const raw of parts) {
    if (!raw.trim()) continue;
    lineCount += 1;
    try {
      const parsed = JSON.parse(raw) as { line?: unknown };
      text += `${typeof parsed.line === "string" ? parsed.line : raw}\n`;
    } catch {
      text += `${raw}\n`;
    }
  }

  return { text, lineCount, remainder };
}

function isPageHidden(): boolean {
  return document.visibilityState === "hidden";
}

function isScrolledToBottom(element: HTMLDivElement | null): boolean {
  if (!element) return false;
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
}

function scrollToBottomIfNeeded(element: HTMLDivElement | null): void {
  if (!element || isScrolledToBottom(element)) return;
  element.scrollTop = element.scrollHeight;
}

export function CoreLogFile({ streamPath, active = true, paused = false, scrollContainerRef, initialOutput = "", initialStartLine }: CoreLogFileProps) {
  const [output, setOutput] = useState(initialOutput);
  const [connectionState, setConnectionState] = useState<ConnectionState>(active ? "connecting" : "idle");
  const [notice, setNotice] = useState<string | null>(null);
  const startLineRef = useRef(initialStartLine ?? countCompleteLines(initialOutput) + 1);

  useEffect(() => {
    startLineRef.current = initialStartLine ?? countCompleteLines(initialOutput) + 1;
    const frame = requestAnimationFrame(() => setOutput(initialOutput));
    return () => cancelAnimationFrame(frame);
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
      if (cancelled || !active || isPageHidden()) return;
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
        let ndjsonBuffer = "";

        while (!cancelled && !isPageHidden()) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          const parsed = appendCoreLogNdjson(ndjsonBuffer, chunk);
          ndjsonBuffer = parsed.remainder;
          startLineRef.current += parsed.lineCount;
          if (parsed.text) {
            const shouldStickToBottom = isScrolledToBottom(scrollContainerRef?.current ?? null);
            setOutput((prev) => prev + parsed.text);
            if (shouldStickToBottom) {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => scrollToBottomIfNeeded(scrollContainerRef?.current ?? null));
              });
            }
          }
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setNotice(error instanceof Error ? error.message : String(error));
      }

      if (cancelled || !active || isPageHidden()) return;
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
    let idleFrame: number | null = null;
    if (active) void connect();
    else idleFrame = requestAnimationFrame(() => setConnectionState(paused ? "paused" : "idle"));

    return () => {
      cancelled = true;
      if (idleFrame !== null) cancelAnimationFrame(idleFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopCurrentSubscription();
    };
  }, [streamPath, active, paused, scrollContainerRef]);

  const connected = connectionState === "connected";
  const label = connected
    ? "Following log"
    : connectionState === "idle" ? "Open server logs to connect" : connectionState === "paused" ? "Log stream paused" : connectionState === "reconnecting" ? "Reconnecting log stream" : "Connecting log stream";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
        {label}
      </div>
      {notice && <div className="text-[11px] text-amber-300">{notice}</div>}
      {output ? (
        <AnsiRenderer text={output} className="text-gray-400 whitespace-pre-wrap break-words overflow-x-hidden" />
      ) : (
        <div className="text-gray-600">Waiting for log output…</div>
      )}
    </div>
  );
}
