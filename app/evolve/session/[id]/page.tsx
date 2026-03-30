// app/evolve/session/[id]/page.tsx
// Dedicated session-tracking page for a single local evolve run.
//
// The server component reads the initial session state from SQLite and passes
// it to the EvolveSessionView client component, which polls for live updates.

import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { execSync } from "child_process";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import EvolveSessionView from "@/components/EvolveSessionView";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Evolve Session"),
    description: "Live progress for an evolve session.",
  };
}

function readGitBranch(): string | null {
  try {
    return (
      execSync("git branch --show-current", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Returns true if `sessionBranch` is a descendant of `currentBranch`,
 * i.e. `currentBranch` is an ancestor of `sessionBranch`.
 * Uses `git merge-base --is-ancestor` which exits 0 when true, 1 when false.
 */
function isSessionBranchDescendantOfCurrent(
  currentBranch: string,
  sessionBranch: string,
): boolean {
  try {
    execSync(
      `git merge-base --is-ancestor ${JSON.stringify(currentBranch)} ${JSON.stringify(sessionBranch)}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
}

export default async function EvolveSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const db = await getDb();
  const session = await db.getEvolveSession(id);
  if (!session) notFound();

  const branch = readGitBranch();

  // Only allow accept/reject when the session branch is a descendant of the
  // currently checked-out branch. If the current branch has moved ahead or is
  // unrelated, merging would go to the wrong place, so we hide those buttons.
  const canAcceptReject =
    branch !== null
      ? isSessionBranchDescendantOfCurrent(branch, session.branch)
      : false;

  return (
    <EvolveSessionView
      sessionId={session.id}
      initialRequest={session.request}
      initialProgressText={session.progressText}
      initialStatus={session.status}
      initialPreviewUrl={session.previewUrl}
      branch={branch}
      canAcceptReject={canAcceptReject}
    />
  );
}
