"use client";

// components/EvolveForm.tsx
// The "submit a request" form for Primordia's evolve pipeline.
// Rendered at /evolve — a dedicated page, separate from the main chat interface.
//
// Evolve flow (local dev and exe.dev — NODE_ENV=development):
//   1. User submits a request.
//   2. POST /api/evolve/local — creates a git worktree on a fresh branch, runs
//      Claude Code via @anthropic-ai/claude-agent-sdk, then starts a Next.js
//      dev server with PREVIEW_BRANCH set.
//   3. UI polls /api/evolve/local?sessionId=... for status updates.
//   4. When ready, shows a preview link.

import { useState, useRef, useEffect, useCallback, FormEvent } from "react";
import Link from "next/link";
import { MarkdownContent } from "./SimpleMarkdown";
import { GitSyncDialog } from "./GitSyncDialog";
import { NavHeader } from "./NavHeader";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  username: string;
}

interface Message {
  role: "assistant" | "system";
  content: string;
  id?: string;
}

interface LocalEvolveSession {
  id: string;
  status: "starting" | "running-claude" | "starting-server" | "ready" | "error";
  progressText: string;
  port: number | null;
  previewUrl: string | null;
  branch: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface EvolveFormProps {
  branch?: string | null;
}

export default function EvolveForm({ branch }: EvolveFormProps = {}) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  // Fetch session on mount
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => {
        setSessionUser(data.user);
      })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
  }

  // Close the hamburger dropdown when the user clicks outside it
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, handleClickOutside]);

  const [submittedRequest, setSubmittedRequest] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [, setLocalEvolveSession] = useState<LocalEvolveSession | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
      if (localPollingRef.current !== null) clearInterval(localPollingRef.current);
    };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);
    setSubmitted(true);
    setSubmittedRequest(trimmed);

    await handleLocalEvolveSubmit(trimmed);

    setIsLoading(false);
  }

  // ── Local evolve ───────────────────────────────────────────────────────────

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

          if (data.status === "ready" && data.previewUrl !== null) {
            const previewUrl = data.previewUrl;
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  `🚀 Preview ready: [${previewUrl}](${previewUrl})\n\n` +
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
    setSubmittedRequest(null);
    setLocalEvolveSession(null);
    if (localPollingRef.current !== null) clearInterval(localPollingRef.current);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Propose a change" />
        {/* Hamburger menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            {menuOpen ? (
              /* X icon — close */
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : (
              /* Hamburger icon — open */
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            )}
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-40 overflow-hidden">
              {/* Auth item */}
              {sessionUser ? (
                <>
                  <div className="px-4 py-2 border-b border-gray-800">
                    <p className="text-xs text-gray-500">Signed in as</p>
                    <p className="text-sm text-gray-200 font-medium truncate">@{sessionUser.username}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); handleLogout(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-red-400 hover:bg-gray-800 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-blue-400 hover:bg-gray-800 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Log in
                </Link>
              )}
              {/* Go to chat */}
              <Link
                href="/chat"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-blue-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Go to chat
              </Link>
              {/* Sync with GitHub */}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setSyncDialogOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-green-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
                Sync with GitHub
              </button>
            </div>
          )}
        </div>
        {/* Git sync confirmation dialog */}
        {syncDialogOpen && (
          <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
        )}
      </header>

      {/* Description banner */}
      {!submitted && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm">
          <strong className="font-semibold">Evolve Primordia</strong> —{" "}
          Describe a change you want to make to this app.
        </div>
      )}

      {/* Submitted request — shown after form is submitted so user can see their request */}
      {submitted && submittedRequest && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-gray-900 border border-gray-700 text-sm">
          <p className="text-gray-400 text-xs mb-1 font-medium uppercase tracking-wide">Your request</p>
          <p className="text-gray-100 leading-relaxed whitespace-pre-wrap">{submittedRequest}</p>
        </div>
      )}

      {/* Progress messages (shown after submission) */}
      {submitted && messages.length > 0 && (
        <div className="flex-1 space-y-4 mb-6">
          {messages.map((msg, i) => (
            <div key={msg.id ?? i} className="px-4 py-3 rounded-lg bg-gray-800 text-gray-100 text-sm leading-relaxed">
              <MarkdownContent text={msg.content} />
            </div>
          ))}
          {isLoading && (
            <div className="text-sm text-gray-500 animate-pulse">Starting…</div>
          )}
          <div ref={messagesEndRef} />
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
        !isLoading && (
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
