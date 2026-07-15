// app/thread/page.tsx — The dedicated "propose a change" page
// Renders the ThreadForm client component. Reads the current git branch at
// request time and passes it as a prop so the NavHeader can display it.

import { execSync } from "child_process";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ThreadForm from "./ThreadForm";
import ForbiddenPage from "@/components/ForbiddenPage";
import { getSessionUser, hasThreadPermission } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getThreadPrefs } from "@/lib/user-prefs";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Start a thread"),
    description: "Propose a change to this app.",
  };
}

function runGit(cmd: string): string | null {
  try {
    return (
      execSync(cmd, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export default async function ThreadCreatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/thread");

  const db = await getDb();
  const [canStartThreads, allRoles, threadPrefs] = await Promise.all([
    hasThreadPermission(user.id),
    db.getAllRoles(),
    getThreadPrefs(user.id),
  ]);

  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";
  const threadRoleName = allRoles.find((r) => r.name === "can_evolve")?.displayName ?? "Threader";

  if (!canStartThreads) {
    return (
      <ForbiddenPage
        pageDescription="This page lets you start a thread by submitting change requests to Claude Code. It creates a live preview of your changes that you can accept or reject."
        requiredConditions={[
          "Be logged in",
          `Have the "${adminRoleName}" role or the "${threadRoleName}" role`,
        ]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" or "${threadRoleName}" role`]}
        howToFix={[
          `Ask a user with the "${adminRoleName}" role to grant you the "${threadRoleName}" role via the Admin page (/admin).`,
        ]}
      />
    );
  }

  const branch = runGit("git branch --show-current");

  return <ThreadForm branch={branch ?? null} initialHarness={threadPrefs.initialHarness} initialModel={threadPrefs.initialModel} initialCavemanMode={threadPrefs.initialCavemanMode} initialCavemanIntensity={threadPrefs.initialCavemanIntensity} />;
}
