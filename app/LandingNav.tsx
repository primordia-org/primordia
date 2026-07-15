// components/LandingNav.tsx
// Client component — a subtle fixed hamburger menu in the top-right corner of
// the landing page. No navbar chrome; just the session-aware HamburgerMenu
// floating over the hero with a transparent background.
//
// The FloatingThreadDialog is dynamically imported so it doesn't bloat the
// landing page's initial JS bundle — it's only loaded when the user clicks
// "Propose a change" from the menu.

"use client";

import { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSessionUser } from "@/lib/hooks";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";

// Lazy-load the heavy thread dialog — only fetched when the user opens it.
const FloatingThreadDialog = dynamic(
  () => import("@/components/FloatingThreadDialog").then((m) => m.FloatingThreadDialog),
  { ssr: false },
);
const ThreadSubmitToast = dynamic(
  () => import("@/components/FloatingThreadDialog").then((m) => m.ThreadSubmitToast),
  { ssr: false },
);

export function LandingNav() {
  const { sessionUser, handleLogout } = useSessionUser();
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [threadAnchorRect, setThreadAnchorRect] = useState<DOMRect | null>(null);
  const [toastSessionId, setToastSessionId] = useState<string | null>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);

  const handleThreadClick = useCallback(() => {
    setThreadAnchorRect(hamburgerRef.current?.getBoundingClientRect() ?? null);
    setThreadDialogOpen(true);
  }, []);

  // eslint-disable-next-line react-hooks/refs
  const menuItems = buildStandardMenuItems({
    isAdmin: sessionUser?.isAdmin ?? false,
    currentPath: "/",
    onThreadClick: handleThreadClick,
  });

  return (
    <div className="fixed top-4 right-4 z-50">
      <HamburgerMenu
        sessionUser={sessionUser}
        onLogout={handleLogout}
        containerRef={hamburgerRef}
        items={menuItems}
      />

      {threadDialogOpen && (
        <FloatingThreadDialog
          onClose={() => setThreadDialogOpen(false)}
          anchorRect={threadAnchorRect}
          onSessionCreated={(id) => setToastSessionId(id)}
        />
      )}
      {toastSessionId && (
        <ThreadSubmitToast
          sessionId={toastSessionId}
          onDismiss={() => setToastSessionId(null)}
        />
      )}
    </div>
  );
}
