"use client";
// components/AdminRollbackClient.tsx
// Lists previous production slots from the PROD git reflog and lets the admin roll back to one.

import { useState, useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

interface RollbackTarget {
  branch: string;
  worktreePath: string;
  reflogIndex: number;
}

interface RollbackData {
  currentBranch: string | null;
  targets: RollbackTarget[];
}

export default function AdminRollbackClient() {
  const [data, setData] = useState<RollbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadTargets() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/rollback"));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTargets();
  }, []);

  async function applyRollback(target: RollbackTarget) {
    if (!confirm(`Roll back production to "${target.branch}"?\n\nThis will start the server in that worktree and switch traffic to it.`)) return;
    setRolling(true);
    setMessage(null);
    setActionError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/rollback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: target.worktreePath }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setMessage(
        `Rolling back to "${target.branch}"… the server is starting. This may take up to 30 seconds.`,
      );
      // Refresh the target list after the rollback completes
      setTimeout(() => loadTargets(), 6_000);
    } catch (e) {
      setActionError(String(e));
    } finally {
      setRolling(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading rollback targets…</p>;
  }

  if (fetchError) {
    return <p className="text-sm text-red-400">{fetchError}</p>;
  }

  if (!data) return null;

  return (
    <section>
      <div className="mb-6">
        <h2 className="text-base font-medium text-gray-200 mb-1">Current production</h2>
        <p className="text-sm text-gray-400 font-mono">
          {data.currentBranch ?? <span className="italic text-gray-500">unknown</span>}
        </p>
      </div>

      <h2 className="text-base font-medium text-gray-200 mb-3">Available rollback targets</h2>
      <p className="text-sm text-gray-500 mb-4">
        Previous production slots, ordered from most recent to oldest. Selecting one will start
        its server and switch all traffic to it zero-downtime.
      </p>

      {data.targets.length === 0 ? (
        <p className="text-sm text-gray-500">No previous production slots found.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.targets.map((target) => (
            <div
              key={target.worktreePath}
              className="flex items-center justify-between gap-4 p-3 rounded border border-gray-700 bg-gray-900"
            >
              <div className="min-w-0">
                <p className="text-sm text-gray-200 font-mono truncate">{target.branch}</p>
                <p className="text-xs text-gray-500 truncate">{target.worktreePath}</p>
              </div>
              <button
                data-id="admin-rollback/apply-rollback"
                onClick={() => applyRollback(target)}
                disabled={rolling}
                className="shrink-0 px-3 py-1.5 text-sm rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                Roll back
              </button>
            </div>
          ))}
        </div>
      )}

      {message && <p className="mt-4 text-sm text-green-400">{message}</p>}
      {actionError && <p className="mt-4 text-sm text-red-400">{actionError}</p>}
    </section>
  );
}
