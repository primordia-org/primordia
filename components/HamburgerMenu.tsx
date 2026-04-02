"use client";

// components/HamburgerMenu.tsx
// Reusable hamburger menu button + dropdown. Used by ChatInterface, EvolveForm,
// EvolveSessionView, and PageNavBar. Manages open/close state and click-outside
// behaviour internally; callers pass the session user and page-specific items.
//
// buildStandardMenuItems() returns the shared navigation items (Go to chat,
// Propose a change, Sync with GitHub, Admin) used by every primary app page,
// so callers don't have to duplicate the icon JSX. Pass `currentPath` to
// suppress the link to whichever page the user is already on.

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import type { SessionUser } from "../lib/hooks";

export type { SessionUser };

/** A single item in the dropdown. Supply either `href` (renders a Link) or `onClick` (renders a button). */
export interface MenuItem {
  icon: React.ReactNode;
  label: string;
  /** Full Tailwind hover-colour class, e.g. "hover:text-amber-400". */
  hoverColor: string;
  href?: string;
  onClick?: () => void;
}

interface HamburgerMenuProps {
  sessionUser: SessionUser | null;
  onLogout: () => void;
  /** Page-specific items rendered below the built-in auth section. */
  items: MenuItem[];
}

/**
 * Returns the standard set of navigation items (Go to chat, Propose a change,
 * Sync with GitHub, Admin) shared by all primary app pages. Any item whose
 * `href` matches `currentPath` is omitted, so the menu never links to the
 * page you're already on.
 */
export function buildStandardMenuItems({
  onSyncClick,
  isAdmin,
  currentPath,
}: {
  onSyncClick: () => void;
  isAdmin: boolean;
  currentPath?: string;
}): MenuItem[] {
  const items: MenuItem[] = [
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
      onClick: onSyncClick,
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="16 16 12 12 8 16"/>
          <line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
        </svg>
      ),
    },
  ];
  if (isAdmin) {
    items.push({
      label: "Admin",
      hoverColor: "hover:text-purple-400",
      href: "/admin",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      ),
    });
    items.push({
      label: "Shell",
      hoverColor: "hover:text-orange-400",
      href: "/oops",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      ),
    });
  }
  return items.filter((item) => !item.href || item.href !== currentPath);
}

export function HamburgerMenu({ sessionUser, onLogout, items }: HamburgerMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
      >
        {menuOpen ? (
          /* X icon */
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          /* Hamburger icon */
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        )}
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-xl bg-gray-900 border border-gray-700 shadow-2xl z-40 overflow-hidden">
          {/* Auth section */}
          {sessionUser ? (
            <>
              <div className="px-4 py-2 border-b border-gray-800">
                <p className="text-xs text-gray-500">Signed in as</p>
                <p className="text-sm text-gray-200 font-medium truncate">@{sessionUser.username}</p>
              </div>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onLogout(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-red-400 hover:bg-gray-800 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-blue-400 hover:bg-gray-800 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Log in
            </Link>
          )}

          {/* Page-specific items */}
          {items.map((item, i) =>
            item.href ? (
              <Link
                key={i}
                href={item.href}
                onClick={() => { setMenuOpen(false); item.onClick?.(); }}
                className={`flex items-center gap-3 px-4 py-3 text-sm text-gray-300 ${item.hoverColor} hover:bg-gray-800 transition-colors`}
              >
                {item.icon}
                {item.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => { setMenuOpen(false); item.onClick?.(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 ${item.hoverColor} hover:bg-gray-800 transition-colors`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
