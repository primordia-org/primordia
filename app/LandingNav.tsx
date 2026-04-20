// components/LandingNav.tsx
// Client component — a subtle fixed hamburger menu in the top-right corner of
// the landing page. No navbar chrome; just the session-aware HamburgerMenu
// floating over the hero with a transparent background.
//
// The FloatingEvolveDialog is dynamically imported so it doesn't bloat the
// landing page's initial JS bundle — it's only loaded when the user clicks
// "Propose a change" from the menu.

"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useSessionUser } from "@/lib/hooks";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";

// Lazy-load the heavy evolve dialog — only fetched when the user opens it.
const FloatingEvolveDialog = dynamic(
  () => import("@/components/FloatingEvolveDialog").then((m) => m.FloatingEvolveDialog),
  { ssr: false },
);
const EvolveSubmitToast = dynamic(
  () => import("@/components/FloatingEvolveDialog").then((m) => m.EvolveSubmitToast),
  { ssr: false },
);

export function LandingNav() {
  const { sessionUser, handleLogout } = useSessionUser();
  const [evolveDialogOpen, setEvolveDialogOpen] = useState(false);
  const [evolveAnchorRect, setEvolveAnchorRect] = useState<DOMRect | null>(null);
  const [toastSessionId, setToastSessionId] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);

  const menuItems = buildStandardMenuItems({
    isAdmin: sessionUser?.isAdmin ?? false,
    currentPath: "/",
    onEvolveClick: () => {
      setEvolveAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
      setEvolveDialogOpen(true);
    },
  });

  return (
    <div className="fixed top-4 right-4 z-50">
      <HamburgerMenu
        sessionUser={sessionUser}
        onLogout={handleLogout}
        containerRef={hamburgerRef}
        items={menuItems}
      />

      {evolveDialogOpen && (
        <FloatingEvolveDialog
          onClose={() => setEvolveDialogOpen(false)}
          anchorRect={evolveAnchorRect}
          onSessionCreated={(id) => setToastSessionId(id)}
        />
      )}
      {toastSessionId && (
        <EvolveSubmitToast
          sessionId={toastSessionId}
          onDismiss={() => setToastSessionId(null)}
        />
      )}
    </div>
  );
}
