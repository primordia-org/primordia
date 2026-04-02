// app/admin/page.tsx — Admin panel for managing user permissions.
// Only accessible to the first (owner) user. Others are redirected.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import AdminPermissionsClient, { type AdminUser } from "@/components/AdminPermissionsClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Admin"),
    description: "Manage user permissions.",
  };
}

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  if (!(await isAdmin(user.id))) redirect("/chat");

  const db = await getDb();
  const [allUsers, firstUser, evolveUsers] = await Promise.all([
    db.getAllUsers(),
    db.getFirstUser(),
    db.getUsersWithPermission("can_evolve"),
  ]);

  const evolveSet = new Set(evolveUsers);

  const users: AdminUser[] = allUsers.map((u) => ({
    id: u.id,
    username: u.username,
    isAdmin: u.id === firstUser?.id,
    canEvolve: evolveSet.has(u.id),
  }));

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-100">Admin</h1>
          <a
            href="/chat"
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            ← Back to chat
          </a>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Logged in as <span className="text-gray-300 font-mono">{user.username}</span> (owner)
        </p>
      </header>

      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3">Evolve permissions</h2>
        <p className="text-sm text-gray-500 mb-4">
          Control which users can access the evolve flow to propose changes to this app.
          The owner always has access.
        </p>
        <AdminPermissionsClient users={users} />
      </section>
    </main>
  );
}
