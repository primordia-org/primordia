// app/admin/rollback/page.tsx — Deep rollback admin panel.
// Lists previous production slots from the PROD git reflog and lets the admin roll back to any of them.
// Admin-only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import AdminRollbackClient from "@/components/AdminRollbackClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Rollback"),
    description: "Roll back production to a previous slot.",
  };
}

export default async function AdminRollbackPage() {
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
        pageDescription="This page lets you roll back production to any previous version using the PROD git reflog."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance. It cannot be granted by other users.`,
        ]}
      />
    );
  }

  const sessionUser = { id: user.id, username: user.username, isAdmin: true };

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} />
      <AdminSubNav currentTab="rollback" />
      <AdminRollbackClient />
    </main>
  );
}
