"use client";

// components/AcceptRejectBar.tsx
// Accept/reject bar for deploy previews (both local worktree and Vercel).
// Rendered in the root layout, below the main app content (below the fold).
// Users scroll down to reveal it — the main app stays at 100dvh.

import { useState, useEffect } from "react";

interface Props {
  /** True when this instance is running as a local preview worktree. */
  isPreviewInstance: boolean;
  /** The parent branch name to merge into on accept. Defaults to "main". */
  previewParentBranch: string;
}

export default function AcceptRejectBar({ isPreviewInstance, previewParentBranch }: Props) {
  const [deployPrNumber, setDeployPrNumber] = useState<number | null>(null);
  const [deployPrBaseBranch, setDeployPrBaseBranch] = useState<string>("main");
  const [deployPrState, setDeployPrState] = useState<"open" | "closed" | "merged" | null>(null);
  const [vercelActionState, setVercelActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");
  const [previewActionState, setPreviewActionState] = useState<"idle" | "loading" | "accepted" | "rejected">("idle");

  // Fetch PR context for accept/reject on Vercel preview deployments.
  // No environment guard needed — the API returns null data on non-preview builds.
  useEffect(() => {
    fetch("/api/deploy-context")
      .then((res) => res.json())
      .then((data: { prNumber?: number; prState?: "open" | "closed" | "merged"; prBaseBranch?: string }) => {
        if (data.prNumber) setDeployPrNumber(data.prNumber);
        if (data.prState) setDeployPrState(data.prState);
        if (data.prBaseBranch) setDeployPrBaseBranch(data.prBaseBranch);
      })
      .catch(() => {});
  }, []);

  // Don't render anything if neither preview type is active.
  const isVercelPreview = deployPrNumber !== null;
  if (!isPreviewInstance && !isVercelPreview) return null;

  // ── Local preview handlers ─────────────────────────────────────────────────

  async function handlePreviewAccept() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("accepted");
    } catch {
      setPreviewActionState("idle");
    }
  }

  async function handlePreviewReject() {
    if (!isPreviewInstance || previewActionState !== "idle") return;
    setPreviewActionState("loading");
    try {
      const res = await fetch("/api/evolve/local/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
      const data = (await res.json()) as { outcome?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `API error: ${res.statusText}`);
      setPreviewActionState("rejected");
    } catch {
      setPreviewActionState("idle");
    }
  }

  // ── Vercel preview handlers ────────────────────────────────────────────────

  async function handleVercelAccept() {
    if (!deployPrNumber || vercelActionState !== "idle") return;
    setVercelActionState("loading");
    try {
      const res = await fetch("/api/merge-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: deployPrNumber }),
      });
      const data = (await res.json()) as { merged?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `GitHub error: ${res.statusText}`);
      setVercelActionState("accepted");
    } catch {
      setVercelActionState("idle");
    }
  }

  async function handleVercelReject() {
    if (!deployPrNumber || vercelActionState !== "idle") return;
    setVercelActionState("loading");
    try {
      const res = await fetch("/api/close-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prNumber: deployPrNumber }),
      });
      const data = (await res.json()) as { closed?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `GitHub error: ${res.statusText}`);
      setVercelActionState("rejected");
    } catch {
      setVercelActionState("idle");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border-t border-gray-800 bg-gray-950 px-4 py-4 w-full max-w-3xl mx-auto">
      {/* Local preview bar */}
      {isPreviewInstance && previewActionState !== "accepted" && previewActionState !== "rejected" && (
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
      {isPreviewInstance && previewActionState === "accepted" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm">
          <p className="text-green-200">
            ✅ Changes accepted and merged into{" "}
            <code className="bg-green-900/50 px-1 rounded">{previewParentBranch}</code>. You can close this preview.
          </p>
        </div>
      )}
      {isPreviewInstance && previewActionState === "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm">
          <p className="text-red-200">🗑️ Preview rejected. You can close this preview.</p>
        </div>
      )}

      {/* Vercel preview bar */}
      {deployPrNumber !== null && deployPrState === "merged" && vercelActionState !== "accepted" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm">
          <p className="text-green-200">
            ✅ PR #{deployPrNumber} has already been merged. These changes are live in production.
          </p>
        </div>
      )}
      {deployPrNumber !== null && deployPrState === "closed" && vercelActionState !== "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm">
          <p className="text-red-200">
            🗑️ PR #{deployPrNumber} has already been closed. These changes were discarded.
          </p>
        </div>
      )}
      {deployPrNumber !== null && (deployPrState === "open" || deployPrState === null) && vercelActionState !== "accepted" && vercelActionState !== "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm space-y-3">
          <p className="text-green-200 font-semibold">
            🔍 This is a deploy preview of PR #{deployPrNumber} — review the changes, then accept or reject.
          </p>
          <p className="text-green-300 text-xs">
            Accepting will merge the PR into{" "}
            <code className="bg-green-900/50 px-1 rounded">{deployPrBaseBranch}</code>.
            Rejecting will close the PR.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleVercelAccept}
              disabled={vercelActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded text-white disabled:opacity-50"
            >
              {vercelActionState === "loading" ? "…" : "Accept Changes"}
            </button>
            <button
              onClick={handleVercelReject}
              disabled={vercelActionState === "loading"}
              className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 rounded text-white disabled:opacity-50"
            >
              {vercelActionState === "loading" ? "…" : "Reject"}
            </button>
          </div>
        </div>
      )}
      {deployPrNumber !== null && vercelActionState === "accepted" && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/40 text-sm">
          <p className="text-green-200">
            ✅ Changes accepted and merged into{" "}
            <code className="bg-green-900/50 px-1 rounded">{deployPrBaseBranch}</code>.
          </p>
        </div>
      )}
      {deployPrNumber !== null && vercelActionState === "rejected" && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/40 text-sm">
          <p className="text-red-200">🗑️ PR #{deployPrNumber} closed. Changes discarded.</p>
        </div>
      )}
    </div>
  );
}
