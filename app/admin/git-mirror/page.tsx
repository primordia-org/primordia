// app/admin/git-mirror/page.tsx — Git Mirror admin panel.
// Shows the current mirror remote status and provides instructions for adding a
// mirror remote so that new production deploys are automatically pushed to it.
// Admin-only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { execFileSync } from "child_process";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import GitMirrorClient from "@/components/GitMirrorClient";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Git Mirror"),
    description: "Configure a git mirror remote for automatic production pushes.",
  };
}

/** Read the URL of the remote named "mirror", or null if it doesn't exist. */
function getMirrorRemoteUrl(): string | null {
  try {
    const url = execFileSync(
      "git",
      ["remote", "get-url", "mirror"],
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
    return url || null;
  } catch {
    return null;
  }
}

export default async function AdminGitMirrorPage() {
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
        pageDescription="This page lets you configure a git mirror remote so that every production deploy is automatically pushed to an external git host."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically held by the first user who registered on this Primordia instance. It cannot be granted by other users.`,
        ]}
      />
    );
  }

  const mirrorUrl = getMirrorRemoteUrl();
  const [sessionUser, evolvePrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getEvolvePrefs(user.id),
  ]);

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar subtitle="Admin" currentPage="admin" initialSession={sessionUser} initialHarness={evolvePrefs.initialHarness} initialModel={evolvePrefs.initialModel} initialCavemanMode={evolvePrefs.initialCavemanMode} initialCavemanIntensity={evolvePrefs.initialCavemanIntensity} />
      <AdminSubNav currentTab="git-mirror" />
      <GitMirrorClient mirrorUrl={mirrorUrl} />
    </main>
  );
}
