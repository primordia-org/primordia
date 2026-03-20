"use client";

// components/EvolveForm.tsx
// The "submit a request" form for Primordia's evolve pipeline.
// Rendered at /evolve — a dedicated page, separate from the main chat interface.
//
// Evolve flow (production — NODE_ENV=production):
//   1. User submits a request.
//   2. /api/evolve?action=search checks for open evolve issues.
//   3. If matches exist, a decision card is shown: comment on an existing issue
//      (so Claude can update its branch) or create a new one.
//   4. If no matches, a new issue is created automatically.
//
// Evolve flow (development — NODE_ENV=development):
//   1. User submits a request.
//   2. POST /api/evolve/local — creates a git worktree on a fresh branch, runs
//      Claude Code via @anthropic-ai/claude-agent-sdk, then starts a Next.js
//      dev server with PREVIEW_BRANCH set.
//   3. UI polls /api/evolve/local?sessionId=... for status updates.
//   4. When ready, shows a preview link.

import { useState, useRef, useEffect, FormEvent } from "react";
import Link from "next/link";
import { SimpleMarkdown } from "./SimpleMarkdown";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: "assistant" | "system";
  content: string;
  id?: string;
}

interface RelatedIssue {
  number: number;
  title: string;
  html_url: string;
}

interface EvolveResult {
  type: "created" | "commented";
  issueNumber?: number;
  issueUrl?: string;
  commentUrl?: string;
}

interface EvolveStatus {
  claudeComment?: { body: string; htmlUrl: string; updatedAt: string };
  pr?: { number: number; htmlUrl: string; title: string };
  deployPreviewUrl?: string;
}

