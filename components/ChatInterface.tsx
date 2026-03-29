"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Streams responses from Claude via /api/chat.
//
// The header contains a hamburger (☰) menu button. Tapping it opens a dropdown
// with two actions:
//   • "Propose a change" — links to /evolve, the dedicated change-request form.
//   • "Sync with GitHub" — triggers a git pull+push dialog (GitSyncDialog).
//
// The accept/reject bar for previews lives in AcceptRejectBar (rendered in the
// root layout below the fold — scroll down to reveal it).

import { useState, useRef, useEffect, FormEvent } from "react";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { GitSyncDialog } from "./GitSyncDialog";
import { NavHeader } from "./NavHeader";
import { HamburgerMenu } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";

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
  const { sessionUser, handleLogout } = useSessionUser();

  const [messages, setMessages] = useState<Message[]>(() => {
    const initial: Message[] = [
      {
        role: "assistant",
        content:
          "Hi! I'm Primordia. Ask me anything, or open the ☰ menu in the top right to propose a change to this app.",
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

  // Cancel any in-flight polling when the component unmounts.
  // We intentionally read pollingIntervalRef.current inside the cleanup so we
  // cancel whatever interval is running at unmount time (not the value at
  // mount time, which would always be null).
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current !== null) {
        // We intentionally read the ref at cleanup time to cancel the active
        // interval; the lint rule would have us capture at mount time instead.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <NavHeader branch={branch} subtitle="A self-evolving application" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={[
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

// GitSyncDialog is imported from ./GitSyncDialog above.
