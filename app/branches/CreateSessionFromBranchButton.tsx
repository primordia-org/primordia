"use client";

// components/CreateSessionFromBranchButton.tsx
// Button that creates an evolve session for an existing branch.
// Shown on the /branches page next to branches that have no active session.
// No initial prompt is required — the session starts as an instant preview
// with the branch code ready to test. Follow-up requests can be submitted
// from the session view.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

interface Props {
  branchName: string;
}

export function CreateSessionFromBranchButton({ branchName }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/evolve/from-branch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName }),
      });
      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setError(data.error ?? "Failed to create session");
        setLoading(false);
        return;
      }
      router.push(`/evolve/session/${data.sessionId}`);
    } catch {
      setError("Network error — please try again");
      setLoading(false);
    }
  }

  return (
    <span className="ml-1 shrink-0 inline-flex items-center gap-1.5">
      <button
        data-id="branches/create-session-trigger"
        onClick={handleClick}
        disabled={loading}
        className="text-purple-500 hover:text-purple-300 text-xs disabled:opacity-50"
        title={`Create evolve session for ${branchName}`}
      >
        {loading ? "creating…" : "+ session"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
