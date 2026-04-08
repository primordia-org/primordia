// app/evolve/session/[id]/page.tsx
// Dedicated session-tracking page for a single local evolve run.
//
// The server component reads the initial session state from SQLite and passes
// it to the EvolveSessionView client component, which polls for live updates.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { execSync } from "child_process";
import { getSessionUser, hasEvolvePermission } from "@/lib/auth";
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

/**
 * Returns the number of commits on the parent branch that are not yet in
 * the session branch (i.e. how far ahead the parent is).
 */
function getUpstreamCommitCount(sessionBranch: string): number {
  try {
    const parentBranch = execSync(
      `git config branch.${sessionBranch}.parent`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!parentBranch) return 0;
    const count = execSync(
      `git rev-list ${sessionBranch}..${parentBranch} --count`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

export default async function EvolveSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  const canEvolve = user ? await hasEvolvePermission(user.id) : false;

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

  const upstreamCommitCount = getUpstreamCommitCount(session.branch);

  return (
    <EvolveSessionView
      sessionId={session.id}
      initialRequest={session.request}
      initialProgressText={session.progressText}
      initialStatus={session.status}
      initialPreviewUrl={session.previewUrl}
      branch={branch}
      sessionBranch={session.branch}
      canAcceptReject={canAcceptReject}
      upstreamCommitCount={upstreamCommitCount}
      canEvolve={canEvolve}
      isProduction={process.env.NODE_ENV === "production"}
    />
  );
}
