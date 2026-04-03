"use client";

// components/EvolveSessionView.tsx
// Client component rendered by /evolve/session/[id].
// Streams live Claude Code progress via SSE from /api/evolve/stream.

import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownContent } from "./SimpleMarkdown";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { FloatingEvolveDialog } from "./FloatingEvolveDialog";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";
import Link from "next/link";

// ─── Section parsing ──────────────────────────────────────────────────────────

interface ParsedSection {
  heading: string;
  content: string;
}

function parseProgressSections(text: string): ParsedSection[] {
  if (!text.trim()) return [];

  // Split on a newline immediately followed by "### " + an emoji to locate section
  // boundaries. All real section headings start with an emoji (e.g. "### 🤖 Claude Code");
  // markdown headings inside Claude's summary text (e.g. "### Changes made") begin with
  // an ASCII letter and must NOT be treated as section delimiters.
  const chunks = text.split(/\n(?=### [^\u0000-\u007F])/u);

  return chunks
    .map((chunk, i) => {
      if (i === 0) {
        // First chunk has no ### heading — it is the Setup section.
        const content = chunk
          .replace(/\n\n---\s*$/, "")
          .replace(/\n---\s*$/, "")
          .trim();
        return { heading: "Setup", content };
      }
      // All subsequent chunks start with "### heading\n..."
      const newlineIdx = chunk.indexOf("\n");
      const heading =
        newlineIdx === -1
          ? chunk.replace(/^### /, "").trim()
          : chunk.slice(0, newlineIdx).replace(/^### /, "").trim();
      const rawContent = newlineIdx === -1 ? "" : chunk.slice(newlineIdx + 1);
      const content = rawContent
        .replace(/\n\n---\s*$/, "")
        .replace(/\n---\s*$/, "")
        .trim();
      return { heading, content };
    })
    .filter((s) => s.heading || s.content);
}

/**
 * For a finished Claude Code (or type-fix) section, split content into:
 * - `detailsContent`: all blocks except the last → goes in <details>
 * - `finalItem`: the last block (Claude's summary / final message) → shown outside
 * - `toolCallCount`: total `- 🔧 ` lines in the content
 */
function splitClaudeContent(content: string): {
  detailsContent: string;
  finalItem: string;
  toolCallCount: number;
} {
  // Strip any decision log entry (---\n\n✅ **Accepted**… or 🗑️ **Rejected**…) that may
  // have been appended after the finish marker by logDecision() in manage/route.ts.
  const stripped = content
    .replace(/\n*---\n+(?:✅ \*\*Accepted\*\*|🗑️ \*\*Rejected\*\*)[^\n]*\n?$/, "")
    .replace(/\n?✅ \*\*Claude Code finished\.\*\*\s*$/, "")
    .replace(/\n?✅ \*\*Follow-up complete\. Preview server will reload automatically\.\*\*\s*$/, "")
    .trim();

  const toolCallCount = (stripped.match(/^- 🔧 /gm) ?? []).length;

  // Find the last tool call line and split there: everything after it is the
  // final message Claude wrote, everything up to and including it is detail.
  const lines = stripped.split("\n");
  let lastToolIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("- 🔧 ")) {
      lastToolIdx = i;
      break;
    }
  }

  if (lastToolIdx === -1) {
    // No tool calls — everything is the final message
    return { detailsContent: "", finalItem: stripped, toolCallCount };
  }

  const detailsContent = lines.slice(0, lastToolIdx + 1).join("\n").trim();
  const finalItem = lines.slice(lastToolIdx + 1).join("\n").trim();
  return { detailsContent, finalItem, toolCallCount };
}

// ─── LogSection ───────────────────────────────────────────────────────────────

function LogSection({
  section,
  isActive,
  previewUrl,
}: {
  section: ParsedSection;
  isActive: boolean;
  previewUrl?: string | null;
}) {
  const { heading, content } = section;

  const isFollowupSection = heading.includes("Follow-up Request");
  const isClaudeSection = heading.includes("Claude Code");
  const isTypeFixSection = heading.includes("Fixing type errors");
  const isServerSection =
    heading.includes("Starting preview server") ||
    heading.includes("Restarting preview server");

  // ── Follow-up Request: render like "Your request" ─────────────────────────
  if (isFollowupSection) {
    const requestText = content.replace(/^> /m, "").trim();
    return (
      <div className="px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
        <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Follow-up request</p>
        <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{requestText}</p>
      </div>
    );
  }

  // ── Claude Code / Fixing type errors ──────────────────────────────────────
  if (isClaudeSection || isTypeFixSection) {
    const borderClass = isTypeFixSection ? "border-orange-700/50" : "border-blue-700/50";
    const headingClass = isTypeFixSection ? "text-orange-300" : "text-blue-300";
    const doneTitle = isTypeFixSection ? "🔧 Type errors fixed" : "🤖 Claude Code finished";

    // Treat the section as finished if the content already contains an end marker,
    // even if the status update hasn't arrived in the same SSE tick yet.
    const hasFinishMarker =
      content.includes("✅ **Claude Code finished.**") ||
      content.includes("✅ **Follow-up complete. Preview server will reload automatically.**");
    const isRunning = isActive && !hasFinishMarker;

    if (isRunning) {
      return (
        <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className={`font-semibold text-xs ${headingClass}`}>{heading}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Running…
            </span>
          </div>
          <div className="px-4 py-3">
            <MarkdownContent text={content || " "} />
          </div>
        </div>
      );
    }

    // Done — collapse tool calls into <details>, show final message outside
    const { detailsContent, finalItem, toolCallCount } = splitClaudeContent(content);
    return (
      <div className={`rounded-lg border ${borderClass} bg-gray-900 text-sm overflow-hidden`}>
        <div className="px-4 py-2.5 border-b border-gray-800">
          <span className={`font-semibold text-xs ${headingClass}`}>{doneTitle}</span>
        </div>
        {detailsContent && (
          <details className="group border-b border-gray-800">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
              <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-gray-500">
                🔧 {toolCallCount} tool call{toolCallCount !== 1 ? "s" : ""} made
              </span>
            </summary>
            <div className="px-4 py-3 border-t border-gray-800">
              <MarkdownContent text={detailsContent} />
            </div>
          </details>
        )}
        {finalItem && (
          <div className="px-4 py-3">
            <MarkdownContent text={finalItem} />
          </div>
        )}
      </div>
    );
  }

  // ── Preview server ─────────────────────────────────────────────────────────
  if (isServerSection) {
    if (isActive) {
      return (
        <div className="rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
            <span className="font-semibold text-xs text-emerald-300">{heading}</span>
            <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              Starting…
            </span>
          </div>
          <div className="px-4 py-3">
            <MarkdownContent text={content || " "} />
          </div>
        </div>
      );
    }

    // Done — collapse server logs, show preview URL
    return (
      <div className="rounded-lg border border-emerald-700/50 bg-gray-900 text-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800">
          <span className="font-semibold text-xs text-emerald-300">🚀 Preview ready</span>
        </div>
        {content && (
          <details className="group border-b border-gray-800">
            <summary className="flex items-center gap-2 px-4 py-2 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none text-xs">
              <span className="text-gray-600 group-open:rotate-90 transition-transform">▶</span>
              <span className="text-gray-500">🪵 Server logs</span>
            </summary>
            <div className="px-4 py-3 border-t border-gray-800">
              <MarkdownContent text={content} />
            </div>
          </details>
        )}
        {previewUrl && (
          <div className="px-4 py-3">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-200 underline break-all"
            >
              {previewUrl}
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── Default: fallback collapsible ──────────────────────────────────────────
  if (isActive) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 text-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
          <span className="font-semibold text-xs text-gray-300">{heading}</span>
          <span className="ml-auto flex items-center gap-1.5 text-gray-500 text-xs animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
            Running…
          </span>
        </div>
        <div className="px-4 py-3">
          <MarkdownContent text={content || " "} />
        </div>
      </div>
    );
  }

  return (
    <details className="group rounded-lg border border-gray-800 overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-gray-800/40 transition-colors list-none">
        <span className="text-gray-600 group-open:rotate-90 transition-transform flex-shrink-0 text-xs">
          ▶
        </span>
        <span className="font-semibold text-xs flex-shrink-0 text-gray-300">{heading}</span>
      </summary>
      <div className="px-4 py-3 border-t border-gray-800">
        <MarkdownContent text={content} />
      </div>
    </details>
  );
}

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
  /** True when the current user has the can_evolve (or admin) permission. Actions are hidden when false. */
  canEvolve: boolean;
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
  canEvolve,
}: EvolveSessionViewProps) {
  const [progressText, setProgressText] = useState(initialProgressText);
  const [status, setStatus] = useState(initialStatus);
  const [devServerStatus, setDevServerStatus] = useState(initialDevServerStatus);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreviewUrl);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const { sessionUser, handleLogout } = useSessionUser();
  const [followupText, setFollowupText] = useState('');
  const [followupFiles, setFollowupFiles] = useState<File[]>([]);
  const [isSubmittingFollowup, setIsSubmittingFollowup] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [acceptRejectLoading, setAcceptRejectLoading] = useState(false);
  const [acceptRejectError, setAcceptRejectError] = useState<string | null>(null);
  /** Which of the three action panels is currently expanded, or null if all collapsed. */
  const [activeAction, setActiveAction] = useState<"accept" | "reject" | "followup" | null>(null);
  const [isRestartingServer, setIsRestartingServer] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [isAborting, setIsAborting] = useState(false);
  const [abortError, setAbortError] = useState<string | null>(null);
  const [isDraggingFollowup, setIsDraggingFollowup] = useState(false);
  const [remainingUpstream, setRemainingUpstream] = useState(upstreamCommitCount);
  const [upstreamSyncLoading, setUpstreamSyncLoading] = useState<"merge" | "rebase" | null>(null);
  const [upstreamSyncError, setUpstreamSyncError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Tracks how many characters of progressText the client has received, for SSE reconnection. */
  const progressLengthRef = useRef(initialProgressText.length);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const followupTextareaRef = useRef<HTMLTextAreaElement>(null);
  const followupFileInputRef = useRef<HTMLInputElement>(null);
  /**
   * True when the user is scrolled to (or near) the bottom.
   * Updated by a scroll listener so we capture position *before* new content
   * is rendered — checking scrollHeight inside the progressText effect would
   * be wrong because the DOM has already grown by then.
   */
  const wasAtBottomRef = useRef(true);

  // Track scroll position so we know whether to auto-scroll on new content.
  useEffect(() => {
    function onScroll() {
      // Use clientHeight (layout viewport) rather than window.innerHeight
      // (visual viewport) so mobile address-bar hide/show doesn't cause
      // false "not at bottom" readings.
      wasAtBottomRef.current =
        window.scrollY + document.documentElement.clientHeight >=
        document.documentElement.scrollHeight - 40;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Auto-scroll to bottom as progress grows, but only if the user is already at the bottom.
  useEffect(() => {
    if (wasAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
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
            if (parsed.status != null) {
              setStatus(parsed.status);
            }
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

  async function handleAbort() {
    setIsAborting(true);
    setAbortError(null);

    try {
      const res = await fetch('/api/evolve/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      // The server will transition the session to ready; keep streaming to catch the update.
      void startStreaming();
    } catch (err) {
      setAbortError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAborting(false);
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

  function handleFollowupFilesAdded(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    setFollowupFiles(prev => {
      const existing = new Set(prev.map(f => `${f.name}:${f.size}`));
      return [...prev, ...arr.filter(f => !existing.has(`${f.name}:${f.size}`))];
    });
  }

  function handleRemoveFollowupFile(index: number) {
    setFollowupFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleFollowupDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingFollowup(true);
  }

  function handleFollowupDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingFollowup(false);
    }
  }

  function handleFollowupDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDraggingFollowup(false);
    if (e.dataTransfer.files.length > 0) {
      handleFollowupFilesAdded(e.dataTransfer.files);
    }
  }

  function handleFollowupPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
    if (files.length > 0) {
      handleFollowupFilesAdded(files);
    }
  }

  async function handleFollowupSubmit() {
    const trimmed = followupText.trim();
    if (!trimmed) return;

    setIsSubmittingFollowup(true);
    setFollowupError(null);

    try {
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      formData.append('request', trimmed);
      for (const file of followupFiles) {
        formData.append('attachments', file);
      }

      const res = await fetch('/api/evolve/followup', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Server error: ${res.status}`);
      }

      setFollowupText('');
      setFollowupFiles([]);
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
      if (data.outcome === 'accepting') {
        // Accept is running async on the server — stream its progress via SSE.
        setStatus('accepting');
        setActiveAction(null);
        void startStreaming();
        return;
      }
      if (data.outcome === 'auto-fixing-types') {
        // Type check failed — the server automatically started a fix run and will
        // retry Accept when done. Stream the progress; the server handles the rest.
        setStatus('fixing-types');
        setActiveAction(null);
        void startStreaming();
        return;
      }
      setStatus('accepted');
      abortControllerRef.current?.abort();
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

  /** True while the session pipeline is actively running (not yet ready for action). */
  const isClaudeRunning = status === "starting" || status === "running-claude" || status === "fixing-types";

  // Extract the branch name from the "✅ **Accepted** — merged into `foo`" decision log line.
  const mergedIntoBranch = progressText
    ? (progressText.match(/✅ \*\*Accepted\*\* — merged into `([^`]+)`/) ?? [])[1] ?? null
    : null;

  // Parse progress into sections; integrate setup into the "Created branch" card.
  const sections = progressText ? parseProgressSections(progressText) : [];
  const setupSection = sections.length > 0 && sections[0].heading === "Setup" ? sections[0] : null;
  const contentSections = sections.filter((s) => s.heading !== "Setup");
  // Setup is "active" while it's the only section (no ### headings yet) and we're not terminal.
  const isSetupActive = !isTerminal && (sections.length === 0 || (sections.length === 1 && sections[0].heading === "Setup"));
  const setupStepCount = setupSection
    ? (setupSection.content.match(/^- \[x\]/gm) ?? []).length
    : 0;

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Session" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          containerRef={hamburgerRef}
          items={buildStandardMenuItems({
            onSyncClick: () => setSyncDialogOpen(true),
            onEvolveClick: () => {
              setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
              setEvolveDialogOpen(true);
            },
            isAdmin: sessionUser?.isAdmin ?? false,
          })}
        />
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
        {evolveDialogOpen && (
          <FloatingEvolveDialog
            onClose={() => setEvolveDialogOpen(false)}
            anchorRect={evolveAnchorRect}
          />
        )}
      </header>

      {/* Original request */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
        <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Your request</p>
        <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{initialRequest}</p>
      </div>

      {/* Created branch — setup steps fold into this card */}
      <div className="mb-6 px-4 py-4 rounded-lg bg-amber-900/40 border border-amber-700/50 text-sm">
        <p className="text-amber-300 font-semibold mb-1 flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="15"/>
            <circle cx="18" cy="6" r="3"/>
            <circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          {isSetupActive ? (
            <>
              Creating branch…
              <span className="ml-1 flex items-center gap-1 text-amber-600/70 text-xs animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
              </span>
            </>
          ) : (
            "Created branch"
          )}
        </p>
        <code className="font-mono text-amber-200 text-sm">{sessionBranch}</code>
        {!isSetupActive && setupSection && (
          <details className="group mt-2">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-amber-600/80 hover:text-amber-400 transition-colors list-none">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              ✅ {setupStepCount} step{setupStepCount !== 1 ? "s" : ""} completed
            </summary>
            <div className="mt-2 pl-2 border-l border-amber-700/30">
              <MarkdownContent text={setupSection.content} />
            </div>
          </details>
        )}
      </div>

      {/* Progress sections */}
      <div className="mb-6 flex flex-col gap-6">
        {contentSections.map((section, i) => {
          const isSectionActive = i === contentSections.length - 1 && !isTerminal;
          const isServer =
            section.heading.includes("Starting preview server") ||
            section.heading.includes("Restarting preview server");
          return (
            <LogSection
              key={i}
              section={section}
              isActive={isSectionActive}
              previewUrl={isServer ? previewUrl : undefined}
            />
          );
        })}

        {/* Accepted banner — inline with other sections */}
        {status === "accepted" && (
          <div className="px-4 py-4 rounded-lg bg-green-900/40 border border-green-700/50 text-sm">
            <p className="text-green-200 font-semibold">✅ Changes accepted</p>
            <p className="text-green-300/80 text-xs mt-1">
              {mergedIntoBranch
                ? <>The branch was merged into <code className="bg-green-950/60 px-1 rounded">{mergedIntoBranch}</code> and the worktree has been removed.</>
                : "The branch was merged and the worktree has been removed."}
            </p>
          </div>
        )}

        {/* Rejected banner — inline with other sections */}
        {status === "rejected" && (
          <div className="px-4 py-4 rounded-lg bg-red-900/40 border border-red-700/50 text-sm">
            <p className="text-red-200 font-semibold">🗑️ Changes rejected</p>
            <p className="text-red-300/80 text-xs mt-1">
              The branch and worktree have been discarded.
            </p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Upstream Changes — shown when the parent branch has commits not yet in the session branch; hidden for non-evolvers */}
      {canEvolve && remainingUpstream > 0 && status !== "accepted" && status !== "rejected" && (
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

      {/* Three-action panel — shown to users with can_evolve permission; hidden for public viewers */}
      {canEvolve && status !== "accepted" && status !== "rejected" && status !== "error" && (
        <div className="mb-6 rounded-lg bg-gray-900 border border-gray-700 text-sm overflow-hidden">

          {/* ── Header ── */}
          <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
            <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">Available Actions</p>
            {isClaudeRunning ? (
              <button
                type="button"
                onClick={handleAbort}
                disabled={isAborting}
                className="text-xs text-red-400 hover:text-red-200 disabled:text-gray-600 transition-colors"
              >
                {isAborting ? "Aborting…" : "⏹ Abort"}
              </button>
            ) : status === "ready" && devServerStatus !== "starting" ? (
              <button
                type="button"
                onClick={handleRestartServer}
                disabled={isRestartingServer}
                className="text-xs text-gray-400 hover:text-gray-200 disabled:text-gray-600 transition-colors"
              >
                {isRestartingServer
                  ? (devServerStatus === "none" ? "Starting…" : "Restarting…")
                  : (devServerStatus === "none" ? "▶ Start preview" : "↺ Restart preview")}
              </button>
            ) : null}
          </div>

          {abortError && (
            <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-700">{abortError}</p>
          )}
          {restartError && (
            <p className="px-4 py-2 text-red-400 text-xs border-b border-gray-700">{restartError}</p>
          )}

          {/* ── Button row (or fixing-types indicator) ── */}
          {status === "accepting" ? (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-green-300">
              <span className="animate-spin inline-block">⟳</span>
              Accepting changes…
            </div>
          ) : status === "fixing-types" ? (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-amber-300">
              <span className="animate-spin inline-block">⟳</span>
              Fixing type errors… will auto-accept when complete.
            </div>
          ) : (
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
                onClick={isClaudeRunning ? undefined : () => toggleAction("accept")}
                disabled={isClaudeRunning}
                className={`flex-1 px-4 py-3 text-sm font-medium border-r border-gray-700 transition-colors ${
                  isClaudeRunning
                    ? "text-gray-600 cursor-not-allowed"
                    : activeAction === "accept"
                    ? "bg-green-900/40 text-green-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-green-300 bg-green-900/10 hover:bg-green-900/25"
                }`}
              >
                Accept Changes
              </button>
              <button
                onClick={isClaudeRunning ? undefined : () => toggleAction("reject")}
                disabled={isClaudeRunning}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  isClaudeRunning
                    ? "text-gray-600 cursor-not-allowed"
                    : activeAction === "reject"
                    ? "bg-red-900/40 text-red-200"
                    : activeAction !== null
                    ? "text-gray-500 hover:bg-gray-800 hover:text-gray-300"
                    : "text-red-300 bg-red-900/10 hover:bg-red-900/25"
                }`}
              >
                Reject Changes
              </button>
            </div>
          )}

          {/* ── Follow-up panel ── */}
          {activeAction === "followup" && (
            <div
              className={`px-4 py-4 border-t transition-colors ${isDraggingFollowup ? "border-amber-500/70 bg-amber-950/10" : "border-gray-700"}`}
              onDragOver={handleFollowupDragOver}
              onDragLeave={handleFollowupDragLeave}
              onDrop={handleFollowupDrop}
            >
              <p className="text-gray-400 text-xs mb-3">
                Address feedback on the changes, e.g. &quot;I got this error when using it:&quot; or
                &quot;please change the design of the button&quot;.
              </p>
              <textarea
                ref={followupTextareaRef}
                rows={4}
                value={followupText}
                onChange={(e) => setFollowupText(e.target.value)}
                onPaste={handleFollowupPaste}
                placeholder="Describe what to fix or improve…"
                className="w-full bg-gray-800 text-gray-100 placeholder-gray-500 border border-gray-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-2"
              />
              {/* Attached file chips */}
              {followupFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {followupFiles.map((file, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300">
                      <span className="truncate max-w-[160px]">{file.name}</span>
                      <button type="button" onClick={() => handleRemoveFollowupFile(i)} className="text-gray-500 hover:text-gray-200 ml-1">✕</button>
                    </span>
                  ))}
                </div>
              )}
              {followupError && (
                <p className="text-red-400 text-xs mb-2">{followupError}</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={followupFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml"
                  className="hidden"
                  onChange={(e) => { if (e.target.files) handleFollowupFilesAdded(e.target.files); e.target.value = ""; }}
                />
                <button
                  type="button"
                  onClick={() => followupFileInputRef.current?.click()}
                  disabled={isClaudeRunning || isSubmittingFollowup}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.121l7-7a.5.5 0 0 1 .707.708l-7 7a2.5 2.5 0 0 1-3.536-3.536l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7A6.5 6.5 0 0 1 2.45 9.955l7-7a.5.5 0 1 1 .707.708l-7 7A5.5 5.5 0 0 0 10.95 18.92l7-7a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
                  </svg>
                  Attach files
                </button>
                <button
                  onClick={handleFollowupSubmit}
                  disabled={isClaudeRunning || isSubmittingFollowup || !followupText.trim()}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
                >
                  {isSubmittingFollowup ? "Submitting…" : isClaudeRunning ? "Waiting for Claude to finish…" : "Submit follow-up"}
                </button>
              </div>
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

      {/* Error state — allow follow-up requests to retry or recover; hidden for non-evolvers */}
      {canEvolve && status === "error" && (
        <div className="mb-6 rounded-lg bg-gray-900 border border-red-800/50 text-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-red-800/30">
            <p className="text-red-400 text-xs font-medium uppercase tracking-wide">Claude encountered an error</p>
          </div>
          <div
            className="px-4 py-4"
            onDragOver={handleFollowupDragOver}
            onDragLeave={handleFollowupDragLeave}
            onDrop={handleFollowupDrop}
          >
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
                {isRestartingServer ? "Restarting…" : "↺ Restart preview"}
              </button>
            </div>
            <p className="text-gray-400 text-xs mb-3">
              You can submit a follow-up request to retry or provide additional guidance.
            </p>
            <textarea
              rows={4}
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              onPaste={handleFollowupPaste}
              placeholder="Describe what to try instead, or provide additional context…"
              className={`w-full bg-gray-800 text-gray-100 placeholder-gray-500 border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 mb-2 transition-colors ${isDraggingFollowup ? "border-amber-500/70" : "border-gray-700"}`}
            />
            {/* Attached file chips */}
            {followupFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {followupFiles.map((file, i) => (
                  <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300">
                    <span className="truncate max-w-[160px]">{file.name}</span>
                    <button type="button" onClick={() => handleRemoveFollowupFile(i)} className="text-gray-500 hover:text-gray-200 ml-1">✕</button>
                  </span>
                ))}
              </div>
            )}
            {followupError && (
              <p className="text-red-400 text-xs mb-2">{followupError}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => followupFileInputRef.current?.click()}
                disabled={isSubmittingFollowup}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-gray-700 transition-colors disabled:opacity-50"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a1.5 1.5 0 0 0 2.122 2.121l7-7a.5.5 0 0 1 .707.708l-7 7a2.5 2.5 0 0 1-3.536-3.536l7-7a4.5 4.5 0 0 1 6.364 6.364l-7 7A6.5 6.5 0 0 1 2.45 9.955l7-7a.5.5 0 1 1 .707.708l-7 7A5.5 5.5 0 0 0 10.95 18.92l7-7a3 3 0 0 0 0-4.242Z" clipRule="evenodd" />
                </svg>
                Attach files
              </button>
              <button
                onClick={handleFollowupSubmit}
                disabled={isSubmittingFollowup || !followupText.trim()}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
              >
                {isSubmittingFollowup ? "Submitting…" : "Submit follow-up"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnected notice — restart action hidden for non-evolvers */}
      {devServerStatus === "disconnected" && status !== "accepted" && status !== "rejected" && (
        <div className="mb-6 px-4 py-4 rounded-lg bg-yellow-900/40 border border-yellow-700/50 text-sm">
          <p className="text-yellow-300 mb-3">
            ⚠️ The preview server disconnected unexpectedly. The branch still exists.
          </p>
          {canEvolve && restartError && (
            <p className="text-red-400 text-xs mb-2">{restartError}</p>
          )}
          {canEvolve && (
            <button
              type="button"
              onClick={handleRestartServer}
              disabled={isRestartingServer}
              className="px-4 py-2 rounded-lg bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium transition-colors"
            >
              {isRestartingServer ? "Restarting…" : "↺ Restart preview"}
            </button>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-col gap-2">
        {canEvolve && (
          <div className="flex gap-4">
            <Link href="/evolve" className="text-sm text-gray-400 hover:text-gray-200 transition-colors">
              ← Submit another request
            </Link>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
            <>
              {" "}·{" "}
              <Link href="/branches" className="text-blue-400 hover:text-blue-300">
                Branches
              </Link>
            </>
          </span>
          <code className="font-mono text-amber-300/60">{sessionBranch}</code>
        </div>
      </div>
    </main>
  );
}
