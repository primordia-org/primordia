// app/api/evolve/diff/route.ts
//
// GET ?sessionId=...&file=...
// Returns the raw unified diff for a single file in the session branch vs its parent.
// Uses `git diff parent...sessionBranch -- <file>` (three-dot notation) so only
// commits exclusive to the session branch are included.

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { getSessionFromFilesystem } from "@/lib/session-events";

/**
 * Get raw diff for a single file
 * @description Returns the unified diff for one file in the session branch vs its parent. Pass `sessionId` and `file` (relative path) as query parameters.
 * @tag Evolve
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const file = searchParams.get("file");

  if (!sessionId || !file) {
    return NextResponse.json({ error: "sessionId and file are required" }, { status: 400 });
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
      return NextResponse.json({ error: "No parent branch found" }, { status: 404 });
    }

    const diff = execSync(
      `git diff -w ${parentBranch}...${session.branch} -- ${JSON.stringify(file)}`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 4 },
    );

    return new NextResponse(diff, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute diff" }, { status: 500 });
  }
}
