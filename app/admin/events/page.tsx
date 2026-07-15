// app/admin/events/page.tsx — admin event log viewer page

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getThreadPrefs } from "@/lib/user-prefs";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import EventsClient from "./EventsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Events"),
    description: "View the user event log.",
  };
}

export default async function AdminEventsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const admin = await isAdmin(user.id);
  if (!admin) {
    return (
      <ForbiddenPage
        pageDescription="This page shows a live log of all user events tracked by the app."
        requiredConditions={["Be logged in", "Have the admin (Prime) role"]}
        metConditions={["You are logged in"]}
        unmetConditions={["You don't have the admin role"]}
        howToFix={["The admin role is automatically granted to the first registered user and cannot be granted via the UI."]}
      />
    );
  }

  const threadPrefs = await getThreadPrefs(user.id);

  return (
    <main className="flex flex-col w-full max-w-7xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar
        subtitle="Admin"
        currentPage="admin"
        initialSession={{ id: user.id, username: user.username, isAdmin: true }}
        initialHarness={threadPrefs.initialHarness}
        initialModel={threadPrefs.initialModel}
        initialCavemanMode={threadPrefs.initialCavemanMode}
        initialCavemanIntensity={threadPrefs.initialCavemanIntensity}
      />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <AdminSubNav currentTab="events" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-medium text-gray-200 mb-1">Event log</h2>
          <p className="text-sm text-gray-500 mb-4">
            All user events recorded by the app. Click a row to expand its props. Newest first.
          </p>
          <EventsClient />
        </div>
      </div>
    </main>
  );
}
