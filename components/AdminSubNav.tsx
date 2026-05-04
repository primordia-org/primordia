// components/AdminSubNav.tsx
// Admin section navigation.
// Large screens: vertical sidebar.
// Mobile: <select> dropdown that navigates on change.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type TabId =
  | "users"
  | "logs"
  | "proxy-logs"
  | "rollback"
  | "server-health"
  | "git-mirror"
  | "updates"
  | "instance";

interface AdminSubNavProps {
  currentTab: TabId;
}

const tabs: { id: TabId; label: string; href: string }[] = [
  { id: "users", label: "Manage Users", href: "/admin" },
  { id: "logs", label: "Server Logs", href: "/admin/logs" },
  { id: "proxy-logs", label: "Proxy Logs", href: "/admin/proxy-logs" },
  { id: "rollback", label: "Rollback", href: "/admin/rollback" },
  { id: "server-health", label: "Server Health", href: "/admin/server-health" },
  { id: "git-mirror", label: "Git Mirror", href: "/admin/git-mirror" },
  { id: "updates", label: "Fetch Updates", href: "/admin/updates" },
  { id: "instance", label: "Instance", href: "/admin/instance" },
];

export default function AdminSubNav({ currentTab }: AdminSubNavProps) {
  const router = useRouter();
  const currentHref = tabs.find((t) => t.id === currentTab)?.href ?? "/admin";

  return (
    <>
      {/* Mobile: select dropdown */}
      <div className="lg:hidden w-full mb-2">
        <select
          value={currentHref}
          onChange={(e) => router.push(e.target.value)}
          className="w-full bg-gray-800 text-gray-200 text-sm px-3 py-2 rounded border border-gray-700 focus:outline-none focus:border-gray-500 cursor-pointer"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.href}>
              {tab.label}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: vertical sidebar */}
      <nav
        className="hidden lg:flex flex-col gap-0.5 w-44 shrink-0 sticky top-6"
        aria-label="Admin navigation"
      >
        {tabs.map((tab) => {
          const active = tab.id === currentTab;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-id={`admin-nav/${tab.id}`}
              className={`px-3 py-2 text-sm font-medium rounded transition-colors ${
                active
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
