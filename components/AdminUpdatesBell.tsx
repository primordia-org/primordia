"use client";

// components/AdminUpdatesBell.tsx
// Bell notification icon shown to the left of the hamburger menu when an admin
// user is logged in and upstream update sources have new commits available.
// Clicking it navigates to /admin/updates.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

interface AdminUpdatesBellProps {
  /** Whether the current user is an admin. Bell only renders when true. */
  isAdmin: boolean;
}

export function AdminUpdatesBell({ isAdmin }: AdminUpdatesBellProps) {
  const [hasUpdates, setHasUpdates] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(withBasePath("/api/admin/updates/has-updates"));
        if (!res.ok || cancelled) return;
        const data: { hasUpdates: boolean } = await res.json();
        if (!cancelled) setHasUpdates(data.hasUpdates);
      } catch {
        // Silently ignore — bell stays hidden on error.
      }
    }

    check();
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin || !hasUpdates) return null;

  return (
    <Link
      href={withBasePath("/admin/updates")}
      aria-label="Updates available — go to Admin Updates"
      title="Updates available"
      className="p-2 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-gray-800 transition-colors animate-pulse"
    >
      <Bell size={20} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
