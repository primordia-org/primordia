import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getThreadPrefs } from "@/lib/user-prefs";
import { getSettingsPageData } from "@/app/settings/data";
import { buildPageTitle } from "@/lib/page-title";
import { PageNavBar } from "@/components/PageNavBar";
import SettingsSubNav from "@/components/SettingsSubNav";
import ApiKeysSettingsClient from "./ApiKeysSettingsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("API Keys"),
    description: "Create and revoke API keys for Primordia clients.",
  };
}

export default async function ApiKeysSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings/api-keys");

  const [adminCheck, threadPrefs, settingsData] = await Promise.all([
    isAdmin(user.id),
    getThreadPrefs(user.id),
    getSettingsPageData(user.id),
  ]);
  const sessionUser = { id: user.id, username: user.username, isAdmin: adminCheck };

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Account Settings" currentPage="settings" initialSession={sessionUser} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <SettingsSubNav currentTab="api-keys" initialSecretSources={settingsData.secretSources} />
        <div className="flex-1 min-w-0">
          <ApiKeysSettingsClient />
        </div>
      </div>
    </main>
  );
}
