"use client";

// components/DiffFileExpander.tsx
//
// A single expandable file row inside the git diff summary table.
// Clicking the row lazy-loads the colorized unified diff from /api/evolve/diff.

import { useState, useRef } from "react";
import { withBasePath } from "@/lib/base-path";

interface Props {
  sessionId: string;
  file: string;
  additions: number;
  deletions: number;
  isLast: boolean;
}

/** Render a raw unified diff as colorized JSX lines. */
function ColorizedDiff({ raw }: { raw: string }) {
  const lines = raw.split("\n");
  // Drop trailing empty line from the split
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return (
    <pre className="text-xs font-mono overflow-x-auto leading-5 p-3 bg-black/40 rounded-b">
      {lines.map((line, i) => {
        let className = "text-gray-400"; // default (context lines, headers)
        if (line.startsWith("+") && !line.startsWith("+++")) {
          className = "text-green-400 bg-green-950/40 block";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          className = "text-red-400 bg-red-950/40 block";
        } else if (line.startsWith("@@")) {
          className = "text-blue-400 bg-blue-950/30 block";
        } else if (
          line.startsWith("diff ") ||
          line.startsWith("index ") ||
          line.startsWith("--- ") ||
          line.startsWith("+++ ")
        ) {
          className = "text-gray-500";
        }
        return (
          <span key={i} className={className}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

export function DiffFileExpander({ sessionId, file, additions, deletions, isLast }: Props) {
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  function handleToggle() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !fetchedRef.current) {
      fetchedRef.current = true;
      setLoading(true);
      fetch(
        withBasePath(
          `/api/evolve/diff?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(file)}`,
        ),
      )
        .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
        .then((text) => setDiff(text))
        .catch(() => setDiff("(Failed to load diff.)"))
        .finally(() => setLoading(false));
    }
  }

  return (
    <div className={`${isLast ? "" : "border-b border-gray-800/60"}`}>
      {/* Clickable file header row */}
      <div
        data-id="diff/file-toggle"
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleToggle()}
        className="flex items-center gap-2 px-4 py-1.5 font-mono text-xs cursor-pointer hover:bg-gray-800/30 select-none"
      >
        {/* Expand indicator */}
        {loading ? (
          <span className="flex-shrink-0 w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span
            className={`text-gray-600 transition-transform flex-shrink-0 text-[10px] ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
        )}
        <span className="text-gray-300 truncate flex-1">{file}</span>
        <span className="text-green-400 flex-shrink-0 w-12 text-right">+{additions}</span>
        <span className="text-red-400 flex-shrink-0 w-12 text-right">-{deletions}</span>
      </div>

      {/* Expandable diff body */}
      {open && diff !== null && (
        <div className="border-t border-gray-800/60">
          <ColorizedDiff raw={diff} />
        </div>
      )}
    </div>
  );
}
