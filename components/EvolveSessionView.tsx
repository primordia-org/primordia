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
  status: "starting" | "running-claude" | "starting-server" | "ready" | "accepted" | "rejected" | "disconnected" | "error";
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
  const [followupText, setFollowupText] = useState('');
  const [isSubmittingFollowup, setIsSubmittingFollowup] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
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

  // Extracted polling logic — can be called from the useEffect below and also
  // from the follow-up submit handler to resume polling after re-queuing Claude.
  function startPolling() {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/evolve/local?sessionId=${sessionId}`);
        if (!res.ok) return;

        const data = (await res.json()) as EvolveSessionData;
        setProgressText(data.progressText || "⏳ Starting…");
        setStatus(data.status);
        if (data.previewUrl) setPreviewUrl(data.previewUrl);

        if (
          data.status === "ready" ||
          data.status === "accepted" ||
          data.status === "rejected" ||
          data.status === "error" ||
          data.status === "disconnected"
        ) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
        }
      } catch {
        // Silently ignore transient network errors
      }
    }, 5_000);
  }

  // Start polling if the session isn't already in a terminal state
  useEffect(() => {
    const terminal = ["ready", "accepted", "rejected", "error", "disconnected"];
    if (terminal.includes(initialStatus)) return;

    startPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // intentionally omit initialStatus — run once on mount

  async function handleFollowupSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = followupText.trim();
    if (!trimmed) return;

    setIsSubmittingFollowup(true);
    setFollowupError(null);

    try {
      const res = await fetch('/api/evolve/local/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, request: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      setFollowupText('');
      setStatus('running-claude');
      startPolling();
    } catch (err) {
      setFollowupError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmittingFollowup(false);
    }
  }

  const isTerminal =
    status === "ready" ||
    status === "accepted" ||
    status === "rejected" ||
    status === "error" ||
    status === "disconnected";

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

      {/* Accepted banner */}
      {status === "accepted" && (
        <div className="mb-6 px-4 py-4 rounded-lg bg-green-900/40 border border-green-700/50 text-sm">
          <p className="text-green-200 font-semibold">✅ Changes accepted</p>
          <p className="text-green-300/80 text-xs mt-1">
            The branch was merged and the worktree has been removed.
          </p>
        </div>
      )}

      {/* Rejected banner */}
      {status === "rejected" && (
        <div className="mb-6 px-4 py-4 rounded-lg bg-red-900/40 border border-red-700/50 text-sm">
          <p className="text-red-200 font-semibold">🗑️ Changes rejected</p>
          <p className="text-red-300/80 text-xs mt-1">
            The branch and worktree have been discarded.
          </p>
        </div>
      )}

      {/* Preview link (ready state only — hidden once a decision has been made) */}
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

      {/* Follow-up request form — only when ready and no decision has been made yet */}
      {status === "ready" && previewUrl !== null && (
        <form onSubmit={handleFollowupSubmit} className="mb-6 px-4 py-4 rounded-lg bg-gray-900 border border-gray-700 text-sm">
          <p className="text-gray-200 font-semibold mb-1">Submit a follow-up request</p>
          <p className="text-gray-400 text-xs mb-3">
            Address feedback on the changes, e.g. &quot;I got this error when using it:&quot; or &quot;please change the design of the button&quot;.
          </p>
          <textarea
            rows={4}
            value={followupText}
            onChange={(e) => setFollowupText(e.target.value)}
            placeholder="Describe what to fix or improve…"
            className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-3"
          />
          {followupError && (
            <p className="text-red-400 text-xs mb-2">{followupError}</p>
          )}
          <button
            type="submit"
            disabled={isSubmittingFollowup || !followupText.trim()}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
          >
            {isSubmittingFollowup ? "Submitting…" : "Submit follow-up"}
          </button>
        </form>
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
