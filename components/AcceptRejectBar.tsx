"use client";

// components/AcceptRejectBar.tsx
// Accept/reject bar for local worktree previews.
// Rendered in the root layout, below the main app content (below the fold).
// Users scroll down to reveal it — the main app stays at 100dvh.

import { useState } from "react";

interface Props {
  /** True when this instance is running as a local preview worktree. */
  isPreviewInstance: boolean;
  /** The parent branch name to merge into on accept. Defaults to "main". */
  previewParentBranch: string;
}

export default function AcceptRejectBar({ isPreviewInstance, previewParentBranch }: Props) {
  const [previewActionState, setPreviewActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Don't render anything if not a local preview instance.
  if (!isPreviewInstance) return null;

  // ── Local preview handlers ─────────────────────────────────────────────────

  async function handlePreviewAccept() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/evolve/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("accepted");
      // Signal the parent tab to run bun install + restart its dev server.
      try { window.opener?.postMessage({ type: "primordia:preview-accepted" }, "*"); } catch { /* ignore */ }
      // Focus the parent tab (opened this preview via target="_blank"), then
      // close this window so the user isn't left on a dead "port unbound" page.
      try { window.opener?.focus(); } catch { /* ignore cross-origin guard */ }
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 1500);
    } catch (err) {
      setPreviewActionState("idle");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function handlePreviewReject() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/evolve/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("rejected");
      // Focus the parent tab and close this preview window.
      try { window.opener?.focus(); } catch { /* ignore cross-origin guard */ }
      setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 1500);
    } catch (err) {
      setPreviewActionState("idle");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-gray-800 bg-gray-950 px-4 py-4 w-full max-w-3xl mx-auto">
      {/* Local preview bar */}
      {previewActionState !== "accepted" && previewActionState !== "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm space-y-3">
          <p className="text-green-200 font-semibold">
            🔍 This is a local preview — review the changes, then accept or reject.
          </p>
          <p className="text-green-300 text-xs">
            Accepting will merge the preview branch into{" "}
            <code className="bg-green-900/50 px-1 rounded">{previewParentBranch}</code>.
            Rejecting will discard the worktree and branch.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreviewAccept}
              disabled={previewActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white disabled:opacity-50"
            >
              {previewActionState === "loading" ? "…" : "Accept Changes"}
            </button>
            <button
              onClick={handlePreviewReject}
              disabled={previewActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 rounded text-white disabled:opacity-50"
            >
              {previewActionState === "loading" ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      {previewActionState === "accepted" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm">
          <p className="text-green-200">
            ✅ Changes accepted and merged into{" "}
            <code className="bg-green-900/50 px-1 rounded">{previewParentBranch}</code>. You can close this preview.
          </p>
        </div>
      )}
      {previewActionState === "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm">
          <p className="text-red-200">🗑️ Preview rejected. You can close this preview.</p>
        </div>
      )}

      {/* Error banner — shown whenever any action fails */}
      {errorMessage && (
        <div className="mt-2 px-4 py-3 rounded-lg bg-red-900/40 border border-red-600/50 text-sm flex items-start justify-between gap-2">
          <p className="text-red-300 whitespace-pre-wrap break-words">⚠️ Error: {errorMessage}</p>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200 shrink-0 text-xs"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
