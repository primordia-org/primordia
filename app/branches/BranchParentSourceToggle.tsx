"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const usesForkMarkers = source === "fork-marker";

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
            Toggle between legacy git config and fork-marker commit trailers.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => updateSource(usesForkMarkers ? "git-config" : "fork-marker")}
          className={`relative h-7 w-36 rounded-full border transition ${
            disabled
              ? "cursor-not-allowed border-gray-800 bg-gray-900 text-gray-700"
              : "border-gray-700 bg-gray-900 text-gray-300 hover:border-purple-500"
          }`}
          aria-pressed={usesForkMarkers}
        >
          <span
            className={`absolute top-0.5 h-6 w-[4.1rem] rounded-full bg-purple-600 transition ${
              usesForkMarkers ? "left-[4.15rem]" : "left-0.5"
            }`}
          />
          <span className="relative grid h-full grid-cols-2 items-center text-[10px] uppercase tracking-wide">
            <span className={!usesForkMarkers ? "text-white" : "text-gray-500"}>config</span>
            <span className={usesForkMarkers ? "text-white" : "text-gray-500"}>marker</span>
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
