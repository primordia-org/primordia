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
import { HamburgerMenu } from "./HamburgerMenu";
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
  currentPage?: "changelog" | "branches";
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
          items={[
            {
              label: "Go to chat",
              hoverColor: "hover:text-blue-400",
              href: "/chat",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              ),
            },
            {
              label: "Propose a change",
              hoverColor: "hover:text-amber-400",
              href: "/evolve",
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              ),
            },
            {
              label: "Sync with GitHub",
              hoverColor: "hover:text-green-400",
              onClick: () => setSyncDialogOpen(true),
              icon: (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
              ),
            },
          ]}
        />
      )}

      {/* Git sync confirmation dialog (portal-style — rendered outside the menu div) */}
      {syncDialogOpen && (
        <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
      )}
    </header>
  );
}
