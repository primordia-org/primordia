"use client";

// components/PageNavBar.tsx
// Shared nav header + hamburger menu for pages that are not the primary chat
// or evolve views (currently: /changelog and /branches).
//
// The hamburger menu is session-aware:
//   • Not logged in  → menu button is hidden entirely.
//   • Logged in      → menu button shown; dropdown contains sign-out and
//                      quick-navigation links.
//
// This keeps the navbar consistent with ChatInterface and EvolveForm while
// ensuring visitors without an account see a clean, uncluttered header.
//
// Performance: Server Component pages can pass `initialSession` (resolved
// server-side via getSessionUser()) so the hamburger is visible on first
// render with no client-side fetch needed.

import { useState, useEffect } from "react";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import type { SessionUser } from "../lib/hooks";

// ─── Props ───────────────────────────────────────────────────────────────────

interface PageNavBarProps {
  /** Short description shown below the "Primordia" title. */
  subtitle?: string;
  /** Current git branch name (optional). */
  branch?: string | null;
  /**
   * Which page we're on — suppresses the self-referential nav link in
   * NavHeader's subtitle and the corresponding dropdown item.
   */
  currentPage?: "changelog" | "branches" | "admin";
  /**
   * Session user resolved server-side and passed as a prop, so the
   * hamburger menu appears immediately without a client-side fetch.
   * When provided (even as null), skips the /api/auth/session fetch.
   */
  initialSession?: SessionUser | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PageNavBar({ subtitle, branch, currentPage, initialSession }: PageNavBarProps) {
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  // undefined = still loading; null = not logged in; object = logged in
  // If initialSession was passed by the server, use it directly — no fetch needed.
  const [sessionUser, setSessionUser] = useState<SessionUser | null | undefined>(
    initialSession !== undefined ? initialSession : undefined,
  );

  // Only fetch session client-side when no server-provided value was given.
  useEffect(() => {
    if (initialSession !== undefined) return;
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => setSessionUser(data.user))
      .catch(() => setSessionUser(null));
  }, [initialSession]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
  }

  return (
    <header className="flex items-center justify-between mb-8 flex-shrink-0">
      <NavHeader branch={branch} subtitle={subtitle} currentPage={currentPage} />

      {/* Hamburger menu — only rendered when the user is logged in */}
      {sessionUser && (
        <HamburgerMenu
          sessionUser={sessionUser}
          onLogout={handleLogout}
          items={buildStandardMenuItems({
            onSyncClick: () => setSyncDialogOpen(true),
            isAdmin: sessionUser?.isAdmin ?? false,
            excludeAdmin: currentPage === "admin",
          })}
        />
      )}

      {/* Git sync confirmation dialog (portal-style — rendered outside the menu div) */}
      {syncDialogOpen && (
        <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
      )}
    </header>
  );
}
