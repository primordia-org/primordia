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

import { useState, useEffect, useRef } from "react";
import { NavHeader } from "./NavHeader";
import { FloatingEvolveDialog, EvolveSubmitToast } from "./FloatingEvolveDialog";
import { HamburgerMenu, buildStandardMenuItems } from "./HamburgerMenu";
import type { SessionUser } from "../lib/hooks";
import { withBasePath } from "../lib/base-path";

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
  /** Sticky harness preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialHarness?: string;
  /** Sticky model preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialModel?: string;
  /** Sticky caveman mode preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialCavemanMode?: boolean;
  /** Sticky caveman intensity preference loaded server-side. Forwarded to FloatingEvolveDialog. */
  initialCavemanIntensity?: import("../lib/user-prefs").CavemanIntensity;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PageNavBar({ subtitle, branch, currentPage, initialSession, initialHarness, initialModel, initialCavemanMode, initialCavemanIntensity }: PageNavBarProps) {
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const [toastSessionId, setToastSessionId] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  // undefined = still loading; null = not logged in; object = logged in
  // If initialSession was passed by the server, use it directly — no fetch needed.
  const [sessionUser, setSessionUser] = useState<SessionUser | null | undefined>(
    initialSession !== undefined ? initialSession : undefined,
  );

  // Only fetch session client-side when no server-provided value was given.
  useEffect(() => {
    if (initialSession !== undefined) return;
    fetch(withBasePath("/api/auth/session"))
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => setSessionUser(data.user))
      .catch(() => setSessionUser(null));
  }, [initialSession]);

  async function handleLogout() {
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
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
          containerRef={hamburgerRef}
          items={buildStandardMenuItems({
            onEvolveClick: () => {
              setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
              setEvolveDialogOpen(true);
            },
            isAdmin: sessionUser?.isAdmin ?? false,
            currentPath: currentPage ? `/${currentPage}` : undefined,
          })}
        />
      )}

      {evolveDialogOpen && (
        <FloatingEvolveDialog
          onClose={() => setEvolveDialogOpen(false)}
          anchorRect={evolveAnchorRect}
          initialHarness={initialHarness}
          initialModel={initialModel}
          initialCavemanMode={initialCavemanMode}
          initialCavemanIntensity={initialCavemanIntensity}
          onSessionCreated={(id) => setToastSessionId(id)}
        />
      )}
      {toastSessionId && (
        <EvolveSubmitToast
          sessionId={toastSessionId}
          onDismiss={() => setToastSessionId(null)}
        />
      )}
    </header>
  );
}
