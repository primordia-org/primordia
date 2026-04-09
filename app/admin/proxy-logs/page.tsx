// app/admin/proxy-logs/page.tsx — Proxy logs viewer.
// Tails the primordia-proxy systemd service journal in real time.
// Admin only.

import type { Metadata } from "next";
import { spawnSync } from "child_process";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
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

  const sessionUser = { id: user.id, username: user.username, isAdmin: true };

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
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} />
      <AdminSubNav currentTab="proxy-logs" />
      <ServerLogsClient apiPath="/api/admin/proxy-logs" initialOutput={initialLogs} />
    </main>
  );
}
