// app/api/evolve/diff-summary/route.ts
//
// GET ?threadId=...
// Returns per-file diff summary (additions + deletions) for all files changed
// in the session branch vs its parent. Uses `git diff --numstat -w parent...branch`
// (three-dot notation) so only commits exclusive to the session branch are counted.

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getSessionFromFilesystem } from "@/lib/session-events";
import type { DiffFileSummary } from "@/app/thread/[id]/page";
import { getSessionUser } from "@/lib/auth";
import { getParentBranch } from "@/lib/branch-parent";
import { getBranchParentSource } from "@/lib/user-prefs";

function getRenamePathsFromNumstatFile(file: string): { oldPath: string; newPath: string } | null {
  if (!file.includes(" => ")) return null;

  const oldPath = file.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, "$1");
  const newPath = file.replace(/\{([^{}]*?) => ([^{}]*?)\}/g, "$2");
  if (oldPath !== file || newPath !== file) return { oldPath, newPath };

  const separator = file.lastIndexOf(" => ");
  return {
    oldPath: file.slice(0, separator).trim(),
    newPath: file.slice(separator + " => ".length).trim(),
  };
}

/**
 * Get diff summary for a thread
 * @description Returns per-file additions/deletions for all files changed in the thread vs its parent. Pass `threadId` as the thread id query parameter.
 * @tag Evolve
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("threadId");

  if (!sessionId) {
    return NextResponse.json({ error: "thread id is required" }, { status: 400 });
  }

  const session = getSessionFromFilesystem(sessionId, process.cwd());
  if (!session) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  try {
    const user = await getSessionUser();
    const parentSource = await getBranchParentSource(user?.id);
    const parentBranch = getParentBranch(session.branch, undefined, parentSource);

    if (!parentBranch) {
      return NextResponse.json({ files: [] }, { headers: { "Cache-Control": "no-cache" } });
    }

    const output = execSync(
      `git diff --numstat -M -w ${parentBranch}...${session.branch}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!output) {
      return NextResponse.json({ files: [] }, { headers: { "Cache-Control": "no-cache" } });
    }

    const files: DiffFileSummary[] = output.split("\n").flatMap((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return [];
      const file = parts[2].trim();
      if (!file) return [];
      const renamePaths = getRenamePathsFromNumstatFile(file);
      return [{
        additions: parseInt(parts[0], 10) || 0,
        deletions: parseInt(parts[1], 10) || 0,
        file,
        ...(renamePaths ? { diffPath: renamePaths.newPath, oldPath: renamePaths.oldPath } : {}),
      }];
    });

    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-cache" } });
  } catch {
    return NextResponse.json({ files: [] }, { headers: { "Cache-Control": "no-cache" } });
  }
}
