"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ToggleLeft, ToggleRight } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { BranchParentSource } from "@/lib/branch-parent";

interface BranchParentSourceToggleProps {
  initialSource: BranchParentSource;
  disabled: boolean;
}

export function BranchParentSourceToggle({
  initialSource,
  disabled,
}: BranchParentSourceToggleProps) {
  const router = useRouter();
  const [source, setSource] = useState<BranchParentSource>(initialSource);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const usesBranchMarkers = source === "branch-marker";

  async function updateSource(nextSource: BranchParentSource) {
    if (disabled || isPending || nextSource === source) return;

    const previous = source;
    setSource(nextSource);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(withBasePath("/api/branches/parent-source"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: nextSource }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Could not save branch parent source");
        }
        router.refresh();
      } catch (err) {
        setSource(previous);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 p-3 font-mono text-xs text-gray-400">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-gray-300">Branch parent source</p>
          <p className="mt-1 text-gray-600">
            Toggle between legacy git config and branch-marker commit trailers.
          </p>
        </div>
        <button
          type="button"
          title={usesBranchMarkers ? "Use legacy git config" : "Use branch marker trailers"}
          disabled={disabled || isPending}
          onClick={() => updateSource(usesBranchMarkers ? "git-config" : "branch-marker")}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          aria-pressed={usesBranchMarkers}
        >
          {usesBranchMarkers ? (
            <ToggleRight size={18} strokeWidth={2} className="text-blue-400" />
          ) : (
            <ToggleLeft size={18} strokeWidth={2} />
          )}
          <span className="text-xs text-gray-300">
            {usesBranchMarkers ? "branch marker" : "git config"}
          </span>
        </button>
      </div>
      {disabled && (
        <p className="mt-2 text-gray-700">Sign in to save this preference.</p>
      )}
      {error && <p className="mt-2 text-red-400">{error}</p>}
    </div>
  );
}
