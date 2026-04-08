"use client";

// components/CreateSessionFromBranchButton.tsx
// Button that creates an evolve session for an existing branch.
// Shown on the /branches page next to branches that have no active session.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "../lib/base-path";

interface Props {
  branchName: string;
}

export function CreateSessionFromBranchButton({ branchName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/evolve/from-branch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName, request: request.trim() || undefined }),
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-purple-500 hover:text-purple-300 text-xs ml-1 shrink-0"
        title={`Create evolve session for ${branchName}`}
      >
        + session
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-1.5 ml-1 shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        type="text"
        placeholder="What do you want to do? (optional)"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        disabled={loading}
        className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500 w-56"
      />
      <button
        type="submit"
        disabled={loading}
        className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-50"
      >
        {loading ? "creating…" : "create"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setError(null); }}
        disabled={loading}
        className="text-xs text-gray-600 hover:text-gray-400"
      >
        cancel
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </form>
  );
}
