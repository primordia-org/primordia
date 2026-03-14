"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Handles two modes:
//   - "chat" mode: streams responses from Claude via /api/chat
//   - "evolve" mode: submits a GitHub Issue via /api/evolve, triggering the CI pipeline
//
// After an evolve issue is created, the component polls /api/evolve/status every 10s
// and adds chat messages when:
//   - Claude's comment appears on the issue (shows a summary + link)
//   - A PR is created (shows PR link)
//   - A Vercel deploy preview URL becomes available (shows preview link)
//
// The mode toggle is always visible so users can switch without losing their draft message.

import { useState, useRef, useEffect, FormEvent } from "react";
import ModeToggle from "./ModeToggle";

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode = "chat" | "evolve";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface EvolveResult {
  issueNumber: number;
  issueUrl: string;
}

interface EvolveStatus {
  claudeComment: string | null;
  claudeCommentUrl: string | null;
  prNumber: number | null;
  prUrl: string | null;
  deployPreviewUrl: string | null;
}

// Mutable ref tracking what has already been surfaced in chat for a given issue,
// to avoid duplicate messages across poll ticks.
interface EvolveTracker {
  issueNumber: number;
  startTime: number;
  claudeShown: boolean;
  prShown: boolean;
  deployShown: boolean;
}

// How often to poll (ms) and when to give up (ms)
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 15 * 60_000; // 15 minutes

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mutable tracker for evolve polling — read inside setInterval without stale closures
  const evolveTrackerRef = useRef<EvolveTracker | null>(null);
  // Changing this state value kicks off the polling useEffect
  const [activeEvolveIssue, setActiveEvolveIssue] = useState<number | null>(null);

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

  // Reset evolve result when switching modes
  useEffect(() => {
    setEvolveResult(null);
  }, [mode]);

  // ── Evolve polling ────────────────────────────────────────────────────────
  // Runs whenever a new evolve issue number becomes active.
  // Polls /api/evolve/status and surfaces progress as chat messages.

  useEffect(() => {
    if (activeEvolveIssue === null) return;

    const interval = setInterval(async () => {
      const tracker = evolveTrackerRef.current;
      if (!tracker) return;

      // Give up after POLL_TIMEOUT_MS
      if (Date.now() - tracker.startTime > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        evolveTrackerRef.current = null;
        setActiveEvolveIssue(null);
        return;
      }

      try {
        const res = await fetch(
          `/api/evolve/status?issueNumber=${tracker.issueNumber}`
        );
        if (!res.ok) return; // transient error — will retry

        const data = (await res.json()) as EvolveStatus;

        // Show Claude's comment once it appears
        if (data.claudeComment && !tracker.claudeShown) {
          tracker.claudeShown = true;
          // Show the first ~400 chars of Claude's comment so the chat isn't flooded,
          // with a link to read the full comment on GitHub.
          const preview = data.claudeComment.slice(0, 400).trimEnd();
          const ellipsis = data.claudeComment.length > 400 ? "…" : "";
          const linkPart = data.claudeCommentUrl
            ? ` [View full response](${data.claudeCommentUrl})`
            : "";
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `**Claude is working on it:**\n${preview}${ellipsis}${linkPart}`,
            },
          ]);
        }

        // Show PR link once the PR is created
        if (data.prUrl && !tracker.prShown) {
          tracker.prShown = true;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `PR created! [View PR #${data.prNumber}](${data.prUrl})`,
            },
          ]);
        }

        // Show deploy preview URL once Vercel finishes building
        if (data.deployPreviewUrl && !tracker.deployShown) {
          tracker.deployShown = true;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Deploy preview is ready! [Open preview](${data.deployPreviewUrl})`,
            },
          ]);
          // All done — stop polling
          clearInterval(interval);
          evolveTrackerRef.current = null;
          setActiveEvolveIssue(null);
        }
      } catch {
        // Network hiccup — will retry on next tick
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeEvolveIssue]);

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
    // Show the user's request in the chat as context
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[evolve request] ${request}` },
    ]);

    try {
      const response = await fetch("/api/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request }),
      });

      const data = (await response.json()) as {
        issueNumber: number;
        issueUrl: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? `API error: ${response.statusText}`);
      }

      setEvolveResult({ issueNumber: data.issueNumber, issueUrl: data.issueUrl });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Got it! I've opened [GitHub Issue #${data.issueNumber}](${data.issueUrl}) for your request. I'll let you know here when Claude responds, a PR is created, and the deploy preview is ready.`,
        },
      ]);

      // Start polling for CI progress
      evolveTrackerRef.current = {
        issueNumber: data.issueNumber,
        startTime: Date.now(),
        claudeShown: false,
        prShown: false,
        deployShown: false,
      };
      setActiveEvolveIssue(data.issueNumber);
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col w-full max-w-3xl h-screen px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Primordia
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            A self-evolving application
          </p>
        </div>
        <ModeToggle mode={mode} onModeChange={setMode} />
      </header>

      {/* Evolve mode banner */}
      {mode === "evolve" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm flex-shrink-0">
          <strong className="font-semibold">Evolve mode</strong> — Describe a
          change you want to make to this app. Your request will become a GitHub
          Issue and trigger an automated PR.
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
        {isLoading && mode === "evolve" && (
          <div className="text-sm text-gray-500 animate-pulse">
            Opening GitHub issue…
          </div>
        )}
        {activeEvolveIssue !== null && (
          <div className="text-sm text-gray-500 animate-pulse">
            Watching CI pipeline…
          </div>
        )}
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

      {/* Evolve success card */}
      {evolveResult && (
        <div className="mt-3 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-green-300 text-sm flex-shrink-0">
          Issue{" "}
          <a
            href={evolveResult.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium hover:text-green-200"
          >
            #{evolveResult.issueNumber}
          </a>{" "}
          opened — watching for PR and deploy preview…
        </div>
      )}
    </div>
  );
}

// ─── MessageBubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

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
