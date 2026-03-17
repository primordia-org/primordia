// app/api/evolve/local/manage/route.ts
// Accept or reject a local evolve session (development only).
//
// This route runs inside the *preview* Next.js instance (the child worktree
// server). It discovers its own branch name and parent branch from git config,
// performs the merge / cleanup in the parent repo, then exits the process.
//
// GET
//   Returns { isPreview: boolean, branch: string | null } based on whether the
//   PREVIEW_BRANCH environment variable is set (injected by the parent server
//   when it spawns the preview dev process).
//
// POST
//   Body: { action: "accept" | "reject" }
//
//   accept — merges the preview branch into the parent branch (read from
//            git config branch.<branch>.parent), removes the worktree and
//            branch, then exits this server process.
//   reject — removes the worktree and branch without merging, then exits.

import * as path from 'path';
import { runGit } from '../../../../../lib/local-evolve-sessions';

// GET — used by the UI on mount to detect whether this is a preview instance.
export async function GET() {
  const branch = process.env.PREVIEW_BRANCH ?? null;
  return Response.json({ isPreview: !!branch, branch });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const branch = process.env.PREVIEW_BRANCH;
  if (!branch) {
    return Response.json(
      { error: 'Not a preview instance (PREVIEW_BRANCH is not set)' },
      { status: 400 },
    );
  }

  const body = (await request.json()) as { action?: string };
  if (body.action !== 'accept' && body.action !== 'reject') {
    return Response.json(
      { error: 'action must be "accept" or "reject"' },
      { status: 400 },
    );
  }

  // The preview server's CWD is the worktree directory.
  const worktreePath = process.cwd();

  // Locate the parent (main) repo root via the shared git common directory.
  // In a linked worktree, --git-common-dir returns the absolute path of the
  // main .git folder; path.dirname of that is the main repo root.
  const commonDirResult = await runGit(['rev-parse', '--git-common-dir'], worktreePath);
  if (commonDirResult.code !== 0) {
    return Response.json(
      { error: `Could not locate parent repo: ${commonDirResult.stderr}` },
      { status: 500 },
    );
  }
  const gitCommonDir = path.resolve(worktreePath, commonDirResult.stdout.trim());
  const parentRepoRoot = path.dirname(gitCommonDir);

  // Look up the parent branch stored by the parent server on worktree creation.
  const parentBranchResult = await runGit(
    ['config', `branch.${branch}.parent`],
    worktreePath,
  );
  if (parentBranchResult.code !== 0) {
    return Response.json(
      { error: `Parent branch not found in git config for branch "${branch}"` },
      { status: 500 },
    );
  }
  const parentBranch = parentBranchResult.stdout.trim();

  try {
    if (body.action === 'accept') {
      // Merge the preview branch into the parent branch (in the main repo).
      const mergeResult = await runGit(
        ['merge', branch, '--no-ff', '-m', `chore: merge local preview ${branch}`],
        parentRepoRoot,
      );
      if (mergeResult.code !== 0) {
        return Response.json(
          { error: `git merge failed:\n${mergeResult.stderr}` },
          { status: 500 },
        );
      }

      // Remove this worktree and delete the preview branch.
      await runGit(['worktree', 'remove', '--force', worktreePath], parentRepoRoot);
      await runGit(['branch', '-d', branch], parentRepoRoot);

      // Shut down the preview server shortly after sending the response.
      setTimeout(() => process.exit(0), 500);
      return Response.json({ outcome: 'accepted', branch, parentBranch });
    }

    // action === 'reject'
    await runGit(['worktree', 'remove', '--force', worktreePath], parentRepoRoot);
    // Force-delete since the branch was never merged.
    await runGit(['branch', '-D', branch], parentRepoRoot);

    setTimeout(() => process.exit(0), 500);
    return Response.json({ outcome: 'rejected' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
