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
import { inferDevServerStatus } from "@/lib/local-evolve-sessions";

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
 * Returns true if `sessionBranch` was branched directly off `currentBranch`.
 * Reads the `branch.<name>.parent` git config key that is written when the
 * worktree is created, so no git-graph traversal is required.
 */
function isSessionBranchChildOfCurrent(
  currentBranch: string,
  sessionBranch: string,
): boolean {
  try {
    const parent = execSync(
      `git config branch.${sessionBranch}.parent`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return parent === currentBranch;
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

  // Only allow accept/reject when the session branch was branched directly off
  // the currently checked-out branch. Checked via `git config branch.<name>.parent`
  // which is written at worktree-creation time.
  const canAcceptReject =
    branch !== null
      ? isSessionBranchChildOfCurrent(branch, session.branch)
      : false;

  return (
    <EvolveSessionView
      sessionId={session.id}
      initialRequest={session.request}
      initialProgressText={session.progressText}
      initialStatus={session.status}
      initialDevServerStatus={inferDevServerStatus(session.id, session.port)}
      initialPreviewUrl={session.previewUrl}
      branch={branch}
      sessionBranch={session.branch}
      canAcceptReject={canAcceptReject}
    />
  );
}
