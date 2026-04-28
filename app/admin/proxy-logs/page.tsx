// app/admin/proxy-logs/page.tsx — Proxy logs viewer.
// Tails the primordia-proxy systemd service journal in real time.
// Admin only.

import type { Metadata } from "next";
import { spawnSync } from "child_process";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import ServerLogsClient from "@/components/ServerLogsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Proxy Logs"),
    description: "Tail the primordia-proxy systemd service journal.",
  };
}

export default async function AdminProxyLogsPage() {
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
        pageDescription="This page streams live output from the primordia-proxy systemd service journal."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance.`,
        ]}
      />
    );
  }

  const [sessionUser, evolvePrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getEvolvePrefs(user.id),
  ]);

  // Fetch the first batch of log lines server-side so the page is readable
  // even when client-side JavaScript hasn't connected yet (e.g. broken HMR).
  // journalctl is only available on Linux (systemd); skip on other platforms.
  const initialLogs =
    process.platform === "linux"
      ? spawnSync("journalctl", ["-u", "primordia-proxy", "-n", "100", "--no-pager"], {
          encoding: "utf8",
        }).stdout ?? ""
      : "";

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} initialHarness={evolvePrefs.initialHarness} initialModel={evolvePrefs.initialModel} initialCavemanMode={evolvePrefs.initialCavemanMode} initialCavemanIntensity={evolvePrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <AdminSubNav currentTab="proxy-logs" />
        <div className="flex-1 min-w-0">
          <ServerLogsClient apiPath="/api/admin/proxy-logs" initialOutput={initialLogs} />
        </div>
      </div>
    </main>
  );
}
