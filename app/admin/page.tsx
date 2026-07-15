// app/admin/page.tsx — Admin panel for managing user permissions.
// Only accessible to users with the admin role.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getThreadPrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import AdminPermissionsClient, { type AdminUser } from "./AdminPermissionsClient";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Admin"),
    description: "Manage user permissions.",
  };
}

export default async function AdminPage() {
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
        pageDescription="This page lets admins manage Code Editing Permissions: who can propose and preview code changes to the app."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance. It cannot be granted by other users.`,
        ]}
      />
    );
  }

  const [allUsers, adminUsers, threadUsers] = await Promise.all([
    db.getAllUsers(),
    db.getUsersWithRole("admin"),
    db.getUsersWithRole("can_evolve"),
  ]);

  const adminSet = new Set(adminUsers);
  const threadSet = new Set(threadUsers);

  const users: AdminUser[] = allUsers.map((u) => ({
    id: u.id,
    username: u.username,
    isAdmin: adminSet.has(u.id),
    canStartThreads: threadSet.has(u.id),
  }));

  const [sessionUser, threadPrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getThreadPrefs(user.id),
  ]);

  return (
    <main className="flex flex-col w-full max-w-5xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-8 items-start mt-2">
      <AdminSubNav currentTab="users" />
      <div className="flex-1 min-w-0">
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3">Code Editing Permissions</h2>
        <p className="text-sm text-gray-500 mb-4">
          Control which users can propose and preview code changes to this app.
          The {adminRoleName} always has access.
        </p>
        <AdminPermissionsClient users={users} adminRoleName={adminRoleName} />
      </section>
      </div>
      </div>
    </main>
  );
}
