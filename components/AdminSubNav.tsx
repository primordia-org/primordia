// components/AdminSubNav.tsx
// Tab-style subnav for admin pages (/admin, /admin/logs).

import Link from "next/link";

interface AdminSubNavProps {
  currentTab: "users" | "logs";
}

const tabs = [
  { id: "users" as const, label: "Manage Users", href: "/admin" },
  { id: "logs" as const, label: "Server Logs", href: "/admin/logs" },
];

export default function AdminSubNav({ currentTab }: AdminSubNavProps) {
  return (
    <nav className="flex gap-1 mb-6 border-b border-gray-800">
      {tabs.map((tab) => {
        const active = tab.id === currentTab;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              active
                ? "text-white border-b-2 border-white -mb-px"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
