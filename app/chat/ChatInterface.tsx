"use client";

// components/ChatInterface.tsx
// The main chat UI for Primordia. Streams responses from Claude via /api/chat.
//
// The header contains a hamburger (☰) menu button. Tapping it opens a dropdown
// with actions:
//   • "Propose a change" — links to /evolve, the dedicated change-request form.
//
// The accept/reject bar for previews lives in AcceptRejectBar (rendered in the
// root layout below the fold — scroll down to reveal it).

import { useState, useRef, useEffect, FormEvent } from "react";
import { SimpleMarkdown } from "@/components/SimpleMarkdown";
import { FloatingEvolveDialog, EvolveSubmitToast } from "@/components/FloatingEvolveDialog";
import { NavHeader } from "@/components/NavHeader";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";
import { useSessionUser } from "@/lib/hooks";
import { withBasePath } from "@/lib/base-path";
import { encryptStoredApiKey } from "@/lib/api-key-client";

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
  initialHarness?: string;
  initialModel?: string;
  initialCavemanMode?: boolean;
  initialCavemanIntensity?: import("@/lib/user-prefs").CavemanIntensity;
}

export default function ChatInterface({ branch, commitMessage, initialHarness, initialModel, initialCavemanMode, initialCavemanIntensity }: GitContext) {
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const [toastSessionId, setToastSessionId] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
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

  // On mount, check for missing API keys and warn the user if any are absent.
  useEffect(() => {
    fetch(withBasePath("/api/check-keys"))
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
      const encryptedApiKey = await encryptStoredApiKey();
      const response = await fetch(withBasePath("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.filter((m) => m.role !== "system"),
          ...(encryptedApiKey ? { encryptedApiKey } : {}),
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
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Each chunk may contain one or more SSE lines: "data: <json>\n\n"
        // SSE comment lines (starting with ":") are keep-alives and are ignored.
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            // Signal the outer loop to stop after this chunk is fully processed.
            streamDone = true;
            break;
          }
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
          containerRef={hamburgerRef}
          items={buildStandardMenuItems({
            onEvolveClick: () => {
              setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
              setEvolveDialogOpen(true);
            },
            isAdmin: sessionUser?.isAdmin ?? false,
            currentPath: "/chat",
          })}
        />
        {evolveDialogOpen && (
          <FloatingEvolveDialog
            onClose={() => setEvolveDialogOpen(false)}
            anchorRect={evolveAnchorRect}
            initialHarness={initialHarness}
            initialModel={initialModel}
            initialCavemanMode={initialCavemanMode}
            initialCavemanIntensity={initialCavemanIntensity}
            onSessionCreated={(id) => setToastSessionId(id)}
          />
        )}
        {toastSessionId && (
          <EvolveSubmitToast
            sessionId={toastSessionId}
            onDismiss={() => setToastSessionId(null)}
          />
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
          data-id="chat/message-input"
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
          data-id="chat/send-message"
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
        <div className="w-full px-4 py-3 rounded-lg text-xs text-amber-300 bg-amber-900/30 border border-amber-700/30 leading-relaxed">
          <SimpleMarkdown text={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
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


