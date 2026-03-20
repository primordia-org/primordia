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
//   2. POST /api/evolve/local — creates a git worktree on a fresh branch, stores
//      the parent branch in git config (branch.<name>.parent), runs Claude Code
//      via @anthropic-ai/claude-agent-sdk, then starts a Next.js dev server with
//      PREVIEW_BRANCH set in the environment.
//   3. UI polls /api/evolve/local?sessionId=... for status updates.
//      Progress is rendered as "**Local Evolve Progress**:\n\n{progressText}" —
//      the same format used by the GitHub CI flow for its comment body.
//   4. When ready, shows a plain preview link (no URL params needed).
//   5. The preview instance detects itself via the isPreviewInstance prop,
//      resolved server-side in page.tsx by reading branch.<name>.parent from
//      git config — no client-side API call needed.
//   6. Accept/Reject bar in the preview calls its own manage POST endpoint.
//      The manage route reads the parent branch from git config, merges/cleans up,
//      then exits the preview process — no cross-origin requests required.
//
// The mode toggle is always visible so users can switch without losing their draft message.
// After an evolve submit, the UI polls for progress and updates the status message in-place.

import { useState, useRef, useEffect, FormEvent } from "react";
import Link from "next/link";
import ModeToggle from "./ModeToggle";
import { SimpleMarkdown } from "./SimpleMarkdown";

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
  /** Formatted markdown progress string built from Claude Agent SDK messages. */
  progressText: string;
  previewUrl: string | null;
  branch: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface GitContext {
  branch: string | null;
  commitMessage: string | null;
  /** True when this instance is running as a local preview worktree. Detected
   *  server-side in page.tsx by reading branch.<name>.parent from git config. */
  isPreviewInstance: boolean;
  /** The parent branch name to merge into on accept. Defaults to "main". */
  previewParentBranch: string;
}

