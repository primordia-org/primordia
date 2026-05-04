// app/api/evolve/diff-summary/route.ts
//
// GET ?sessionId=...
// Returns per-file diff summary (additions + deletions) for all files changed
// in the session branch vs its parent. Uses `git diff --numstat -w parent...branch`
// (three-dot notation) so only commits exclusive to the session branch are counted.

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getSessionFromFilesystem } from "@/lib/session-events";
import type { DiffFileSummary } from "@/app/evolve/session/[id]/page";

/**
 * Get diff summary for a session
 * @description Returns per-file additions/deletions for all files changed in the session branch vs its parent. Pass `sessionId` as a query parameter.
 * @tag Evolve
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = getSessionFromFilesystem(sessionId, process.cwd());
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const parentBranch = execSync(
      `git config branch.${session.branch}.parent`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!parentBranch) {
      return NextResponse.json({ files: [] });
    }

    const output = execSync(
      `git diff --numstat -w ${parentBranch}...${session.branch}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!output) {
      return NextResponse.json({ files: [] });
    }

    const files: DiffFileSummary[] = output.split("\n").flatMap((line) => {
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

    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ files: [] });
  }
}
