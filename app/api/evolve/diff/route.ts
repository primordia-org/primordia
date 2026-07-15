// app/api/evolve/diff/route.ts
//
// GET ?threadId=...&file=...
// Returns the raw unified diff for a single file in the session branch vs its parent.
// Uses `git diff parent...sessionBranch -- <file>` (three-dot notation) so only
// commits exclusive to the session branch are included.

import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { getSessionFromFilesystem } from "@/lib/session-events";
import { getSessionUser } from "@/lib/auth";
import { getParentBranch } from "@/lib/branch-parent";
import { getBranchParentSource } from "@/lib/user-prefs";

function getRenamePathsFromDisplayFile(file: string): { oldPath: string; newPath: string } | null {
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

function toWeakEtag(content: string): string {
  const hash = createHash("sha256").update(content).digest("base64url");
  return `W/"diff-${hash}"`;
}

function requestHasMatchingEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").map((value) => value.trim()).includes(etag);
}

/**
 * Get raw diff for a single file
 * @description Returns the unified diff for one file in the thread vs its parent. Pass `threadId` (thread id) and `file` (relative path) as query parameters.
 * @tag Evolve
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("threadId");
  const file = searchParams.get("file");

  if (!sessionId || !file) {
    return NextResponse.json({ error: "thread id and file are required" }, { status: 400 });
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
      return NextResponse.json({ error: "No parent thread found" }, { status: 404 });
    }

    const renamePaths = getRenamePathsFromDisplayFile(file);
    const diffPath = searchParams.get("diffPath") ?? renamePaths?.newPath ?? file;
    const oldPath = searchParams.get("oldPath") ?? renamePaths?.oldPath;
    const pathspecs = oldPath && oldPath !== diffPath ? [oldPath, diffPath] : [diffPath];
    const diff = execFileSync(
      "git",
      ["diff", "-M", "-w", `${parentBranch}...${session.branch}`, "--", ...pathspecs],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 4 },
    );
    const etag = toWeakEtag(diff);

    if (requestHasMatchingEtag(req.headers.get("if-none-match"), etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "no-cache",
        },
      });
    }

    return new NextResponse(diff, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        ETag: etag,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute diff" }, { status: 500 });
  }
}
