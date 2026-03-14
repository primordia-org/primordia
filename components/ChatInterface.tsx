"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Handles two modes:
//   - "chat" mode: streams responses from Claude via /api/chat
//   - "evolve" mode: submits a change request, triggering an automated implementation
//
// Evolve flow (production / NODE_ENV=production):
//   1. User submits a request.
//   2. /api/evolve?action=search checks for open evolve issues.
//   3. If matches exist, a decision card is shown: comment on an existing issue
//      (so Claude can update its branch) or create a new one.
//   4. If no matches, a new issue is created automatically.
//
// Evolve flow (development / NODE_ENV=development):
//   1. User submits a request.
//   2. POST /api/evolve/local — creates a git worktree, runs Claude Code, starts dev server.
//   3. UI polls /api/evolve/local?sessionId=... for status updates.
//   4. When ready, shows a preview link + accept/reject buttons.
//   5. Accept merges the branch into main; reject cleans up.
//
// The mode toggle is always visible so users can switch without losing their draft message.
// After an evolve submit, the UI polls for progress and updates the status message in-place.

import { useState, useRef, useEffect, FormEvent } from "react";
import ModeToggle from "./ModeToggle";

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = "chat" | "evolve";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional stable ID used to find and update a message in-place.
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

// Status polled from /api/evolve/local (development only)
interface LocalEvolveSession {
  id: string;
  status: "starting" | "running-claude" | "starting-server" | "ready" | "error";
  logs: string;
  previewUrl: string | null;
  branch: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ChatInterface() {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm Primordia. You can chat with me, or switch to **evolve mode** to propose a change to this app itself. Your idea will be turned into a GitHub PR automatically.",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [evolveResult, setEvolveResult] = useState<EvolveResult | null>(null);
  // Stores deploy preview context string; injected into the system prompt for chat.
  const [deployContext, setDeployContext] = useState<string | null>(null);
  // PR number for the current deploy preview (null on production/local builds).
  const [deployPrNumber, setDeployPrNumber] = useState<number | null>(null);
  // Whether to show the "Accept Changes / merge PR" card.
  const [showMergeCard, setShowMergeCard] = useState(false);
  // Decision state: shown when related open issues are found before creating a new one
  const [relatedIssues, setRelatedIssues] = useState<RelatedIssue[] | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [evolveLoadingMsg, setEvolveLoadingMsg] = useState<string>("Checking for related issues…");
  // Local evolve session state (development only)
  const [localEvolveSession, setLocalEvolveSession] = useState<LocalEvolveSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Holds the active polling interval so we can cancel it on unmount or mode reset.
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Polling interval for local evolve status (development only)
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

  // Reset evolve state when switching modes
  useEffect(() => {
    setEvolveResult(null);
    setRelatedIssues(null);
    setPendingRequest(null);
    setLocalEvolveSession(null);
  }, [mode]);

  // Cancel any in-flight polling when the component unmounts
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
      }
      if (localPollingRef.current !== null) {
        clearInterval(localPollingRef.current);
      }
    };
  }, []);

  // On preview deployments, fetch PR + issue context and inject it into the chat
  // so the assistant (and the user) know this is a work-in-progress build.
  useEffect(() => {
    if (process.env.VERCEL_ENV !== "preview") return;

    fetch("/api/deploy-context")
      .then((res) => res.json())
      .then((data: { context: string | null; prNumber?: number; prUrl?: string }) => {
        if (!data.context) return;
        setDeployContext(data.context);
        if (data.prNumber) setDeployPrNumber(data.prNumber);
        // Prepend a visible system message so the context is front-and-centre.
        // Show only a brief notice; the full PR/issue context is sent to Claude via systemContext.
        setMessages((prev) => [
          { role: "system" as const, content: "⚠️ This is a **deploy preview** — a work-in-progress build, not the production app." },
          ...prev,
        ]);
      })
      .catch(() => {
        // Non-critical — silently ignore network errors
      });
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);
    setEvolveResult(null);

    if (mode === "chat") {
      await handleChatSubmit(trimmed);
    } else {
      await handleEvolveSubmit(trimmed);
    }

    setIsLoading(false);
  }

  async function handleChatSubmit(userMessage: string) {
    // On deploy previews, intercept merge/accept intent before sending to Claude.
    if (deployPrNumber && isMergeIntent(userMessage)) {
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      setShowMergeCard(true);
      return;
    }

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);

    // Add an empty assistant message that will be filled via streaming
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.filter((m) => m.role !== "system"),
          systemContext: deployContext ?? undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Stream the response token-by-token
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Each chunk is a line of SSE: "data: <text>\n\n"
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data) as { text: string };
              assistantText += parsed.text;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantText,
                };
                return updated;
              });
            } catch {
              // Ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Error: ${errorMsg}`,
        };
        return updated;
      });
    }
  }

  async function handleEvolveSubmit(request: string) {
    // In development, use the local worktree flow instead of GitHub Issues.
    if (process.env.NODE_ENV === "development") {
      await handleLocalEvolveSubmit(request);
      return;
    }

    // ── Production: GitHub Issues flow ────────────────────────────────────────

    // Clear any previous decision state
    setPendingRequest(null);
    setRelatedIssues(null);

    // Show the user's request in the chat as context
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[evolve request] ${request}` },
    ]);

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
          // Show decision UI — handleSubmit will clear isLoading after we return
          setPendingRequest(request);
          setRelatedIssues(data.issues);
          return;
        }
      }
    } catch {
      // Search failed — fall through to auto-create
    }

    // No related issues found (or search failed) — create a new issue directly
    setEvolveLoadingMsg("Opening GitHub issue…");
    await performEvolveCreate(request);
  }

  // ── Local evolve (development only) ───────────────────────────────────────

  async function handleLocalEvolveSubmit(request: string) {
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[evolve request] ${request}` },
    ]);

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

  // Polls /api/evolve/local every 5 s.
  // Updates the status message in-place; appends a preview-ready message once ready.
  function startLocalEvolvePolling(sessionId: string, statusMsgId: string) {
    if (localPollingRef.current !== null) {
      clearInterval(localPollingRef.current);
    }

    localPollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/evolve/local?sessionId=${sessionId}`);
        if (!res.ok) return;

        const data = (await res.json()) as LocalEvolveSession;
        setLocalEvolveSession({ ...data, id: sessionId });

        // Build a human-readable status label
        const statusLabel: Record<string, string> = {
          starting: "⏳ Setting up worktree…",
          "running-claude": "🤖 Claude Code is implementing changes…",
          "starting-server": "🚀 Starting preview server…",
          ready: "✅ Preview ready!",
          error: "❌ An error occurred.",
        };
        const label = statusLabel[data.status] ?? "⏳ Working…";

        // Show the last ~20 lines of logs as context
        const recentLogs = data.logs
          .split("\n")
          .slice(-20)
          .join("\n")
          .trim();

        setMessages((prev) =>
          prev.map((m) =>
            m.id === statusMsgId
              ? { ...m, content: `${label}\n\n${recentLogs}` }
              : m,
          ),
        );

        // Stop polling once terminal state is reached
        if (data.status === "ready" || data.status === "error") {
          clearInterval(localPollingRef.current!);
          localPollingRef.current = null;

          if (data.status === "ready" && data.previewUrl) {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `🚀 Preview ready: [${data.previewUrl}](${data.previewUrl})\n\nReview the changes, then use the **Accept** or **Reject** buttons below.`,
              },
            ]);
          }
        }
      } catch {
        // Silently ignore transient network errors between polls
      }
    }, 5_000);
  }

  async function handleLocalAccept() {
    if (!localEvolveSession || isLoading) return;
    setIsLoading(true);

    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", sessionId: localEvolveSession.id }),
      });

      const data = (await res.json()) as { outcome?: string; branch?: string; error?: string };

      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);

      setLocalEvolveSession(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✅ Changes accepted and merged into main! The preview server has been shut down.`,
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to accept changes: ${errorMsg}` },
      ]);
    }

    setIsLoading(false);
  }

  async function handleLocalReject() {
    if (!localEvolveSession || isLoading) return;
    setIsLoading(true);

    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", sessionId: localEvolveSession.id }),
      });

      const data = (await res.json()) as { outcome?: string; error?: string };

      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);

      setLocalEvolveSession(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `🗑️ Preview rejected. The worktree and branch have been cleaned up.`,
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to reject: ${errorMsg}` },
      ]);
    }

    setIsLoading(false);
  }

  // ── GitHub evolve helpers (production) ────────────────────────────────────

  // Called when the user picks "Add comment" on an existing issue
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

      if (!res.ok) {
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }

      setEvolveResult({ type: "commented", commentUrl: data.commentUrl });

      // Show "PR #N" when the comment was posted to a PR, otherwise "Issue #N".
      const targetLabel = data.prNumber
        ? `[PR #${data.prNumber}](${data.prUrl})`
        : `[Issue #${issueNumber}](${data.commentUrl})`;

      // Add confirmation message and a CI-status message updated in-place —
      // same live polling as the new-issue flow.
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
      const errorMsg =
        err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to add comment: ${errorMsg}`,
        },
      ]);
    }

    setIsLoading(false);
  }

  // Called when the user picks "Create new issue" from the decision card
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

  // Core logic for creating a new GitHub issue
  async function performEvolveCreate(request: string) {
    try {
      const response = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", request }),
      });

      const data = (await response.json()) as {
        issueNumber: number;
        issueUrl: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `API error: ${response.statusText}`);
      }

      setEvolveResult({
        type: "created",
        issueNumber: data.issueNumber,
        issueUrl: data.issueUrl,
      });

      // Add a confirmation message and a CI-status message that will be updated in-place.
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

      // Begin polling for CI progress
      startEvolvePolling(data.issueNumber, statusMsgId);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to submit evolve request: ${errorMsg}`,
        },
      ]);
    }
  }

  // Polls /api/evolve/status every 10 s.
  // Updates the status message in-place each time Claude's comment changes.
  // Appends separate one-time messages for PR creation and deploy preview.
  function startEvolvePolling(issueNumber: number, statusMsgId: string) {
    // Cancel any previous poll loop
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current);
    }

    // Mutable tracker captured by the interval closure — avoids stale state.
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
        const res = await fetch(
          `/api/evolve/status?issueNumber=${issueNumber}`
        );
        if (!res.ok) return;

        const status = (await res.json()) as EvolveStatus;

        // ── Update Claude's comment in-place whenever it changes ──────────
        if (
          status.claudeComment &&
          status.claudeComment.updatedAt !== tracker.lastCommentUpdatedAt
        ) {
          tracker.lastCommentUpdatedAt = status.claudeComment.updatedAt;
          const { body, htmlUrl } = status.claudeComment;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === statusMsgId
                ? {
                    ...m,
                    content: `**CI Progress** ([view on GitHub](${htmlUrl})):\n\n${body}`,
                  }
                : m
            )
          );
        }

        // ── Append a PR message once ───────────────────────────────────────
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

        // ── Append a deploy preview message once, then stop polling ───────
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

  // Merges the deploy-preview PR when the user confirms via the merge card.
  async function handleMergePr() {
    if (!deployPrNumber || isLoading) return;
    setShowMergeCard(false);
    setIsLoading(true);

    try {
      const res = await fetch("/api/merge-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: deployPrNumber }),
      });

      const data = (await res.json()) as { merged?: boolean; message?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `GitHub error: ${res.statusText}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✅ PR #${deployPrNumber} has been merged! The changes will be deployed to production shortly.`,
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed to merge PR #${deployPrNumber}: ${errorMsg}`,
        },
      ]);
    }

    setIsLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex flex-col w-full max-w-3xl h-screen mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-baseline gap-2">
            Primordia
            {process.env.VERCEL_ENV === "preview" &&
              process.env.VERCEL_GIT_PULL_REQUEST_ID && (
                <a
                  href={`https://github.com/${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}/pull/${process.env.VERCEL_GIT_PULL_REQUEST_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-normal text-blue-400 hover:text-blue-300"
                >
                  #{process.env.VERCEL_GIT_PULL_REQUEST_ID}
                </a>
              )}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            A self-evolving application
          </p>
        </div>
        <ModeToggle mode={mode} onModeChange={setMode} />
      </header>

      {/* Evolve mode banner */}
      {mode === "evolve" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm flex-shrink-0">
          <strong className="font-semibold">Evolve mode</strong> —{" "}
          {process.env.NODE_ENV === "development" ? (
            <>
              Describe a change you want to make to this app. Claude Code will
              implement it locally in a preview server — no GitHub required.
            </>
          ) : (
            <>
              Describe a change you want to make to this app. Your request will
              become a GitHub Issue and trigger an automated PR.
            </>
          )}
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} message={msg} />
        ))}
        {isLoading && mode === "evolve" && (
          <div className="text-sm text-gray-500 animate-pulse">
            {evolveLoadingMsg}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Decision card — shown when open evolve issues were found (production only) */}
      {relatedIssues !== null &&
        relatedIssues.length > 0 &&
        pendingRequest &&
        !isLoading && (
          <div className="mb-3 px-4 py-3 rounded-lg bg-amber-900/30 border border-amber-700/40 text-sm flex-shrink-0 space-y-3">
            <p className="text-amber-200 font-semibold">
              Found {relatedIssues.length} open evolve request
              {relatedIssues.length > 1 ? "s" : ""}. Add your request to one,
              or create a new issue:
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

      {/* Local evolve accept/reject card — development only, shown when preview is ready */}
      {localEvolveSession?.status === "ready" && localEvolveSession.previewUrl && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0 space-y-3">
          <p className="text-green-200 font-semibold">
            Preview ready:{" "}
            <a
              href={localEvolveSession.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-green-100"
            >
              {localEvolveSession.previewUrl}
            </a>
          </p>
          <p className="text-green-300 text-xs">
            Review the changes in the preview, then accept to merge into{" "}
            <code className="bg-green-900/50 px-1 rounded">main</code> or
            reject to discard.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLocalAccept}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white disabled:opacity-50"
            >
              Accept Changes
            </button>
            <button
              onClick={handleLocalReject}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 rounded text-white disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Merge card — shown when the user expresses merge/accept intent on a deploy preview */}
      {showMergeCard && deployPrNumber && !isLoading && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0 space-y-3">
          <p className="text-green-200 font-semibold">
            Merge PR #{deployPrNumber} into production?
          </p>
          <p className="text-green-300 text-xs">
            This will squash-merge the branch and trigger a production deployment.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleMergePr}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white"
            >
              Accept Changes
            </button>
            <button
              onClick={() => setShowMergeCard(false)}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex-shrink-0 mt-4 flex items-end gap-3 border border-gray-800 rounded-xl bg-gray-900 p-3"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === "chat"
              ? "Send a message…"
              : "Describe a change you want to make to this app…"
          }
          rows={1}
          disabled={isLoading}
          className="flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none max-h-48 leading-relaxed"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            mode === "evolve"
              ? "bg-amber-600 hover:bg-amber-500 disabled:bg-amber-900 text-white"
              : "bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white"
          } disabled:cursor-not-allowed`}
        >
          {isLoading
            ? "…"
            : mode === "chat"
            ? "Send"
            : "Evolve"}
        </button>
      </form>

      {/* Evolve result card (production — after GitHub issue is created/commented) */}
      {evolveResult && (
        <div className="mt-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm flex-shrink-0">
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
    </main>
  );
}

// ─── MessageBubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // System messages are shown as a distinct notice bar (e.g. deploy preview context).
  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="w-full px-4 py-3 rounded-lg text-xs text-amber-300 bg-amber-900/30 border border-amber-700/30 whitespace-pre-wrap leading-relaxed">
          <SimpleMarkdown text={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-gray-800 text-gray-100 rounded-bl-sm"
        }`}
      >
        <SimpleMarkdown text={message.content} />
      </div>
    </div>
  );
}

// ─── isMergeIntent ───────────────────────────────────────────────────────────
// Returns true when the message clearly expresses an intent to merge / accept
// the current PR.  Only used on deploy previews.

function isMergeIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Exact short commands
  if (lower === "merge" || lower === "accept") return true;
  // "merge this / the / it / pr / branch / pull request / change(s)"
  if (/\bmerge\s+(this|the|it|pr|branch|pull\s+request|change|changes)\b/.test(lower)) return true;
  // "accept this / the change(s) / pr / pull request"
  if (/\baccept\s+(this\s+|the\s+)?(change|changes|pr|pull\s+request)\b/.test(lower)) return true;
  // "ship this / it"
  if (/\bship\s+(this|it)\b/.test(lower)) return true;
  // "approve and merge", "lgtm merge"
  if (/\b(approve\s+and\s+merge|lgtm\s+merge)\b/.test(lower)) return true;
  return false;
}

// ─── SimpleMarkdown ──────────────────────────────────────────────────────────
// Minimal markdown renderer — just enough for bold, links, and inline code.
// Claude Code can replace this with a proper markdown library when needed.

function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null;

  // Split on links [text](url), bold **text**, and inline `code`.
  // Use non-capturing inner groups so split() only puts the full token in the
  // array — not each inner capture group — which would otherwise cause bold
  // text to be rendered twice (once as <strong>, once as a plain <span>).
  const parts = text.split(/(\[(?:[^\]]+)\]\((?:[^)]+)\)|\*\*(?:[^*]+)\*\*|`(?:[^`]+)`)/g);

  const rendered: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < parts.length) {
    const part = parts[i];
    if (!part) { i++; continue; }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    const codeMatch = part.match(/^`([^`]+)`$/);

    if (linkMatch) {
      rendered.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-blue-300 hover:text-blue-200"
        >
          {linkMatch[1]}
        </a>
      );
    } else if (boldMatch) {
      rendered.push(<strong key={key++}>{boldMatch[1]}</strong>);
    } else if (codeMatch) {
      rendered.push(
        <code key={key++} className="bg-gray-700 px-1 rounded text-xs">
          {codeMatch[1]}
        </code>
      );
    } else {
      rendered.push(<span key={key++}>{part}</span>);
    }
    i++;
  }

  return <>{rendered}</>;
}
