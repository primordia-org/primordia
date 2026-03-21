"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Streams responses from Claude via /api/chat.
//
// To propose a change to the app itself, use the Edit (pencil) icon button in
// the header, which links to /evolve — a dedicated "submit a request" form.
//
// The sync (cloud-upload) icon button in the header triggers a git pull+push
// dialog — see GitSyncDialog below.
//
// The accept/reject bar for previews lives in AcceptRejectBar (rendered in the
// root layout below the fold — scroll down to reveal it).

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
}

export default function ChatInterface({ branch, commitMessage }: GitContext) {
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

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
      .then((data: { context: string | null }) => {
        if (!data.context) return;
        setDeployContext(data.context);
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
        {/* Header action buttons */}
        <div className="flex items-center gap-1">
          {/* Sync icon button — pulls then pushes the current branch to GitHub */}
          <button
            type="button"
            onClick={() => setSyncDialogOpen(true)}
            title="Synchronise branch with GitHub"
            aria-label="Synchronise branch with GitHub"
            className="p-2 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-800 transition-colors"
          >
            {/* Cloud-upload icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
          </button>
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
        </div>
        {/* Git sync confirmation dialog */}
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
      </header>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

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

// ─── GitSyncDialog ────────────────────────────────────────────────────────────
// Modal dialog: confirm → stream git pull+push output → show result.

type SyncState = "idle" | "running" | "success" | "error";

function GitSyncDialog({ onClose }: { onClose: () => void }) {
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [output, setOutput] = useState("");
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the output box as new text arrives
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  async function handleSync() {
    setSyncState("running");
    setOutput("");

    try {
      const response = await fetch("/api/git-sync", { method: "POST" });
      if (!response.ok) {
        setOutput(`HTTP error ${response.status}: ${response.statusText}`);
        setSyncState("error");
        return;
      }
      if (!response.body) {
        setOutput("No response body.");
        setSyncState("error");
        return;
      }

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
            const parsed = JSON.parse(raw) as
              | { text: string }
              | { done: true; outcome: string };
            if ("done" in parsed) {
              setSyncState(parsed.outcome === "success" ? "success" : "error");
            } else {
              setOutput((prev) => prev + parsed.text);
            }
          } catch {
            // Ignore malformed SSE lines
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutput((prev) => prev + `\n❌ Fetch error: ${msg}\n`);
      setSyncState("error");
    }
  }

  const isRunning = syncState === "running";
  const isDone = syncState === "success" || syncState === "error";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        // Close on backdrop click only when not running
        if (!isRunning && e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="w-full max-w-lg mx-4 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400" aria-hidden="true">
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
            <span className="text-sm font-semibold text-white">
              Synchronise branch with GitHub
            </span>
          </div>
          {!isRunning && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-gray-500 hover:text-gray-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {syncState === "idle" && (
            <p className="text-sm text-gray-300">
              This will <strong className="text-white">pull</strong> the latest
              changes from GitHub (merge strategy) and then{" "}
              <strong className="text-white">push</strong> your local commits.
              Merge conflicts, if any, will be resolved automatically by Claude
              Code.
            </p>
          )}

          {/* Output area — shown once sync starts */}
          {(isRunning || isDone) && (
            <div className="bg-gray-950 rounded-lg border border-gray-800 p-3 max-h-72 overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
              {output || " "}
              <div ref={outputEndRef} />
            </div>
          )}

          {/* Status badge */}
          {syncState === "success" && (
            <p className="text-sm text-green-400 font-medium">✅ Sync complete!</p>
          )}
          {syncState === "error" && (
            <p className="text-sm text-red-400 font-medium">
              ❌ Sync finished with errors. Check the output above.
            </p>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-3">
          {syncState === "idle" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSync}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-green-700 hover:bg-green-600 text-white transition-colors"
              >
                Sync
              </button>
            </>
          )}
          {isRunning && (
            <span className="text-sm text-gray-400 animate-pulse">
              Syncing…
            </span>
          )}
          {isDone && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// SimpleMarkdown is imported from ./SimpleMarkdown
