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

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { NavHeader } from "./NavHeader";
import { GitSyncDialog } from "./GitSyncDialog";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  username: string;
}

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
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PageNavBar({ subtitle, branch, currentPage }: PageNavBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  // undefined = still loading; null = not logged in; object = logged in
  const [sessionUser, setSessionUser] = useState<SessionUser | null | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch session once on mount
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data: { user: SessionUser | null }) => setSessionUser(data.user))
      .catch(() => setSessionUser(null));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionUser(null);
  }

  // Close dropdown when the user clicks outside it
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, handleClickOutside]);

  return (
    <header className="flex items-center justify-between mb-8 flex-shrink-0">
      <NavHeader branch={branch} subtitle={subtitle} currentPage={currentPage} />

      {/* Hamburger menu — only rendered when the user is logged in */}
      {sessionUser && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            {menuOpen ? (
              /* X icon — close */
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            ) : (
              /* Hamburger icon — open */
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            )}
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-40 overflow-hidden">
              {/* Signed-in identity + sign-out */}
              <div className="px-4 py-2 border-b border-gray-800">
                <p className="text-xs text-gray-500">Signed in as</p>
                <p className="text-sm text-gray-200 font-medium truncate">@{sessionUser.username}</p>
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); handleLogout(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-red-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out
              </button>

              {/* Go to chat */}
              <Link
                href="/chat"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-blue-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Go to chat
              </Link>

              {/* Propose a change */}
              <Link
                href="/evolve"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-amber-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                Propose a change
              </Link>

              {/* Sync with GitHub */}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setSyncDialogOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-green-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                </svg>
                Sync with GitHub
              </button>
            </div>
          )}
        </div>
      )}

      {/* Git sync confirmation dialog (portal-style — rendered outside the menu div) */}
      {syncDialogOpen && (
        <GitSyncDialog onClose={() => setSyncDialogOpen(false)} />
      )}
    </header>
  );
}
