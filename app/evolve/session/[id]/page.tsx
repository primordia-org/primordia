// app/evolve/session/[id]/page.tsx
// Dedicated session-tracking page for a single local evolve run.
//
// The server component reads the initial session state from SQLite and passes
// it to the EvolveSessionView client component, which polls for live updates.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { execSync } from "child_process";
import * as fs from "fs";
import { getSessionUser, hasEvolvePermission } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import { readSessionEvents, getSessionNdjsonPath, getCandidateWorktreePath, deriveSessionFromLog, type SessionEvent } from "@/lib/session-events";
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
 * Returns the stored parent branch for a session branch, or null if unknown.
 * Reads the `branch.<name>.parent` git config key that is written when the
 * worktree is created, so no git-graph traversal is required.
 */
function getSessionParentBranch(sessionBranch: string): string | null {
  try {
    return execSync(
      `git config branch.${sessionBranch}.parent`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim() || null;
  } catch {
    return null;
  }
}

export interface DiffFileSummary {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * Returns a per-file diff summary (additions + deletions) for all files
 * changed in the session branch relative to where it diverged from its parent.
 * Uses `git diff --numstat parent...sessionBranch` (three-dot notation) so
 * only commits exclusive to the session branch are counted.
 */
function getGitDiffSummary(sessionBranch: string): DiffFileSummary[] {
  try {
    const parentBranch = execSync(
      `git config branch.${sessionBranch}.parent`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!parentBranch) return [];

    const output = execSync(
      `git diff --numstat -w ${parentBranch}...${sessionBranch}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!output) return [];

    return output.split("\n").flatMap((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return [];
      const file = parts[2].trim();
      if (!file) return [];
      return [{
        additions: parseInt(parts[0], 10) || 0,
        deletions: parseInt(parts[1], 10) || 0,
        file,
      }];
    });
  } catch {
    return [];
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
  let session = await db.getEvolveSession(id);
  if (!session) {
    // The session isn't in the local DB — this can happen when the DB was
    // copied before the session was created (e.g. viewing a parent worktree's
    // session from a child worktree). Try to reconstruct from the NDJSON log.
    session = deriveSessionFromLog(id, getCandidateWorktreePath(id));
    if (!session) notFound();
  }

  const branch = readGitBranch();

  // Read the stored parent branch for this session branch.  Used both to gate
  // accept/reject and to correctly label the upstream-changes message.
  const parentBranch = getSessionParentBranch(session.branch);

  // Only allow accept/reject when the session branch was branched directly off
  // the currently checked-out branch.
  const canAcceptReject = parentBranch !== null && branch !== null && branch === parentBranch;

  const upstreamCommitCount = getUpstreamCommitCount(session.branch);
  const diffSummary = getGitDiffSummary(session.branch);

  // Load initial events from the NDJSON log (new sessions) or fall back to
  // legacy progressText so old sessions still render correctly.
  let initialEvents: SessionEvent[] = [];
  let initialLineCount = 0;
  const ndjsonPath = getSessionNdjsonPath(session.worktreePath);
  if (fs.existsSync(ndjsonPath)) {
    const result = readSessionEvents(ndjsonPath);
    initialEvents = result.events;
    initialLineCount = result.totalLines;
  } else if (session.progressText) {
    initialEvents = [{ type: 'legacy_text', content: session.progressText }];
  }

  return (
    <EvolveSessionView
      sessionId={session.id}
      initialRequest={session.request}
      initialEvents={initialEvents}
      initialLineCount={initialLineCount}
      initialStatus={session.status}
      initialPreviewUrl={session.previewUrl}
      branch={branch}
      parentBranch={parentBranch}
      sessionBranch={session.branch}
      canAcceptReject={canAcceptReject}
      upstreamCommitCount={upstreamCommitCount}
      diffSummary={diffSummary}
      canEvolve={canEvolve}
      isProduction={process.env.NODE_ENV === "production"}
      worktreePath={session.worktreePath}
    />
  );
}
