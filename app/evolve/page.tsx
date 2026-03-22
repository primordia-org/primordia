// app/evolve/page.tsx — The dedicated "propose a change" page
// Renders the EvolveForm client component. Kept as a thin server component
// to follow Next.js App Router conventions.

import type { Metadata } from "next";
import { execSync } from "child_process";
import EvolveForm from "@/components/EvolveForm";

export const metadata: Metadata = {
  title: "Evolve — Primordia",
  description: "Propose a change to this app.",
};

function getCurrentBranch(): string | null {
  try {
    return (
      execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export default function EvolvePage() {
  const currentBranch =
    process.env.VERCEL_GIT_COMMIT_REF ?? getCurrentBranch();
  return <EvolveForm currentBranch={currentBranch ?? null} />;
}
