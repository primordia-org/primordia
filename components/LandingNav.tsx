// components/LandingNav.tsx
// Client component — a subtle fixed hamburger menu in the top-right corner of
// the landing page. No navbar chrome; just the session-aware HamburgerMenu
// floating over the hero with a transparent background.

"use client";

import { useSessionUser } from "@/lib/hooks";
import { HamburgerMenu, buildStandardMenuItems } from "@/components/HamburgerMenu";

export function LandingNav() {
  const { sessionUser, handleLogout } = useSessionUser();

  const menuItems = buildStandardMenuItems({
    isAdmin: sessionUser?.isAdmin ?? false,
    currentPath: "/",
  });

  return (
    <div className="fixed top-4 right-4 z-50">
      <HamburgerMenu
        sessionUser={sessionUser}
        onLogout={handleLogout}
        items={menuItems}
      />
    </div>
  );
}
