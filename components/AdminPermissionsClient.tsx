"use client";

// components/AdminPermissionsClient.tsx
// Interactive admin panel for managing user permissions.
// Loaded by app/admin/page.tsx with initial data from the server.

import { useState } from "react";

export interface AdminUser {
  id: string;
  username: string;
  isAdmin: boolean;
  canEvolve: boolean;
}

interface Props {
  users: AdminUser[];
}

export default function AdminPermissionsClient({ users: initial }: Props) {
  const [users, setUsers] = useState<AdminUser[]>(initial);
  const [busy, setBusy] = useState<string | null>(null); // userId being updated
  const [error, setError] = useState<string | null>(null);

  async function toggleEvolve(user: AdminUser) {
    setBusy(user.id);
    setError(null);
    const action = user.canEvolve ? "revoke" : "grant";
    try {
      const res = await fetch("/api/admin/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, permission: "can_evolve", action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, canEvolve: !u.canEvolve } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-900/40 border border-red-700/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/60">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">User</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Role</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Evolve access</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user, i) => (
              <tr
                key={user.id}
                className={`border-b border-gray-800/60 last:border-0 ${i % 2 === 0 ? "" : "bg-gray-900/30"}`}
              >
                <td className="px-4 py-3 text-gray-100 font-mono">{user.username}</td>
                <td className="px-4 py-3">
                  {user.isAdmin ? (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-800/50 text-amber-300 border border-amber-700/40">
                      owner
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400">
                      user
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {user.isAdmin || user.canEvolve ? (
                    <span className="text-green-400">✓ Granted</span>
                  ) : (
                    <span className="text-gray-500">— None</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {user.isAdmin ? (
                    <span className="text-xs text-gray-600 italic">always on</span>
                  ) : (
                    <button
                      onClick={() => toggleEvolve(user)}
                      disabled={busy === user.id}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        user.canEvolve
                          ? "bg-red-900/50 hover:bg-red-800/60 text-red-300 border border-red-700/40"
                          : "bg-green-900/50 hover:bg-green-800/60 text-green-300 border border-green-700/40"
                      }`}
                    >
                      {busy === user.id
                        ? "…"
                        : user.canEvolve
                        ? "Revoke evolve"
                        : "Grant evolve"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
