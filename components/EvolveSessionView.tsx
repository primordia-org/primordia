"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Polls /api/evolve/local?sessionId=... and displays live Claude Code progress.

import { useState, useRef, useEffect } from "react";
import { MarkdownContent } from "./SimpleMarkdown";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { HamburgerMenu } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvolveSessionData {
  status: "starting" | "running-claude" | "starting-server" | "ready" | "disconnected" | "error";
  progressText: string;
  port: number | null;
  previewUrl: string | null;
  branch: string;
  request: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvolveSessionViewProps {
  sessionId: string;
  initialRequest: string;
  initialProgressText: string;
  initialStatus: string;
  initialPreviewUrl: string | null;
  branch?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvolveSessionView({
  sessionId,
  initialRequest,
  initialProgressText,
  initialStatus,
  initialPreviewUrl,
  branch,
}: EvolveSessionViewProps) {
  const [progressText, setProgressText] = useState(initialProgressText);
  const [status, setStatus] = useState(initialStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const { sessionUser, handleLogout } = useSessionUser();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as progress grows
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressText]);

  // Cancel polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current !== null) clearInterval(pollingRef.current);
    };
  }, []);

  // Start polling if the session isn't already in a terminal state
  useEffect(() => {
    const terminal = ["ready", "error", "disconnected"];
    if (terminal.includes(initialStatus)) return;

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/evolve/local?sessionId=${sessionId}`);
        if (!res.ok) return;

        const data = (await res.json()) as EvolveSessionData;
        setProgressText(data.progressText || "⏳ Starting…");
        setStatus(data.status);
        if (data.previewUrl) setPreviewUrl(data.previewUrl);

        if (data.status === "ready" || data.status === "error" || data.status === "disconnected") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
        }
      } catch {
        // Silently ignore transient network errors
      }
    }, 5_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // intentionally omit initialStatus — run once on mount

  const isTerminal = status === "ready" || status === "error" || status === "disconnected";

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Session" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={[
            {
              label: "New request",
              hoverColor: "hover:text-amber-400",
              href: "/evolve",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              ),
            },
            {
              label: "Go to chat",
              hoverColor: "hover:text-blue-400",
              href: "/chat",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              ),
            },
            {
              label: "Sync with GitHub",
              hoverColor: "hover:text-green-400",
              onClick: () => setSyncDialogOpen(true),
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
              ),
            },
          ]}
        />
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
      </header>

      {/* Original request */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
        <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Your request</p>
        <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{initialRequest}</p>
      </div>

      {/* Progress */}
      <div className="flex-1 mb-6">
        <div className="px-4 py-3 rounded-lg bg-gray-800 text-gray-100 text-sm leading-relaxed">
          <MarkdownContent text={`**Local Evolve Progress**:\n\n${progressText || "⏳ Starting…"}`} />
        </div>

        {/* Spinner when still running */}
        {!isTerminal && (
          <div className="mt-3 text-sm text-gray-500 animate-pulse">Running…</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Preview link (ready state) */}
      {status === "ready" && previewUrl && (
        <div className="mb-6 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
          <p className="text-amber-300 font-semibold mb-1">🚀 Preview ready</p>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:text-amber-200 underline break-all"
          >
            {previewUrl}
          </a>
          <p className="text-amber-400/70 text-xs mt-2">
            Open the preview link and use the <strong>Accept</strong> or <strong>Reject</strong> bar
            there to apply or discard the changes.
          </p>
        </div>
      )}

      {/* Disconnected notice */}
      {status === "disconnected" && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-yellow-900/40 border border-yellow-700/50 text-yellow-300 text-sm">
          ⚠️ The preview server disconnected unexpectedly. The branch still exists — you can
          restart the dev server manually.
        </div>
      )}

      {/* Footer actions */}
      <div className="flex gap-4">
        <Link href="/evolve" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
          ← Submit another request
        </Link>
      </div>
    </main>
  );
}
