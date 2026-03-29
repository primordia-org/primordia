"use client";

// components/EvolveForm.tsx
// The "submit a request" form for Primordia's evolve pipeline.
// Rendered at /evolve — a dedicated page, separate from the main chat interface.
//
// On submit: POSTs to /api/evolve/local, then redirects to /evolve/session/{id}
// where live Claude Code progress is tracked.

import { useState, useRef, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { GitSyncDialog } from "./GitSyncDialog";
import { NavHeader } from "./NavHeader";
import { HamburgerMenu } from "./HamburgerMenu";
import { useSessionUser } from "../lib/hooks";

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvolveFormProps {
  branch?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EvolveForm({ branch }: EvolveFormProps = {}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const { sessionUser, handleLogout } = useSessionUser();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea as the user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input]);

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/evolve/local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: trimmed }),
      });

      const data = (await res.json()) as { sessionId?: string; error?: string };

      if (!res.ok) {
        throw new Error(data.error ?? `API error: ${res.statusText}`);
      }

      // Redirect to the dedicated session page for live progress tracking.
      router.push(`/evolve/session/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <NavHeader branch={branch} subtitle="Propose a change" />
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={[
            {
              label: "Go to chat",
              hoverColor: "hover:text-blue-400",
              href: "/chat",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
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

      {/* Description banner */}
      <div className="mb-6 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-amber-300 text-sm">
        <strong className="font-semibold">Evolve Primordia</strong> —{" "}
        Describe a change you want to make to this app.
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {/* Input form */}
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
            {isLoading ? "Submitting…" : "Submit Request"}
          </button>
        </div>
      </form>
    </main>
  );
}