interface LocalEvolveSession {
  id: string;
  status: "starting" | "running-claude" | "starting-server" | "ready" | "error";
  progressText: string;
  previewUrl: string | null;
  branch: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EvolveForm() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [evolveResult, setEvolveResult] = useState<EvolveResult | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [relatedIssues, setRelatedIssues] = useState<RelatedIssue[] | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [evolveLoadingMsg, setEvolveLoadingMsg] = useState<string>("Checking for related issues…");
  const [localEvolveSession, setLocalEvolveSession] = useState<LocalEvolveSession | null>(null);
  // deployPrBranch is only set on Vercel preview deployments (fetched from /api/deploy-context)
  const [deployPrBranch, setDeployPrBranch] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize the textarea as the user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  // Cancel any in-flight polling when the component unmounts
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current !== null) clearInterval(pollingIntervalRef.current);
      if (localPollingRef.current !== null) clearInterval(localPollingRef.current);
    };
  }, []);

  // On Vercel preview deployments, fetch the PR branch so evolve requests
  // branch off the preview rather than main.
  useEffect(() => {
    if (process.env.VERCEL_ENV !== "preview") return;
    fetch("/api/deploy-context")
      .then((res) => res.json())
      .then((data: { prBranch?: string }) => {
        if (data.prBranch) setDeployPrBranch(data.prBranch);
      })
      .catch(() => {});
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);
    setEvolveResult(null);
    setSubmitted(true);

    if (process.env.NODE_ENV === "development") {
      await handleLocalEvolveSubmit(trimmed);
    } else {
      await handleEvolveSubmit(trimmed);
    }

    setIsLoading(false);
  }

  async function handleEvolveSubmit(request: string) {
    setPendingRequest(null);
    setRelatedIssues(null);

    // First, search for related open evolve issues
    setEvolveLoadingMsg("Checking for related issues…");
    try {
      const res = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", request }),
      });
      if (res.ok) {
        const data = (await res.json()) as { issues?: RelatedIssue[] };
        if (data.issues && data.issues.length > 0) {
          setPendingRequest(request);
          setRelatedIssues(data.issues);
          return;
        }
      }
    } catch {
      // Search failed — fall through to auto-create
    }

    setEvolveLoadingMsg("Opening GitHub issue…");
    await performEvolveCreate(request);
  }

  // ── Local evolve (development only) ───────────────────────────────────────

  async function handleLocalEvolveSubmit(request: string) {
    const statusMsgId = `local-evolve-status-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { role: "assistant", id: statusMsgId, content: "⏳ Setting up local preview…" },
    ]);

    try {
      const res = await fetch("/api/evolve/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });

      const data = (await res.json()) as { sessionId?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }

      startLocalEvolvePolling(data.sessionId!, statusMsgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === statusMsgId
            ? { ...m, content: `Failed to start local evolve: ${errorMsg}` }
            : m,
        ),
      );
    }
  }

  function startLocalEvolvePolling(sessionId: string, statusMsgId: string) {
    if (localPollingRef.current !== null) clearInterval(localPollingRef.current);

    localPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/evolve/local?sessionId=${sessionId}`);
        if (!res.ok) return;

        const data = (await res.json()) as LocalEvolveSession;
        setLocalEvolveSession({ ...data, id: sessionId });

        const progressContent = `**Local Evolve Progress**:\n\n${data.progressText || "⏳ Starting…"}`;
        setMessages((prev) =>
          prev.map((m) => (m.id === statusMsgId ? { ...m, content: progressContent } : m)),
        );

        if (data.status === "ready" || data.status === "error") {
          clearInterval(localPollingRef.current!);
          localPollingRef.current = null;

          if (data.status === "ready" && data.previewUrl) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  `🚀 Preview ready: [${data.previewUrl}](${data.previewUrl})\n\n` +
                  `Open the preview link and use the **Accept** or **Reject** bar there to apply or discard the changes.`,
              },
            ]);
          }
        }
      } catch {
        // Silently ignore transient network errors between polls
      }
    }, 5_000);
  }

  // ── GitHub evolve helpers (production) ────────────────────────────────────

  async function handleEvolveComment(issueNumber: number) {
    if (!pendingRequest || isLoading) return;
    const request = pendingRequest;
    setPendingRequest(null);
    setRelatedIssues(null);
    setIsLoading(true);
    setEvolveLoadingMsg("Adding comment to issue…");

    try {
      const res = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", issueNumber, request }),
      });

      const data = (await res.json()) as {
        outcome?: string;
        issueNumber?: number;
        prNumber?: number | null;
        prUrl?: string | null;
        commentUrl?: string;
        error?: string;
      };

      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);

      setEvolveResult({ type: "commented", commentUrl: data.commentUrl });

      const targetLabel = data.prNumber
        ? `[PR #${data.prNumber}](${data.prUrl})`
        : `[Issue #${issueNumber}](${data.commentUrl})`;

      const statusMsgId = `evolve-status-${issueNumber}`;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Got it! I've added your request as a [comment](${data.commentUrl}) on ${targetLabel}. Claude Code will pick it up and continue on the existing branch. Progress will appear below.`,
        },
        {
          role: "assistant",
          id: statusMsgId,
          content: "⏳ Waiting for CI to start…",
        },
      ]);

      startEvolvePolling(issueNumber, statusMsgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to add comment: ${errorMsg}` },
      ]);
    }

    setIsLoading(false);
  }

  async function handleEvolveCreate() {
    if (!pendingRequest || isLoading) return;
    const request = pendingRequest;
    setPendingRequest(null);
    setRelatedIssues(null);
    setIsLoading(true);
    setEvolveLoadingMsg("Opening GitHub issue…");
    await performEvolveCreate(request);
    setIsLoading(false);
  }

  async function performEvolveCreate(request: string) {
    try {
      const response = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          request,
          parentBranch: deployPrBranch ?? undefined,
        }),
      });

      const data = (await response.json()) as {
        issueNumber: number;
        issueUrl: string;
        error?: string;
      };

      if (!response.ok) throw new Error(data.error ?? `API error: ${response.statusText}`);

      setEvolveResult({
        type: "created",
        issueNumber: data.issueNumber,
        issueUrl: data.issueUrl,
      });

      const statusMsgId = `evolve-status-${data.issueNumber}`;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Got it! I've opened [GitHub Issue #${data.issueNumber}](${data.issueUrl}) for your request. The CI pipeline is now running — progress will appear below.`,
        },
        {
          role: "assistant",
          id: statusMsgId,
          content: "⏳ Waiting for CI to start…",
        },
      ]);

      startEvolvePolling(data.issueNumber, statusMsgId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to submit evolve request: ${errorMsg}` },
      ]);
    }
  }

  function startEvolvePolling(issueNumber: number, statusMsgId: string) {
    if (pollingIntervalRef.current !== null) clearInterval(pollingIntervalRef.current);

    const tracker = {
      lastCommentUpdatedAt: "",
      prMessageAdded: false,
      deployMessageAdded: false,
      pollCount: 0,
    };

    const MAX_POLLS = 90; // ~15 minutes at 10 s intervals

    pollingIntervalRef.current = setInterval(async () => {
      tracker.pollCount++;

      if (tracker.pollCount > MAX_POLLS) {
        clearInterval(pollingIntervalRef.current!);
        pollingIntervalRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === statusMsgId
              ? {
                  ...m,
                  content:
                    m.content +
                    "\n\n⚠️ Stopped watching after 15 minutes. Check GitHub for the latest status.",
                }
              : m
          )
        );
        return;
      }

      try {
        const res = await fetch(`/api/evolve/status?issueNumber=${issueNumber}`);
        if (!res.ok) return;

        const status = (await res.json()) as EvolveStatus;

        if (
          status.claudeComment &&
          status.claudeComment.updatedAt !== tracker.lastCommentUpdatedAt
        ) {
          tracker.lastCommentUpdatedAt = status.claudeComment.updatedAt;
          const { body, htmlUrl } = status.claudeComment;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === statusMsgId
                ? { ...m, content: `**CI Progress** ([view on GitHub](${htmlUrl})):\n\n${body}` }
                : m
            )
          );
        }

        if (status.pr && !tracker.prMessageAdded) {
          tracker.prMessageAdded = true;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `✅ PR created: [#${status.pr!.number} — ${status.pr!.title}](${status.pr!.htmlUrl})`,
            },
          ]);
        }

        if (status.deployPreviewUrl && !tracker.deployMessageAdded) {
          tracker.deployMessageAdded = true;
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `🚀 Deploy preview ready: [${status.deployPreviewUrl}](${status.deployPreviewUrl})`,
            },
          ]);
        }
      } catch {
        // Silently ignore transient network errors between polls
      }
    }, 10_000);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  function handleReset() {
    setSubmitted(false);
    setInput("");
    setMessages([]);
    setEvolveResult(null);
    setRelatedIssues(null);
    setPendingRequest(null);
    setLocalEvolveSession(null);
    if (pollingIntervalRef.current !== null) clearInterval(pollingIntervalRef.current);
    if (localPollingRef.current !== null) clearInterval(localPollingRef.current);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Primordia</h1>
          <p className="text-xs text-gray-400 mt-0.5">Propose a change</p>
        </div>
        <Link
          href="/"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Back to chat
        </Link>
      </header>

      {/* Description banner */}
      {!submitted && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm">
          <strong className="font-semibold">Evolve Primordia</strong> —{" "}
          {process.env.NODE_ENV === "development" ? (
            <>
              Describe a change you want to make to this app. Claude Code will implement it
              locally in a preview server — no GitHub required.
            </>
          ) : (
            <>
              Describe a change you want to make to this app. Your request will become a
              GitHub Issue and trigger an automated PR.
            </>
          )}
        </div>
      )}

      {/* Progress messages (shown after submission) */}
      {submitted && messages.length > 0 && (
        <div className="flex-1 space-y-4 mb-6">
          {messages.map((msg, i) => (
            <div key={msg.id ?? i} className="px-4 py-3 rounded-lg bg-gray-800 text-gray-100 text-sm leading-relaxed">
              <SimpleMarkdown text={msg.content} />
            </div>
          ))}
          {isLoading && (
            <div className="text-sm text-gray-500 animate-pulse">{evolveLoadingMsg}</div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Decision card — shown when open evolve issues were found (production only) */}
      {relatedIssues !== null && relatedIssues.length > 0 && pendingRequest && !isLoading && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/30 border border-amber-700/40 text-sm space-y-3">
          <p className="text-amber-200 font-semibold">
            Found {relatedIssues.length} open evolve request
            {relatedIssues.length > 1 ? "s" : ""}. Add your request to one, or create a new
            issue:
          </p>
          <ul className="space-y-2">
            {relatedIssues.map((issue) => (
              <li key={issue.number} className="flex items-center gap-2">
                <a
                  href={issue.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-300 underline hover:text-amber-200 truncate flex-1 min-w-0 text-xs"
                >
                  #{issue.number}: {issue.title}
                </a>
                <button
                  onClick={() => handleEvolveComment(issue.number)}
                  disabled={isLoading}
                  className="flex-shrink-0 px-2 py-1 text-xs bg-amber-700 hover:bg-amber-600 rounded text-white disabled:opacity-50"
                >
                  Add comment
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={handleEvolveCreate}
            disabled={isLoading}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 disabled:opacity-50"
          >
            Create new issue instead
          </button>
        </div>
      )}

      {/* Evolve result card (after GitHub issue is created/commented) */}
      {evolveResult && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm">
          {evolveResult.type === "commented" ? (
            <>
              Comment added —{" "}
              <a
                href={evolveResult.commentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-green-200"
              >
                view comment
              </a>{" "}
              — Claude will update the existing branch.
            </>
          ) : (
            <>
              Issue{" "}
              <a
                href={evolveResult.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:text-green-200"
              >
                #{evolveResult.issueNumber}
              </a>{" "}
              opened — watching for CI progress, PR, and deploy preview…
            </>
          )}
        </div>
      )}

      {/* Input form */}
      {!submitted ? (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 border border-gray-800 rounded-xl bg-gray-900 p-4"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the change you want to make to this app…"
            rows={4}
            disabled={isLoading}
            className="resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none max-h-64 leading-relaxed"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white disabled:cursor-not-allowed"
            >
              {isLoading ? "…" : "Submit Request"}
            </button>
          </div>
        </form>
      ) : (
        /* After submission, offer to submit another request */
        !isLoading && relatedIssues === null && (
          <div className="mt-4">
            <button
              onClick={handleReset}
              className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              ← Submit another request
            </button>
          </div>
        )
      )}
    </main>
  );
}
