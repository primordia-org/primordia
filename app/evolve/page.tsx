// app/evolve/page.tsx — The dedicated "propose a change" page
// Renders the EvolveForm client component. Reads the current git branch at
// request time and passes it as a prop so the NavHeader can display it.

import { execSync } from "child_process";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import EvolveForm from "@/components/EvolveForm";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Evolve — Primordia",
  description: "Propose a change to this app.",
};

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
  if (!user) redirect("/login");

  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ?? runGit("git branch --show-current");

  return <EvolveForm branch={branch ?? null} />;
}
