// components/SettingsSubNav.tsx
// Account Settings section navigation.
// Large screens: vertical sidebar with live status indicators.
// Mobile: <select> dropdown that navigates on change.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SecretType } from "@/lib/secret-types";

type TabId = "billing-sources" | "presets";

const tabs: { id: TabId; label: string; href: string }[] = [
  { id: "billing-sources", label: "Billing sources", href: "/settings" },
  { id: "presets", label: "Presets", href: "/settings/presets" },
];

export default function SettingsSubNav({
  currentTab,
  initialSecretTypes = [],
}: {
  currentTab: TabId;
  initialSecretTypes?: SecretType[];
}) {
  const router = useRouter();
  const currentHref = tabs.find((t) => t.id === currentTab)?.href ?? "/settings";
  const apiKeyActive = initialSecretTypes.includes('ANTHROPIC_API_KEY') || initialSecretTypes.includes('OPENROUTER_API_KEY');
  const credentialsActive = initialSecretTypes.includes('CLAUDE_CODE_CREDENTIALS_JSON') || initialSecretTypes.includes('CHATGPT_SUBSCRIPTION_OAUTH');

  function isActive(tabId: TabId) {
    if (tabId === "billing-sources") return apiKeyActive || credentialsActive;
    if (tabId === "presets") return true;
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
