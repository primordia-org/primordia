// components/SettingsSubNav.tsx
// Account Settings section navigation.
// Large screens: vertical sidebar with live status indicators.
// Mobile: <select> dropdown that navigates on change.

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

type TabId = "api-key" | "claude-ai";

const tabs: { id: TabId; label: string; href: string }[] = [
  { id: "api-key", label: "API Keys", href: "/settings" },
  { id: "claude-ai", label: "Claude.ai Subscription", href: "/settings/claude-ai" },
];

export default function SettingsSubNav({ currentTab }: { currentTab: TabId }) {
  const router = useRouter();
  const currentHref = tabs.find((t) => t.id === currentTab)?.href ?? "/settings";
  const [apiKeyActive, setApiKeyActive] = useState(false);
  const [credentialsActive, setCredentialsActive] = useState(false);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(withBasePath('/api/secrets'));
        if (!res.ok) return;
        const { types } = (await res.json()) as { types: string[] };
        setApiKeyActive(types.includes('ANTHROPIC_API_KEY') || types.includes('OPENROUTER_API_KEY'));
        setCredentialsActive(types.includes('CLAUDE_CODE_CREDENTIALS_JSON'));
      } catch {}
    }
    void check();
  }, []);

  function isActive(tabId: TabId) {
    if (tabId === "api-key") return apiKeyActive;
    if (tabId === "claude-ai") return credentialsActive;
    return false;
  }

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
              {tab.label}{isActive(tab.id) ? " ●" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: vertical sidebar */}
      <nav
        className="hidden lg:flex flex-col gap-0.5 w-44 shrink-0 sticky top-6"
        aria-label="Account Settings navigation"
      >
        {tabs.map((tab) => {
          const active = tab.id === currentTab;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-id={`settings-nav/${tab.id}`}
              className={`flex items-center justify-between px-3 py-2 text-sm font-medium rounded transition-colors ${
                active
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              <span>{tab.label}</span>
              {isActive(tab.id) && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" aria-label="Active" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
