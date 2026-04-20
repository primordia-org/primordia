// app/evolve/page.tsx — The dedicated "propose a change" page
// Renders the EvolveForm client component. Reads the current git branch at
// request time and passes it as a prop so the NavHeader can display it.

import { execSync } from "child_process";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import EvolveForm from "./EvolveForm";
import ForbiddenPage from "@/components/ForbiddenPage";
import { getSessionUser, hasEvolvePermission } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Evolve"),
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

export default async function EvolvePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/evolve");

  const db = await getDb();
  const [canEvolve, allRoles, evolvePrefs] = await Promise.all([
    hasEvolvePermission(user.id),
    db.getAllRoles(),
    getEvolvePrefs(user.id),
  ]);

  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";
  const evolveRoleName = allRoles.find((r) => r.name === "can_evolve")?.displayName ?? "Evolver";

  if (!canEvolve) {
    return (
      <ForbiddenPage
        pageDescription="This page lets you evolve the app by submitting change requests to Claude Code. It creates a live preview of your changes that you can accept or reject."
        requiredConditions={[
          "Be logged in",
          `Have the "${adminRoleName}" role or the "${evolveRoleName}" role`,
        ]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" or "${evolveRoleName}" role`]}
        howToFix={[
          `Ask a user with the "${adminRoleName}" role to grant you the "${evolveRoleName}" role via the Admin page (/admin).`,
        ]}
      />
    );
  }

  const branch = runGit("git branch --show-current");

  return <EvolveForm branch={branch ?? null} initialHarness={evolvePrefs.initialHarness} initialModel={evolvePrefs.initialModel} initialCavemanMode={evolvePrefs.initialCavemanMode} initialCavemanIntensity={evolvePrefs.initialCavemanIntensity} />;
}
