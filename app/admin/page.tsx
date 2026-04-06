// app/admin/page.tsx — Admin panel for managing user permissions.
// Only accessible to users with the admin role.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import AdminPermissionsClient, { type AdminUser } from "@/components/AdminPermissionsClient";
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
  const evolveRoleName = allRoles.find((r) => r.name === "can_evolve")?.displayName ?? "Evolver";

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription={`This page lets you manage user roles and permissions. You can grant or revoke the "${evolveRoleName}" role to control who can propose changes to the app.`}
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance. It cannot be granted by other users.`,
        ]}
      />
    );
  }

  const [allUsers, adminUsers, evolveUsers] = await Promise.all([
    db.getAllUsers(),
    db.getUsersWithRole("admin"),
    db.getUsersWithRole("can_evolve"),
  ]);

  const adminSet = new Set(adminUsers);
  const evolveSet = new Set(evolveUsers);

  const users: AdminUser[] = allUsers.map((u) => ({
    id: u.id,
    username: u.username,
    isAdmin: adminSet.has(u.id),
    canEvolve: evolveSet.has(u.id),
  }));

  const sessionUser = { id: user.id, username: user.username, isAdmin: true };

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} />
      <AdminSubNav currentTab="users" />

      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3">Evolve permissions</h2>
        <p className="text-sm text-gray-500 mb-4">
          Control which users can access the evolve flow to propose changes to this app.
          The {adminRoleName} always has access.
        </p>
        <AdminPermissionsClient users={users} adminRoleName={adminRoleName} evolveRoleName={evolveRoleName} />
      </section>
    </main>
  );
}
