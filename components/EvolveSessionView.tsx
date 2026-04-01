"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Streams live Claude Code progress via SSE from /api/evolve/stream.

import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownContent } from "./SimpleMarkdown";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { HamburgerMenu } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import Link from "next/link";

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvolveSessionViewProps {
  sessionId: string;
  initialRequest: string;
  initialProgressText: string;
  initialStatus: string;
  /** The initial devServerStatus from the DB. */
  initialDevServerStatus: string;
  initialPreviewUrl: string | null;
  /** The currently checked-out branch (parent). Used in confirmation copy and NavHeader. */
  branch?: string | null;
  /** The preview branch name created for this session. */
  sessionBranch: string;
  /** True when the session branch is a direct child of the current branch, so Accept/Reject are safe to show. */
  canAcceptReject: boolean;
  /** Number of commits on the parent branch not yet in the session branch. */
  upstreamCommitCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvolveSessionView({
  sessionId,
  initialRequest,
  initialProgressText,
  initialStatus,
  initialDevServerStatus,
  initialPreviewUrl,
  branch,
  sessionBranch,
  canAcceptReject,
  upstreamCommitCount,
}: EvolveSessionViewProps) {
  const [progressText, setProgressText] = useState(initialProgressText);
  const [status, setStatus] = useState(initialStatus);
  const [devServerStatus, setDevServerStatus] = useState(initialDevServerStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const { sessionUser, handleLogout } = useSessionUser();
  const [followupText, setFollowupText] = useState('');
  const [isSubmittingFollowup, setIsSubmittingFollowup] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [acceptRejectLoading, setAcceptRejectLoading] = useState(false);
  const [acceptRejectError, setAcceptRejectError] = useState<string | null>(null);
  /** Which of the three action panels is currently expanded, or null if all collapsed. */
  const [activeAction, setActiveAction] = useState<"accept" | "reject" | "followup" | null>(null);
  const [isRestartingServer, setIsRestartingServer] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [remainingUpstream, setRemainingUpstream] = useState(upstreamCommitCount);
  const [upstreamSyncLoading, setUpstreamSyncLoading] = useState<"merge" | "rebase" | null>(null);
  const [upstreamSyncError, setUpstreamSyncError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Tracks how many characters of progressText the client has received, for SSE reconnection. */
  const progressLengthRef = useRef(initialProgressText.length);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const followupTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom as progress grows
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressText]);

  // Stop the SSE stream on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Extracted streaming logic — can be called on mount and after follow-up / restart.
  async function startStreaming() {
    // Abort any in-flight stream before opening a new one.
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const offset = progressLengthRef.current;

    try {
      const response = await fetch(
        `/api/evolve/stream?sessionId=${sessionId}&offset=${offset}`,
        { signal: controller.signal },
      );
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
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
            const parsed = JSON.parse(raw) as {
              progressDelta?: string;
              status?: string;
              devServerStatus?: string;
              previewUrl?: string | null;
              done?: boolean;
            };

            if (parsed.progressDelta) {
              setProgressText((prev) => {
                const next = prev + parsed.progressDelta!;
                progressLengthRef.current = next.length;
                return next;
              });
            }
            if (parsed.status != null) setStatus(parsed.status);
            if (parsed.devServerStatus != null) setDevServerStatus(parsed.devServerStatus);
            if ("previewUrl" in parsed) setPreviewUrl(parsed.previewUrl ?? null);
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Network error — leave the UI in its last known state
    }
  }

  // Start streaming if the session isn't already in a terminal state
  useEffect(() => {
    const alreadyTerminal =
      initialStatus === "accepted" ||
      initialStatus === "rejected" ||
      initialStatus === "error" ||
      (initialStatus === "ready" && (initialDevServerStatus === "running" || initialDevServerStatus === "disconnected"));
    if (alreadyTerminal) return;

    void startStreaming();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // intentionally omit initialStatus — run once on mount

  // Auto-focus the follow-up textarea whenever the follow-up panel opens.
  useEffect(() => {
    if (activeAction === "followup") {
      // Small delay so the DOM is painted before we focus.
      setTimeout(() => followupTextareaRef.current?.focus(), 0);
    }
  }, [activeAction]);

  async function handleRestartServer() {
    setIsRestartingServer(true);
    setRestartError(null);

    try {
      const res = await fetch('/api/evolve/kill-restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      setDevServerStatus('starting');
      void startStreaming();
    } catch (err) {
      setRestartError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRestartingServer(false);
    }
  }

  async function handleUpstreamSync(action: "merge" | "rebase") {
    setUpstreamSyncLoading(action);
    setUpstreamSyncError(null);
    try {
      const res = await fetch('/api/evolve/upstream-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action }),
      });
      const data = (await res.json()) as { outcome?: string; log?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error: ${res.status}`);
      setRemainingUpstream(0);
    } catch (err) {
      setUpstreamSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpstreamSyncLoading(null);
    }
  }

  async function handleFollowupSubmit() {
    const trimmed = followupText.trim();
    if (!trimmed) return;

    setIsSubmittingFollowup(true);
    setFollowupError(null);

    try {
      const res = await fetch('/api/evolve/followup', {
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
      void startStreaming();
    } catch (err) {
      setFollowupError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmittingFollowup(false);
    }
  }

  async function handleAccept() {
    if (acceptRejectLoading) return;
    setAcceptRejectLoading(true);
    setAcceptRejectError(null);
    try {
      const res = await fetch('/api/evolve/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', sessionId }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string; stashWarning?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setStatus('accepted');
      abortControllerRef.current?.abort();
      // Trigger bun install + dev server restart to pick up the merged changes.
      fetch('/api/evolve/restart', { method: 'POST' }).catch(() => {});
    } catch (err) {
      setAcceptRejectError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptRejectLoading(false);
    }
  }

  async function handleReject() {
    if (acceptRejectLoading) return;
    setAcceptRejectLoading(true);
    setAcceptRejectError(null);
    try {
      const res = await fetch('/api/evolve/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', sessionId }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setStatus('rejected');
      abortControllerRef.current?.abort();
    } catch (err) {
      setAcceptRejectError(err instanceof Error ? err.message : String(err));
    } finally {
      setAcceptRejectLoading(false);
    }
  }

  // Toggle an action panel open/closed. Clicking the active button collapses the panel.
  const toggleAction = useCallback((action: "accept" | "reject" | "followup") => {
    setActiveAction(prev => (prev === action ? null : action));
    setAcceptRejectError(null);
    setFollowupError(null);
  }, []);

  const isTerminal =
    status === "accepted" ||
    status === "rejected" ||
    status === "error" ||
    (status === "ready" && (devServerStatus === "running" || devServerStatus === "disconnected"));

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
              label: "Propose a change",
              hoverColor: "hover:text-amber-400",
              href: "/evolve",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
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

      {/* Created branch */}
      <div className="mb-6 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
        <p className="text-amber-300 font-semibold mb-1 flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          Created branch
        </p>
        <code className="font-mono text-amber-200 text-sm">{sessionBranch}</code>
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

        {/* Dev server starting indicator */}
        {status === "ready" && devServerStatus === "starting" && (
          <div className="mt-3 text-sm text-gray-500 animate-pulse">Starting preview server…</div>
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

      {/* Preview URL + Restart Dev Server — side by side when both visible, stacked when not */}
      {((devServerStatus === "running" && previewUrl) || status === "ready") && (
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          {/* Preview link — shown when dev server is running */}
          {devServerStatus === "running" && previewUrl && (
            <div className="flex-1 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
              <p className="text-amber-300 font-semibold mb-2">🚀 Preview ready</p>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-200 underline break-all"
              >
                {previewUrl}
              </a>
            </div>
          )}

          {/* Dev server status + restart button — shown when session is ready */}
          {status === "ready" && (
            <div className="flex-1 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
              <p className="text-gray-400 text-xs mb-2">
                Dev server:{" "}
                <span className="font-mono text-gray-300">{devServerStatus}</span>
              </p>
              {devServerStatus !== "starting" && (
                <>
                  <p className="text-gray-500 text-xs mb-2">Preview not loading or responding?</p>
                  {restartError && (
                    <p className="text-red-400 text-xs mb-2">{restartError}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleRestartServer}
                    disabled={isRestartingServer}
                    className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-xs font-medium transition-colors"
                  >
                    {isRestartingServer ? "Restarting…" : "↺ Restart dev server"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upstream Changes — shown when the parent branch has commits not yet in the session branch */}
      {remainingUpstream > 0 && status !== "accepted" && status !== "rejected" && (
        <div className="mb-6 rounded-lg bg-blue-950/40 border border-blue-700/50 text-sm overflow-hidden">
          <div className="px-4 py-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-blue-300 font-semibold mb-1">
                ⬆ Upstream Changes
              </p>
              <p className="text-blue-200/70 text-xs">
                <code className="bg-blue-950/60 px-1 rounded">{branch ?? "parent"}</code> is{" "}
                <strong>{remainingUpstream}</strong> commit{remainingUpstream === 1 ? "" : "s"} ahead
                of <code className="bg-blue-950/60 px-1 rounded">{sessionBranch}</code>.
                Bring those changes into the session branch before accepting.
              </p>
              {upstreamSyncError && (
                <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{upstreamSyncError}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => handleUpstreamSync("merge")}
                disabled={upstreamSyncLoading !== null}
                className="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-medium transition-colors"
              >
                {upstreamSyncLoading === "merge" ? "Merging…" : "Merge"}
              </button>
              <button
                type="button"
                onClick={() => handleUpstreamSync("rebase")}
                disabled={upstreamSyncLoading !== null}
                className="px-3 py-1.5 rounded-lg bg-blue-800 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-600 text-blue-200 text-xs font-medium transition-colors"
              >
                {upstreamSyncLoading === "rebase" ? "Rebasing…" : "Rebase"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Three-action panel — shown when the preview is ready */}
      {status === "ready" && (
        <div className="mb-6 rounded-lg bg-gray-900 border border-gray-700 text-sm overflow-hidden">

          {/* ── Header ── */}
          <div className="px-4 py-2 border-b border-gray-700">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Available Actions</p>
          </div>

          {/* ── Button row ── */}
          <div className="flex">
            <button
              onClick={() => toggleAction("followup")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                activeAction === "followup"
                  ? "bg-amber-900/40 text-amber-200"
                  : activeAction !== null
                  ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  : "text-amber-300 bg-amber-900/10 hover:bg-amber-900/25"
              }`}
            >
              Follow-up Changes
            </button>
            <button
              onClick={() => toggleAction("accept")}
              className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                activeAction === "accept"
                  ? "bg-green-900/40 text-green-200"
                  : activeAction !== null
                  ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  : "text-green-300 bg-green-900/10 hover:bg-green-900/25"
              }`}
            >
              Accept Changes
            </button>
            <button
              onClick={() => toggleAction("reject")}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeAction === "reject"
                  ? "bg-red-900/40 text-red-200"
                  : activeAction !== null
                  ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                  : "text-red-300 bg-red-900/10 hover:bg-red-900/25"
              }`}
            >
              Reject Changes
            </button>
          </div>

          {/* ── Follow-up panel ── */}
          {activeAction === "followup" && (
            <div className="px-4 py-4 border-t border-gray-700">
              <p className="text-gray-400 text-xs mb-3">
                Address feedback on the changes, e.g. &quot;I got this error when using it:&quot; or
                &quot;please change the design of the button&quot;.
              </p>
              <textarea
                ref={followupTextareaRef}
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
                onClick={handleFollowupSubmit}
                disabled={isSubmittingFollowup || !followupText.trim()}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
              >
                {isSubmittingFollowup ? "Submitting…" : "Submit follow-up"}
              </button>
            </div>
          )}

          {/* ── Accept panel ── */}
          {activeAction === "accept" && (
            <div className="px-4 py-4 border-t border-gray-700">
              {canAcceptReject ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">
                    Accepting will merge the preview branch{" "}
                    <code className="bg-gray-800 px-1 rounded">{sessionBranch}</code> into{" "}
                    <code className="bg-gray-800 px-1 rounded">{branch ?? "main"}</code>.
                  </p>
                  <button
                    onClick={handleAccept}
                    disabled={acceptRejectLoading}
                    className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {acceptRejectLoading ? "Accepting…" : "Confirm"}
                  </button>
                  {acceptRejectError && (
                    <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{acceptRejectError}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-xs">
                  Accept is unavailable — this session&apos;s branch is not based on the currently
                  checked-out branch.
                </p>
              )}
            </div>
          )}

          {/* ── Reject panel ── */}
          {activeAction === "reject" && (
            <div className="px-4 py-4 border-t border-gray-700">
              {canAcceptReject ? (
                <>
                  <p className="text-gray-300 text-sm mb-4">
                    Rejecting will discard the worktree and delete the{" "}
                    <code className="bg-gray-800 px-1 rounded">{sessionBranch}</code> branch.
                  </p>
                  <button
                    onClick={handleReject}
                    disabled={acceptRejectLoading}
                    className="px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                  >
                    {acceptRejectLoading ? "Rejecting…" : "Confirm"}
                  </button>
                  {acceptRejectError && (
                    <p className="text-red-400 text-xs mt-2 whitespace-pre-wrap">{acceptRejectError}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-xs">
                  Reject is unavailable — this session&apos;s branch is not based on the currently
                  checked-out branch.
                </p>
              )}
            </div>
          )}

        </div>
      )}

      {/* Error state — allow follow-up requests to retry or recover */}
      {status === "error" && (
        <div className="mb-6 rounded-lg bg-gray-900 border border-red-800/50 text-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-red-800/30">
            <p className="text-red-400 text-xs font-medium uppercase tracking-wide">Claude encountered an error</p>
          </div>
          <div className="px-4 py-4">
            <div className="mb-4 pb-4 border-b border-red-800/30">
              <p className="text-gray-500 text-xs mb-2">You can restart the dev server to attempt recovery.</p>
              {restartError && (
                <p className="text-red-400 text-xs mb-2">{restartError}</p>
              )}
              <button
                type="button"
                onClick={handleRestartServer}
                disabled={isRestartingServer}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 text-xs font-medium transition-colors"
              >
                {isRestartingServer ? "Restarting…" : "↺ Restart dev server"}
              </button>
            </div>
            <p className="text-gray-400 text-xs mb-3">
              You can submit a follow-up request to retry or provide additional guidance.
            </p>
            <textarea
              rows={4}
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              placeholder="Describe what to try instead, or provide additional context…"
              className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-3"
            />
            {followupError && (
              <p className="text-red-400 text-xs mb-2">{followupError}</p>
            )}
            <button
              onClick={handleFollowupSubmit}
              disabled={isSubmittingFollowup || !followupText.trim()}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
            >
              {isSubmittingFollowup ? "Submitting…" : "Submit follow-up"}
            </button>
          </div>
        </div>
      )}

      {/* Disconnected notice */}
      {devServerStatus === "disconnected" && (
        <div className="mb-6 px-4 py-4 rounded-lg bg-yellow-900/40 border border-yellow-700/50 text-sm">
          <p className="text-yellow-300 mb-3">
            ⚠️ The preview server disconnected unexpectedly. The branch still exists.
          </p>
          {restartError && (
            <p className="text-red-400 text-xs mb-2">{restartError}</p>
          )}
          <button
            type="button"
            onClick={handleRestartServer}
            disabled={isRestartingServer}
            className="px-4 py-2 rounded-lg bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
          >
            {isRestartingServer ? "Restarting…" : "↺ Restart dev server"}
          </button>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-4">
          <Link href="/evolve" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
            ← Submit another request
          </Link>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
            {process.env.NODE_ENV === "development" && (
              <>
                {" "}·{" "}
                <Link href="/branches" className="text-blue-400 hover:text-blue-300">
                  Branches
                </Link>
              </>
            )}
          </span>
          <code className="font-mono text-amber-300/60">{sessionBranch}</code>
        </div>
      </div>
    </main>
  );
}
