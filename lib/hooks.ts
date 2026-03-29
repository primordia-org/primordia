// lib/hooks.ts
// Shared React hooks for Primordia client components.

import { useState, useEffect } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  username: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Fetches the current auth session on mount and provides a logout handler.
 * For use in "use client" components. Initial value is null (not yet fetched).
 */
export function useSessionUser() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => setSessionUser(data.user))
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
  }

  return { sessionUser, handleLogout };
}
