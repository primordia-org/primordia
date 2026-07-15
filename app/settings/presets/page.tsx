import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getThreadPrefs } from "@/lib/user-prefs";
import { getPresetsSettingsPageData } from "./data";
import { buildPageTitle } from "@/lib/page-title";
import { PageNavBar } from "@/components/PageNavBar";
import SettingsSubNav from "@/components/SettingsSubNav";
import PresetsSettingsClient from "./PresetsSettingsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Preset Settings"),
    description: "Manage thread presets.",
  };
}

export default async function PresetsSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings/presets");

  const [adminCheck, threadPrefs, presetsData] = await Promise.all([
    isAdmin(user.id),
    getThreadPrefs(user.id),
    getPresetsSettingsPageData(user.id),
  ]);
  const sessionUser = { id: user.id, username: user.username, isAdmin: adminCheck };

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Account Settings" currentPage="settings" initialSession={sessionUser} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <SettingsSubNav currentTab="presets" initialSecretSources={presetsData.secretSources} />
        <div className="flex-1 min-w-0">
          <PresetsSettingsClient initialData={presetsData} />
        </div>
      </div>
    </main>
  );
}
