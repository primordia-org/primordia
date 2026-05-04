// app/api/admin/updates/has-updates/route.ts
// Lightweight check: does any configured update source have new commits?
// Returns { hasUpdates: boolean }
// Admin-only.

import { execFileSync } from "child_process";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { readSources } from "@/lib/update-sources";

function gitSafe(args: string[], cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { stdout, code: 0 };
  } catch {
    return { stdout: "", code: 1 };
  }
}

function branchExists(name: string, cwd: string): boolean {
  return gitSafe(["branch", "--list", name], cwd).stdout.trim().length > 0;
}

function getMergeBase(ref1: string, ref2: string, cwd: string): string | null {
  const r = gitSafe(["merge-base", ref1, ref2], cwd);
  return r.code === 0 && r.stdout ? r.stdout.trim() : null;
}

function getAheadCount(mergeBase: string, tipRef: string, cwd: string): number {
  const r = gitSafe(["rev-list", "--count", `${mergeBase}..${tipRef}`], cwd);
  return r.code === 0 ? parseInt(r.stdout.trim() || "0", 10) : 0;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const cwd = process.cwd();
    const sources = readSources(cwd);

    const hasUpdates = sources.some((source) => {
      if (!branchExists(source.trackingBranch, cwd)) return false;
      const mergeBase = getMergeBase("main", source.trackingBranch, cwd);
      if (!mergeBase) return false;
      return getAheadCount(mergeBase, source.trackingBranch, cwd) > 0;
    });

    return Response.json({ hasUpdates });
  } catch {
    return Response.json({ hasUpdates: false });
  }
}
