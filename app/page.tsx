// app/page.tsx — The main entry point for Primordia
// This is a React Server Component. It reads the current git branch, full
// HEAD commit message, and preview instance info at request time (no
// client-side fetches needed), then passes them as props to the ChatInterface
// client component.
//
// On Vercel deployments, built-in env vars are used:
//   VERCEL_GIT_COMMIT_REF     — branch name
//   VERCEL_GIT_COMMIT_MESSAGE — full commit message
//
// In local dev and git worktrees, falls back to running git commands directly.
//
// Preview instance detection: reads `branch.<name>.parent` from git config.
// This is set by the parent server when it spawns the preview worktree and
// persists across server restarts, making it a reliable signal without needing
// an API call from the client.

import { execSync } from "child_process";
import ChatInterface from "@/components/ChatInterface";

function runGit(cmd: string): string | null {
  try {
    return (
      execSync(cmd, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

export default function Home() {
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ?? runGit("git branch --show-current");

  // Use %B to get the full commit message (subject + body), not just the subject line.
  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE ??
    runGit("git log -1 --pretty=%B");

  // Detect whether this is a local preview worktree by checking for a stored
  // parent branch in git config (set by the parent server on worktree creation).
  // This avoids a client-side GET /api/evolve/local/manage fetch on every mount.
  const currentBranch = runGit("git rev-parse --abbrev-ref HEAD");
  const parentBranch = currentBranch
    ? runGit(`git config branch.${currentBranch}.parent`)
    : null;
  const isPreviewInstance = !!parentBranch;
  const previewParentBranch = parentBranch ?? "main";

  return (
    <ChatInterface
      branch={branch ?? null}
      commitMessage={commitMessage ?? null}
      isPreviewInstance={isPreviewInstance}
      previewParentBranch={previewParentBranch}
    />
  );
}
