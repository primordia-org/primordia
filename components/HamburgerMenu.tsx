"use client";

// components/HamburgerMenu.tsx
// Reusable hamburger menu button + dropdown. Used by ChatInterface, EvolveForm,
// EvolveSessionView, and PageNavBar. Manages open/close state and click-outside
// behaviour internally; callers pass the session user and page-specific items.

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
