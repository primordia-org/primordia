"use client";

// components/GitSyncDialog.tsx
// Modal dialog for the "Sync with GitHub" action — pulls then pushes the
// current branch, streaming git output back to the user via /api/git-sync.
// Shared between ChatInterface (/chat) and EvolveForm (/evolve).

import { useState, useRef, useEffect } from "react";

type SyncState = "idle" | "running" | "success" | "error";

export function GitSyncDialog({ onClose }: { onClose: () => void }) {
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
