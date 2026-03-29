"use client";

// components/PruneBranchesDialog.tsx
// Modal dialog for the "Delete merged branches" action — finds all local
// branches already merged into main (excluding main itself) and deletes them,
// streaming git output back to the user via /api/prune-branches.

import { useState, useRef, useEffect } from "react";

type PruneState = "idle" | "running" | "success" | "error";

export function PruneBranchesDialog({ onClose }: { onClose: () => void }) {
  const [pruneState, setPruneState] = useState<PruneState>("idle");
  const [output, setOutput] = useState("");
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the output box as new text arrives
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  async function handlePrune() {
    setPruneState("running");
    setOutput("");

    try {
      const response = await fetch("/api/prune-branches", { method: "POST" });
      if (!response.ok) {
        setOutput(`HTTP error ${response.status}: ${response.statusText}`);
        setPruneState("error");
        return;
      }
      if (!response.body) {
        setOutput("No response body.");
        setPruneState("error");
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
              setPruneState(parsed.outcome === "success" ? "success" : "error");
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
      setPruneState("error");
    }
  }

  const isRunning = pruneState === "running";
  const isDone = pruneState === "success" || pruneState === "error";

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
            {/* Trash / prune icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            <span className="text-sm font-semibold text-white">
              Delete merged branches
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
          {pruneState === "idle" && (
            <p className="text-sm text-gray-300">
              This will{" "}
              <strong className="text-white">permanently delete</strong> all
              local branches that are already merged into{" "}
              <code className="text-orange-300 bg-gray-800 px-1 rounded">
                main
              </code>
              . The <code className="text-orange-300 bg-gray-800 px-1 rounded">main</code>{" "}
              branch itself will never be deleted.
            </p>
          )}

          {/* Output area — shown once prune starts */}
          {(isRunning || isDone) && (
            <div className="bg-gray-950 rounded-lg border border-gray-800 p-3 max-h-72 overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
              {output || " "}
              <div ref={outputEndRef} />
            </div>
          )}

          {/* Status badge */}
          {pruneState === "success" && (
            <p className="text-sm text-green-400 font-medium">
              ✅ Pruning complete!
            </p>
          )}
          {pruneState === "error" && (
            <p className="text-sm text-red-400 font-medium">
              ❌ Pruning finished with errors. Check the output above.
            </p>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-3">
          {pruneState === "idle" && (
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
                onClick={handlePrune}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-700 hover:bg-orange-600 text-white transition-colors"
              >
                Delete merged branches
              </button>
            </>
          )}
          {isRunning && (
            <span className="text-sm text-gray-400 animate-pulse">
              Deleting…
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
