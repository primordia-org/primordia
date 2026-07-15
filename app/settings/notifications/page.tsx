import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, hasThreadPermission, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { getThreadPrefs } from "@/lib/user-prefs";
import { getSettingsPageData } from "@/app/settings/data";
import { buildPageTitle } from "@/lib/page-title";
import { PageNavBar } from "@/components/PageNavBar";
import SettingsSubNav from "@/components/SettingsSubNav";
import PushNotificationsSettingsClient from "./PushNotificationsSettingsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Push Notifications"),
    description: "Manage account push notification categories.",
  };
}

export default async function PushNotificationsSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/settings/notifications");

  const db = await getDb();
  const [adminCheck, threadPrefs, settingsData, canStartThreads, categoryRows] = await Promise.all([
    isAdmin(user.id),
    getThreadPrefs(user.id),
    getSettingsPageData(user.id),
    hasThreadPermission(user.id),
    db.getWebPushCategorySubscriptions(user.id),
  ]);
  const sessionUser = { id: user.id, username: user.username, isAdmin: adminCheck };

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Account Settings" currentPage="settings" initialSession={sessionUser} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <SettingsSubNav currentTab="notifications" initialSecretSources={settingsData.secretSources} />
        <div className="flex-1 min-w-0">
          <PushNotificationsSettingsClient
            canStartThreads={canStartThreads}
            initialSubscribedCategories={categoryRows.map((row) => row.category)}
          />
        </div>
      </div>
    </main>
  );
}
