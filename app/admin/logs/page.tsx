// app/admin/logs/page.tsx — Server logs viewer.
// Streams production server logs in real time.
// Admin only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getThreadPrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import ServerLogsClient from "@/components/ServerLogsClient";
import { getProxyRoutingState, readWorktreeLogLines } from "@/lib/process-manager";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Server Logs"),
    description: "Tail the primordia systemd service journal.",
  };
}

export default async function AdminLogsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const [adminCheck, allRoles] = await Promise.all([
    isAdmin(user.id),
    db.getAllRoles(),
  ]);

  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="This page streams live output from the primordia systemd service journal."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance.`,
        ]}
      />
    );
  }

  const [sessionUser, threadPrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getThreadPrefs(user.id),
  ]);

  // Pre-fetch recent production log lines for a useful first paint even if JS is broken.
  const productionBranch = getProxyRoutingState(process.cwd()).productionBranch;
  const initialLogs = productionBranch
    ? `${readWorktreeLogLines(productionBranch, process.cwd()).slice(-100).join("\n")}\n`
    : "";

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <AdminSubNav currentTab="logs" />
        <div className="flex-1 min-w-0">
          <ServerLogsClient initialOutput={initialLogs} />
        </div>
      </div>
    </main>
  );
}
