// app/api/git-context/route.ts
// Returns the current git branch name and the HEAD commit message.
//
// On Vercel deployments, reads the built-in system env vars:
//   VERCEL_GIT_COMMIT_REF     — branch name
//   VERCEL_GIT_COMMIT_MESSAGE — commit subject line
//
// In local dev (and git worktrees), falls back to running git commands.
//
// Response (JSON):
//   { branch: string | null, commitMessage: string | null }

import { execSync } from "child_process";

function runGit(cmd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export async function GET() {
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ??
    runGit("git branch --show-current");

  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE ??
    runGit("git log -1 --pretty=%s");

  return Response.json({ branch, commitMessage });
}
