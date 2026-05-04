"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { SessionUser } from "../lib/hooks";
import { Edit, Shield, X, Menu, LogOut, LogIn, Key, GitBranch, FileKey, QrCode } from "lucide-react";
import { AdminUpdatesBell } from "./AdminUpdatesBell";
import { ApiKeyDialog } from "./ApiKeyDialog";
import { CredentialsDialog } from "./CredentialsDialog";
import { QrSignInOtherDeviceDialog } from "./QrSignInOtherDeviceDialog";

const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));
const ROW = "flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-800 transition-colors";

function MenuBtn({ dataId, className, onClick, children }: {
  dataId?: string;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" data-id={dataId} onClick={onClick} className={cn(ROW, "w-full text-left", className)}>
      {children}
    </button>
  );
}

function MenuLink({ dataId, className, href, onClick, children }: {
  dataId?: string;
  className?: string;
  href: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link data-id={dataId} href={href} onClick={onClick} className={cn(ROW, className)}>
      {children}
    </Link>
  );
}

export type { SessionUser };

/** A single item in the dropdown. Supply either `href` (renders a Link) or `onClick` (renders a button). */
export interface MenuItem {
  icon: React.ReactNode;
  label: string;
  className?: string;
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
 * Returns the standard set of navigation items (Propose a change, Branches,
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
      label: "Propose a change",
      className: "hover:text-amber-400",
      ...(onEvolveClick ? { onClick: onEvolveClick } : { href: "/evolve" }),
      dataId: "nav-menu/propose-change",
      icon: <Edit size={16} strokeWidth={2} aria-hidden="true" />,
    },
    {
      label: "Branches",
      className: "hover:text-green-400",
      href: "/branches",
      dataId: "nav-menu/branches",
      icon: <GitBranch size={16} strokeWidth={2} aria-hidden="true" />,
    },
  ];
  if (isAdmin) {
    items.push({
      label: "Admin",
      className: "hover:text-purple-400",
      href: "/admin",
      dataId: "nav-menu/admin",
      icon: <Shield size={16} strokeWidth={2} aria-hidden="true" />,
    });
  }
  return items.filter((item) => !item.href || item.href !== currentPath);
}

export function HamburgerMenu({ sessionUser, onLogout, items, containerRef }: HamburgerMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [credentialsDialogOpen, setCredentialsDialogOpen] = useState(false);
  const [qrSignInDialogOpen, setQrSignInDialogOpen] = useState(false);
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
    <div className="flex items-center gap-1">
    <AdminUpdatesBell isAdmin={sessionUser?.isAdmin ?? false} />
    <div className="relative" ref={menuRef}>
      <button
        data-id="nav/menu-toggle"
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
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
              <MenuBtn dataId="nav-menu/sign-in-other-device" className="hover:text-blue-400" onClick={() => { setMenuOpen(false); setQrSignInDialogOpen(true); }}>
                <QrCode size={16} strokeWidth={2} aria-hidden="true" />
                Sign in on another device
              </MenuBtn>
              <MenuBtn dataId="nav-menu/sign-out" className="hover:text-red-400" onClick={() => { setMenuOpen(false); onLogout(); }}>
                <LogOut size={16} strokeWidth={2} aria-hidden="true" />
                Sign out
              </MenuBtn>
            </>
          ) : (
            <MenuLink dataId="nav-menu/sign-in" className="hover:text-blue-400" href={`/login?next=${encodeURIComponent(pathname)}`} onClick={() => setMenuOpen(false)}>
              <LogIn size={16} strokeWidth={2} aria-hidden="true" />
              Log in
            </MenuLink>
          )}

          {/* API Key and credentials settings — available to any logged-in user */}
          {sessionUser && (
            <>
              <MenuBtn dataId="nav-menu/api-key" className="hover:text-amber-400" onClick={() => { setMenuOpen(false); setApiKeyDialogOpen(true); }}>
                <Key size={16} strokeWidth={2} aria-hidden="true" />
                API Key
              </MenuBtn>
              {/*
              Disabling for now since claude-worker.ts uses the Agent SDK which does not support claude.ai subscriptions.
              We can refactor it to use claude code directly in the near future. But I'm really enjoying `pi`.
              */}
              {/* <MenuBtn dataId="nav-menu/credentials" className="hover:text-sky-400" onClick={() => { setMenuOpen(false); setCredentialsDialogOpen(true); }}>
                <FileKey size={16} strokeWidth={2} aria-hidden="true" />
                Claude Credentials
              </MenuBtn> */}
            </>
          )}

          {/* Page-specific items */}
          {items.map((item, i) =>
            item.href ? (
              <MenuLink key={i} href={item.href} dataId={item.dataId} className={item.className} onClick={() => { setMenuOpen(false); item.onClick?.(); }}>
                {item.icon}
                {item.label}
              </MenuLink>
            ) : (
              <MenuBtn key={i} dataId={item.dataId} className={item.className} onClick={() => { setMenuOpen(false); item.onClick?.(); }}>
                {item.icon}
                {item.label}
              </MenuBtn>
            )
          )}
        </div>
      )}

      {/* API Key dialog — rendered outside the dropdown so it is not clipped */}
      {apiKeyDialogOpen && (
        <ApiKeyDialog onClose={() => setApiKeyDialogOpen(false)} />
      )}

      {/* Claude Credentials dialog */}
      {/* {credentialsDialogOpen && (
        <CredentialsDialog onClose={() => setCredentialsDialogOpen(false)} />
      )} */}

      {/* Sign in on another device dialog */}
      {qrSignInDialogOpen && (
        <QrSignInOtherDeviceDialog onClose={() => setQrSignInDialogOpen(false)} />
      )}
    </div>
    </div>
  );
}
