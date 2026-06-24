// app/evolve/session/[id]/page.tsx
// Dedicated session-tracking page for a single local evolve run.
//
// The server component reads the initial session state from the filesystem and
// passes it to the EvolveSessionView client component, which polls for live updates.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { execSync } from "child_process";
import * as fs from "fs";
import { getSessionUser, hasEvolvePermission } from "@/lib/auth";
import { getBranchParentSource, getEvolvePrefs } from "@/lib/user-prefs";
import { buildPageTitle } from "@/lib/page-title";
import { readSessionEvents, getSessionNdjsonPath, getSessionFromFilesystem, type SessionEvent } from "@/lib/session-events";
import { getParentBranch, type BranchParentSource } from "@/lib/branch-parent";
import { getWorktreeLogPath } from "@/lib/process-manager";
import { SuspenseLogFile } from "@/components/SuspenseLogFile";
import EvolveSessionView from "./EvolveSessionView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = getSessionFromFilesystem(id, process.cwd());

  return {
    title: buildPageTitle(session?.branch ?? id),
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

export interface DiffFileSummary {
  file: string;
  additions: number;
  deletions: number;
}

function getGitDiffSummary(sessionBranch: string, parentSource: BranchParentSource): DiffFileSummary[] {
  try {
    const parentBranch = getParentBranch(sessionBranch, undefined, parentSource);
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

function getUpstreamCommitCount(sessionBranch: string, parentSource: BranchParentSource): number {
  try {
    const parentBranch = getParentBranch(sessionBranch, undefined, parentSource);
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
  const evolvePrefs = user ? await getEvolvePrefs(user.id) : { initialHarness: undefined, initialModel: undefined, initialCavemanMode: undefined, initialCavemanIntensity: undefined };
  const parentSource = await getBranchParentSource(user?.id);

  const { id } = await params;

  const session = getSessionFromFilesystem(id, process.cwd());
  if (!session) notFound();

  const branch = readGitBranch();

  const parentBranch = getParentBranch(session.branch, undefined, parentSource);

  // Only allow accept/reject when the session branch was branched directly off
  // the currently checked-out branch.
  const canAcceptReject = parentBranch !== null && branch !== null && branch === parentBranch;

  const upstreamCommitCount = getUpstreamCommitCount(session.branch, parentSource);
  const diffSummary = getGitDiffSummary(session.branch, parentSource);

  const serverLogPath = getWorktreeLogPath(session.branch, process.cwd());

  // Load initial events from the NDJSON log.
  let initialEvents: SessionEvent[] = [];
  let initialLineCount = 0;
  const ndjsonPath = getSessionNdjsonPath(session.worktreePath);
  if (fs.existsSync(ndjsonPath)) {
    const result = readSessionEvents(ndjsonPath);
    initialEvents = result.events;
    initialLineCount = result.totalLines;
  }

  return (
    <EvolveSessionView
      sessionId={session.id}
      initialRequest={session.request}
      initialEvents={initialEvents}
      initialLineCount={initialLineCount}
      initialStatus={session.status}
      initialPreviewUrl={session.previewUrl}
      serverLogsNode={<SuspenseLogFile logFilename={serverLogPath} />}
      branch={branch}
      parentBranch={parentBranch}
      sessionBranch={session.branch}
      canAcceptReject={canAcceptReject}
      upstreamCommitCount={upstreamCommitCount}
      diffSummary={diffSummary}
      canEvolve={canEvolve}
      isProduction={process.env.NODE_ENV === "production"}
      worktreePath={session.worktreePath}
      initialHarness={evolvePrefs.initialHarness}
      initialModel={evolvePrefs.initialModel}
      initialCavemanMode={evolvePrefs.initialCavemanMode}
      initialCavemanIntensity={evolvePrefs.initialCavemanIntensity}
    />
  );
}