export default function ChatInterface({ branch, commitMessage, isPreviewInstance, previewParentBranch }: GitContext) {
  const [mode, setMode] = useState<Mode>("chat");
  const [messages, setMessages] = useState<Message[]>(() => {
    const initial: Message[] = [
      {
        role: "assistant",
        content:
          "Hi! I'm Primordia. You can chat with me, or switch to **evolve mode** to propose a change to this app itself.",
      },
    ];
    if (commitMessage) {
      initial.push({
        role: "assistant",
        content: `Most recent change:\n\n${commitMessage}`,
      });
    }
    return initial;
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [evolveResult, setEvolveResult] = useState<EvolveResult | null>(null);
  // Stores deploy preview context string; injected into the system prompt for chat.
  const [deployContext, setDeployContext] = useState<string | null>(null);
  // PR number for the current deploy preview (null on production/local builds).
  const [deployPrNumber, setDeployPrNumber] = useState<number | null>(null);
  // Base branch of the deploy preview PR (the branch it will be merged into).
  const [deployPrBaseBranch, setDeployPrBaseBranch] = useState<string>("main");
  // Action state for the Vercel preview accept/reject bar.
  const [vercelActionState, setVercelActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
  // Decision state: shown when related open issues are found before creating a new one
  const [relatedIssues, setRelatedIssues] = useState<RelatedIssue[] | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [evolveLoadingMsg, setEvolveLoadingMsg] = useState<string>("Checking for related issues…");
  // Local evolve session state (development only)
  const [localEvolveSession, setLocalEvolveSession] = useState<LocalEvolveSession | null>(null);
  const [previewActionState, setPreviewActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
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

  // Update the page title with the branch name (client-side only).
  useEffect(() => {
    if (branch) {
      document.title = `Primordia (${branch})`;
    }
  }, [branch]);

  // On mount, check for missing API keys and warn the user if any are absent.
  useEffect(() => {
    fetch("/api/check-keys")
      .then((res) => res.json())
      .then((data: { missing: Array<{ key: string; description: string }> }) => {
        if (!data.missing || data.missing.length === 0) return;
        const list = data.missing.map((m) => `\`${m.key}\` (${m.description})`).join(", ");
        setMessages((prev) => [
          {
            role: "system" as const,
            content: `⚠️ **Missing API keys**: ${list}. Some features may not work. Check your environment variables.`,
          },
          ...prev,
        ]);
      })
      .catch(() => {
        // Non-critical — silently ignore network errors
      });
  }, []);

  // On preview deployments, fetch PR + issue context and inject it into the chat
  // so the assistant (and the user) know this is a work-in-progress build.
  useEffect(() => {
    if (process.env.VERCEL_ENV !== "preview") return;

    fetch("/api/deploy-context")
      .then((res) => res.json())
      .then((data: { context: string | null; prNumber?: number; prUrl?: string; prBaseBranch?: string }) => {
        if (!data.context) return;
        setDeployContext(data.context);
        if (data.prNumber) setDeployPrNumber(data.prNumber);
        if (data.prBaseBranch) setDeployPrBaseBranch(data.prBaseBranch);
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

        // Display progress in the same format as the GitHub CI flow:
        // "**Local Evolve Progress**:\n\n{progressText}"
        const progressContent = `**Local Evolve Progress**:\n\n${data.progressText || "⏳ Starting…"}`;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === statusMsgId
              ? { ...m, content: progressContent }
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

  // ── Preview-instance accept/reject (development only) ─────────────────────
  // These run inside the preview server. They POST to this server's own manage
  // endpoint — no cross-origin needed. The manage route reads PREVIEW_BRANCH
  // and the parent branch from git config to handle everything.

  async function handlePreviewAccept() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("accepted");
    } catch {
      setPreviewActionState("idle");
    }
  }

  async function handlePreviewReject() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("rejected");
    } catch {
      setPreviewActionState("idle");
    }
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

  // ── Vercel preview accept/reject ──────────────────────────────────────────
  // These run inside the Vercel preview deployment. They POST to this server's
  // own API routes — no cross-origin needed.

  async function handleVercelAccept() {
    if (!deployPrNumber || vercelActionState !== "idle") return;
    setVercelActionState("loading");
    try {
      const res = await fetch("/api/merge-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: deployPrNumber }),
      });
      const data = (await res.json()) as { merged?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `GitHub error: ${res.statusText}`);
      setVercelActionState("accepted");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `✅ PR #${deployPrNumber} has been merged! The changes will be deployed to production shortly.`,
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setVercelActionState("idle");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to merge PR #${deployPrNumber}: ${errorMsg}` },
      ]);
    }
  }

  async function handleVercelReject() {
    if (!deployPrNumber || vercelActionState !== "idle") return;
    setVercelActionState("loading");
    try {
      const res = await fetch("/api/close-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: deployPrNumber }),
      });
      const data = (await res.json()) as { closed?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `GitHub error: ${res.statusText}`);
      setVercelActionState("rejected");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `🗑️ PR #${deployPrNumber} has been closed. The changes have been discarded.`,
        },
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Something went wrong.";
      setVercelActionState("idle");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to close PR #${deployPrNumber}: ${errorMsg}` },
      ]);
    }
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
    <main className="flex flex-col w-full max-w-3xl h-dvh mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-baseline gap-2">
            {process.env.VERCEL_PROJECT_PRODUCTION_URL ? (
              <a
                href={`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white no-underline hover:text-gray-300"
              >
                Primordia
              </a>
            ) : (
              "Primordia"
            )}
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
            {branch && (
              <span className="text-sm font-normal text-gray-400">
                ({branch})
              </span>
            )}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            A self-evolving application ·{" "}
            <Link href="/changelog" className="text-blue-400 hover:text-blue-300">
              Changelog
            </Link>
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

      {/* Preview-instance accept/reject bar — shown only inside the child preview server */}
      {isPreviewInstance && previewActionState !== "accepted" && previewActionState !== "rejected" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0 space-y-3">
          <p className="text-green-200 font-semibold">
            🔍 This is a local preview — review the changes, then accept or reject.
          </p>
          <p className="text-green-300 text-xs">
            Accepting will merge the preview branch into{" "}
            <code className="bg-green-900/50 px-1 rounded">{previewParentBranch}</code>.
            Rejecting will discard the worktree and branch.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviewAccept}
              disabled={previewActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white disabled:opacity-50"
            >
              {previewActionState === "loading" ? "…" : "Accept Changes"}
            </button>
            <button
              onClick={handlePreviewReject}
              disabled={previewActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 rounded text-white disabled:opacity-50"
            >
              {previewActionState === "loading" ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      {isPreviewInstance && previewActionState === "accepted" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0">
          <p className="text-green-200">✅ Changes accepted and merged into <code className="bg-green-900/50 px-1 rounded">{previewParentBranch}</code>. You can close this preview.</p>
        </div>
      )}
      {isPreviewInstance && previewActionState === "rejected" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm flex-shrink-0">
          <p className="text-red-200">🗑️ Preview rejected. You can close this preview.</p>
        </div>
      )}

      {/* Vercel preview accept/reject bar — shown on Vercel deploy preview deployments */}
      {deployPrNumber !== null && vercelActionState !== "accepted" && vercelActionState !== "rejected" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0 space-y-3">
          <p className="text-green-200 font-semibold">
            🔍 This is a deploy preview of PR #{deployPrNumber} — review the changes, then accept or reject.
          </p>
          <p className="text-green-300 text-xs">
            Accepting will merge the PR into{" "}
            <code className="bg-green-900/50 px-1 rounded">{deployPrBaseBranch}</code>.
            Rejecting will close the PR.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleVercelAccept}
              disabled={vercelActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white disabled:opacity-50"
            >
              {vercelActionState === "loading" ? "…" : "Accept Changes"}
            </button>
            <button
              onClick={handleVercelReject}
              disabled={vercelActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 rounded text-white disabled:opacity-50"
            >
              {vercelActionState === "loading" ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      {deployPrNumber !== null && vercelActionState === "accepted" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0">
          <p className="text-green-200">✅ Changes accepted and merged into <code className="bg-green-900/50 px-1 rounded">{deployPrBaseBranch}</code>. Production deployment is on its way!</p>
        </div>
      )}
      {deployPrNumber !== null && vercelActionState === "rejected" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm flex-shrink-0">
          <p className="text-red-200">🗑️ PR #{deployPrNumber} closed. Changes discarded.</p>
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

// SimpleMarkdown is imported from ./SimpleMarkdown
