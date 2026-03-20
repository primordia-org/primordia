"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Streams responses from Claude via /api/chat.
//
// To propose a change to the app itself, use the Edit (pencil) icon button in
// the header, which links to /evolve — a dedicated "submit a request" form.
//
// The preview instance accept/reject bar is rendered here when this instance
// is running as a local preview worktree (isPreviewInstance=true), and the
// Vercel deploy preview accept/reject bar is rendered on Vercel preview deploys.

import { useState, useRef, useEffect, FormEvent } from "react";
import Link from "next/link";
import { SimpleMarkdown } from "./SimpleMarkdown";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  // Optional stable ID used to find and update a message in-place.
  id?: string;
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
  const [messages, setMessages] = useState<Message[]>(() => {
    const initial: Message[] = [
      {
        role: "assistant",
        content:
          "Hi! I'm Primordia. Ask me anything, or click the ✏️ button in the top right to propose a change to this app.",
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
  // Stores deploy preview context string; injected into the system prompt for chat.
  const [deployContext, setDeployContext] = useState<string | null>(null);
  // PR number for the current deploy preview (null on production/local builds).
  const [deployPrNumber, setDeployPrNumber] = useState<number | null>(null);
  // Base branch of the deploy preview PR (the branch it will be merged into).
  const [deployPrBaseBranch, setDeployPrBaseBranch] = useState<string>("main");
  // PR state for the current deploy preview ("open", "closed", or "merged").
  const [deployPrState, setDeployPrState] = useState<"open" | "closed" | "merged" | null>(null);
  // Action state for the Vercel preview accept/reject bar.
  const [vercelActionState, setVercelActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
  const [previewActionState, setPreviewActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Holds the active polling interval so we can cancel it on unmount.
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
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
      .then((data: { context: string | null; prNumber?: number; prUrl?: string; prState?: "open" | "closed" | "merged"; prBranch?: string; prBaseBranch?: string }) => {
        if (!data.context) return;
        setDeployContext(data.context);
        if (data.prNumber) setDeployPrNumber(data.prNumber);
        if (data.prState) setDeployPrState(data.prState);
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

    await handleChatSubmit(trimmed);

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
          <h1 className="text-xl font-bold tracking-tight text-white flex flex-wrap items-baseline gap-x-2">
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
              <span className="text-sm font-normal text-gray-400 w-full sm:w-auto">
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
        {/* Edit icon button — links to /evolve to propose a change */}
        <Link
          href="/evolve"
          title="Propose a change to this app"
          className="p-2 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-gray-800 transition-colors"
          aria-label="Propose a change"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </Link>
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

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
      {deployPrNumber !== null && deployPrState === "merged" && vercelActionState !== "accepted" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm flex-shrink-0">
          <p className="text-green-200">✅ PR #{deployPrNumber} has already been merged. These changes are live in production.</p>
        </div>
      )}
      {deployPrNumber !== null && deployPrState === "closed" && vercelActionState !== "rejected" && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm flex-shrink-0">
          <p className="text-red-200">🗑️ PR #{deployPrNumber} has already been closed. These changes were discarded.</p>
        </div>
      )}
      {deployPrNumber !== null && (deployPrState === "open" || deployPrState === null) && vercelActionState !== "accepted" && vercelActionState !== "rejected" && (
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
          placeholder="Send a message…"
          rows={1}
          disabled={isLoading}
          className="flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 outline-none max-h-48 leading-relaxed"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white disabled:cursor-not-allowed"
        >
          {isLoading ? "…" : "Send"}
        </button>
      </form>
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
