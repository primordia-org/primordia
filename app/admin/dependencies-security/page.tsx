// app/admin/dependencies-security/page.tsx
// Admin dependency security page showing `bun audit` output.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import { runBunAudit, writeDependencyAuditNotification } from "@/lib/dependency-audit";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import DependenciesSecurityClient from "./DependenciesSecurityClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Dependency Security"),
    description: "Review bun audit output and create sessions to fix vulnerable packages.",
  };
}

export default async function DependenciesSecurityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const [adminCheck, allRoles] = await Promise.all([isAdmin(user.id), db.getAllRoles()]);
  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="This page lets admins review dependency security findings from bun audit and start an evolve session to update vulnerable packages."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[`The "${adminRoleName}" role is automatically granted to the first user who registered. It cannot be granted via the API.`]}
      />
    );
  }

  const audit = runBunAudit();
  writeDependencyAuditNotification(process.cwd(), audit);
  const evolvePrefs = await getEvolvePrefs(user.id);
  const sessionUser = { id: user.id, username: user.username, isAdmin: true };

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar
        subtitle="Admin"
        currentPage="admin"
        initialSession={sessionUser}
        initialHarness={evolvePrefs.initialHarness}
        initialModel={evolvePrefs.initialModel}
        initialCavemanMode={evolvePrefs.initialCavemanMode}
        initialCavemanIntensity={evolvePrefs.initialCavemanIntensity}
      />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
        <AdminSubNav currentTab="dependencies-security" />
        <div className="flex-1 min-w-0">
          <DependenciesSecurityClient initialAudit={audit} />
        </div>
      </div>
    </main>
  );
}
