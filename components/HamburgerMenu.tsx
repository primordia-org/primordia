"use client";

// components/HamburgerMenu.tsx
// Reusable hamburger menu button + dropdown. Used by ChatInterface, EvolveForm,
// EvolveSessionView, and PageNavBar. Manages open/close state and click-outside
// behaviour internally; callers pass the session user and page-specific items.
//
// buildStandardMenuItems() returns the shared navigation items (Go to chat,
// Propose a change, Admin) used by every primary app page,
// so callers don't have to duplicate the icon JSX. Pass `currentPath` to
// suppress the link to whichever page the user is already on.

import { useState, useRef, useEffect, useCallback } from "react";
import { useSounds } from "@/lib/sounds";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "../lib/hooks";
import { MessageSquare, Edit, Shield, X, Menu, LogOut, LogIn, Key, GitBranch } from "lucide-react";
import { ApiKeyDialog } from "./ApiKeyDialog";

export type { SessionUser };

/** A single item in the dropdown. Supply either `href` (renders a Link) or `onClick` (renders a button). */
export interface MenuItem {
  icon: React.ReactNode;
  label: string;
  /** Full Tailwind hover-colour class, e.g. "hover:text-amber-400". */
  hoverColor: string;
  href?: string;
  onClick?: () => void;
  /** Stable data-id for testing/telemetry, e.g. "nav-menu/propose-change". */
  dataId?: string;
}

interface HamburgerMenuProps {
  sessionUser: SessionUser | null;
  onLogout: () => void;
  /** Page-specific items rendered below the built-in auth section. */
  items: MenuItem[];
  /** Optional ref exposed to callers so they can read the container's DOMRect (e.g. to anchor a floating dialog). */
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Returns the standard set of navigation items (Go to chat, Propose a change,
 * Admin) shared by all primary app pages. Any item whose `href` matches
 * `currentPath` is omitted, so the menu never links to the page you're already on.
 */
export function buildStandardMenuItems({
  isAdmin,
  currentPath,
  onEvolveClick,
}: {
  isAdmin: boolean;
  currentPath?: string;
  /** When provided, "Propose a change" opens this callback instead of navigating to /evolve. */
  onEvolveClick?: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: "Go to chat",
      hoverColor: "hover:text-blue-400",
      href: "/chat",
      dataId: "nav-menu/go-to-chat",
      icon: <MessageSquare size={16} strokeWidth={2} aria-hidden="true" />,
    },
    {
      label: "Propose a change",
      hoverColor: "hover:text-amber-400",
      ...(onEvolveClick ? { onClick: onEvolveClick } : { href: "/evolve" }),
      dataId: "nav-menu/propose-change",
      icon: <Edit size={16} strokeWidth={2} aria-hidden="true" />,
    },
    {
      label: "Branches",
      hoverColor: "hover:text-green-400",
      href: "/branches",
      dataId: "nav-menu/branches",
      icon: <GitBranch size={16} strokeWidth={2} aria-hidden="true" />,
    },
  ];
  if (isAdmin) {
    items.push({
      label: "Admin",
      hoverColor: "hover:text-purple-400",
      href: "/admin",
      dataId: "nav-menu/admin",
      icon: <Shield size={16} strokeWidth={2} aria-hidden="true" />,
    });
  }
  return items.filter((item) => !item.href || item.href !== currentPath);
}

export function HamburgerMenu({ sessionUser, onLogout, items, containerRef }: HamburgerMenuProps) {
  const sounds = useSounds();
  const [menuOpen, setMenuOpen] = useState(false);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const localRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const menuRef = containerRef ?? localRef;

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
        data-id="nav/menu-toggle"
        type="button"
        onClick={() => {
          const next = !menuOpen;
          if (next) sounds.menuOpen(); else sounds.menuClose();
          setMenuOpen(next);
        }}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
      >
        {menuOpen ? (
          <X size={20} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Menu size={20} strokeWidth={2} aria-hidden="true" />
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
                data-id="nav-menu/sign-out"
                type="button"
                onClick={() => { setMenuOpen(false); onLogout(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-red-400 hover:bg-gray-800 transition-colors"
              >
                <LogOut size={16} strokeWidth={2} aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <Link
              data-id="nav-menu/sign-in"
              href={`/login?next=${encodeURIComponent(pathname)}`}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-blue-400 hover:bg-gray-800 transition-colors"
            >
              <LogIn size={16} strokeWidth={2} aria-hidden="true" />
              Log in
            </Link>
          )}

          {/* API Key settings — available to any logged-in user */}
          {sessionUser && (
            <button
              data-id="nav-menu/api-key"
              type="button"
              onClick={() => { setMenuOpen(false); setApiKeyDialogOpen(true); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:text-amber-400 hover:bg-gray-800 transition-colors"
            >
              <Key size={16} strokeWidth={2} aria-hidden="true" />
              API Key
            </button>
          )}

          {/* Page-specific items */}
          {items.map((item, i) =>
            item.href ? (
              <Link
                key={i}
                href={item.href}
                data-id={item.dataId}
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
                data-id={item.dataId}
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

      {/* API Key dialog — rendered outside the dropdown so it is not clipped */}
      {apiKeyDialogOpen && (
        <ApiKeyDialog onClose={() => setApiKeyDialogOpen(false)} />
      )}
    </div>
  );
}
