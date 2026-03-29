"use client";

// components/StreamingDialog.tsx
// Generic modal dialog for operations that stream SSE output from an API
// endpoint (git-sync, prune-branches, etc.). Handles all state, streaming
// logic, and UI chrome; callers supply only the text and endpoint that differ.
// GitSyncDialog and PruneBranchesDialog are thin wrappers around this.

import { useState, useRef, useEffect } from "react";

type DialogState = "idle" | "running" | "success" | "error";

interface StreamingDialogProps {
  onClose: () => void;
  title: string;
  /** Icon element shown in the title bar (typically a small coloured SVG). */
  titleIcon: React.ReactNode;
  /** Content rendered in the body while the dialog is in the idle state. */
  idleBody: React.ReactNode;
  /** Label for the confirm/run button shown in the idle footer. */
  actionLabel: string;
  /** Tailwind classes for the action button (background + text colour). */
  actionButtonClass: string;
  /** Animated label shown while the operation is running. */
  runningLabel: string;
  /** Message shown after a successful run. */
  successMessage: string;
  /** Message shown after a failed run. */
  errorMessage: string;
  /** API endpoint to POST to when the user confirms. */
  apiEndpoint: string;
}

export function StreamingDialog({
  onClose,
  title,
  titleIcon,
  idleBody,
  actionLabel,
  actionButtonClass,
  runningLabel,
  successMessage,
  errorMessage,
  apiEndpoint,
}: StreamingDialogProps) {
  const [state, setState] = useState<DialogState>("idle");
  const [output, setOutput] = useState("");
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the output box as new text arrives
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  async function handleRun() {
    setState("running");
    setOutput("");

    try {
      const response = await fetch(apiEndpoint, { method: "POST" });
      if (!response.ok) {
        setOutput(`HTTP error ${response.status}: ${response.statusText}`);
        setState("error");
        return;
      }
      if (!response.body) {
        setOutput("No response body.");
        setState("error");
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
              setState(parsed.outcome === "success" ? "success" : "error");
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
      setState("error");
    }
  }

  const isRunning = state === "running";
  const isDone = state === "success" || state === "error";

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
            {titleIcon}
            <span className="text-sm font-semibold text-white">{title}</span>
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
          {state === "idle" && idleBody}

          {/* Output area — shown once the operation starts */}
          {(isRunning || isDone) && (
            <div className="bg-gray-950 rounded-lg border border-gray-800 p-3 max-h-72 overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
              {output || " "}
              <div ref={outputEndRef} />
            </div>
          )}

          {/* Status badge */}
          {state === "success" && (
            <p className="text-sm text-green-400 font-medium">{successMessage}</p>
          )}
          {state === "error" && (
            <p className="text-sm text-red-400 font-medium">{errorMessage}</p>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-3">
          {state === "idle" && (
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
                onClick={handleRun}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${actionButtonClass}`}
              >
                {actionLabel}
              </button>
            </>
          )}
          {isRunning && (
            <span className="text-sm text-gray-400 animate-pulse">{runningLabel}</span>
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
