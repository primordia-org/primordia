// components/SettingsSubNav.tsx
// Account Settings section navigation.
// Large screens: vertical sidebar with live status indicators.
// Mobile: <select> dropdown that navigates on change.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SecretAuthSource } from "@/lib/presets";

type TabId = "billing-sources" | "presets" | "notifications";

const tabs: { id: TabId; label: string; href: string }[] = [
  { id: "billing-sources", label: "Billing sources", href: "/settings" },
  { id: "presets", label: "Presets", href: "/settings/presets" },
  { id: "notifications", label: "Push notifications", href: "/settings/notifications" },
];

export default function SettingsSubNav({
  currentTab,
  initialSecretSources = [],
}: {
  currentTab: TabId;
  initialSecretSources?: SecretAuthSource[];
}) {
  const router = useRouter();
  const currentHref = tabs.find((t) => t.id === currentTab)?.href ?? "/settings";
  const apiKeyActive = initialSecretSources.includes('anthropic-api-key') || initialSecretSources.includes('openrouter-api-key');
  const credentialsActive = initialSecretSources.includes('claude-subscription') || initialSecretSources.includes('chatgpt-subscription');

  function isActive(tabId: TabId) {
    if (tabId === "billing-sources") return apiKeyActive || credentialsActive;
    if (tabId === "presets") return true;
    if (tabId === "notifications") return true;
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
