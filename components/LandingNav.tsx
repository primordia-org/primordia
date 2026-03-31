// components/LandingNav.tsx
// Client component — handles hamburger menu toggle for the landing page navbar.
// On mobile the nav links collapse behind a hamburger button; on sm+ they are
// shown inline as usual.

"use client";

import { useState } from "react";
import Link from "next/link";

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-white/5">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-6 py-4">
        {/* Brand */}
        <Link
          href="/"
          className="font-mono font-bold text-white tracking-tight hover:text-gray-300 transition-colors"
        >
          Primordia
        </Link>

        {/* Desktop links — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-1">
          <Link
            href="/changelog"
            className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            Changelog
          </Link>
          <Link
            href="/login"
            className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            Login
          </Link>
          <Link
            href="/chat"
            className="ml-2 px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors font-mono"
          >
            Open app →
          </Link>
        </div>

        {/* Hamburger button — visible on mobile only */}
        <button
          type="button"
          className="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? (
            // X icon
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            // Hamburger icon
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Mobile dropdown ── */}
      {open && (
        <div className="sm:hidden border-t border-white/5 px-4 pb-4 flex flex-col gap-1">
          <Link
            href="/changelog"
            onClick={() => setOpen(false)}
            className="px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            Changelog
          </Link>
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            Login
          </Link>
          <Link
            href="/chat"
            onClick={() => setOpen(false)}
            className="mt-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors font-mono text-center"
          >
            Open app →
          </Link>
        </div>
      )}
    </nav>
  );
}
