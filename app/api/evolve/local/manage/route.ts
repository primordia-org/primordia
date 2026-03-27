// app/api/evolve/local/manage/route.ts
// Accept or reject a local evolve session (development only).
//
// This route runs inside the *preview* Next.js instance (the child worktree
// server). It discovers its own branch name from git and the parent branch
// from git config, performs the merge / cleanup in the parent repo, then
// exits the process.
//
// GET
//   Returns { isPreview: boolean, branch: string | null }.
//   Detects a preview instance by reading the current branch via git and
//   checking whether git config branch.<name>.parent is set. This is
//   persistent across server restarts and manual dev server invocations.
//
// POST
//   Body: { action: "accept" | "reject" }
//
//   accept — merges the preview branch into the parent branch (read from
//            git config branch.<branch>.parent), removes the worktree and
//            branch, then exits this server process.
//   reject — removes the worktree and branch without merging, then exits.

import * as path from 'path';
import { runGit, resolveConflictsWithClaude } from '../../../../../lib/local-evolve-sessions';
import { getSessionUser } from '../../../../../lib/auth';

/** Read the current git branch and check for a stored parent config entry.
 *  Returns { branch, parentBranch } when this is a preview worktree,
 *  or { branch: null, parentBranch: null } otherwise. */
async function getPreviewInfo(
  cwd: string,
): Promise<{ branch: string | null; parentBranch: string | null }> {
  const branchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (branchResult.code !== 0) return { branch: null, parentBranch: null };

  const branch = branchResult.stdout.trim();
  const parentResult = await runGit(['config', `branch.${branch}.parent`], cwd);
  if (parentResult.code !== 0 || !parentResult.stdout.trim()) {
    return { branch: null, parentBranch: null };
  }

  return { branch, parentBranch: parentResult.stdout.trim() };
}

// GET — used by the UI on mount to detect whether this is a preview instance.
export async function GET() {
  const { branch, parentBranch } = await getPreviewInfo(process.cwd());
  return Response.json({ isPreview: !!branch, branch, parentBranch });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const worktreePath = process.cwd();
  const { branch, parentBranch } = await getPreviewInfo(worktreePath);

  if (!branch) {
    return Response.json(
      { error: 'Not a preview instance (no branch.*.parent entry found in git config)' },
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

  try {
    if (body.action === 'accept') {
      // Checkout the parent branch first so the merge lands on the right branch,
      // not on whatever happens to be checked out in the main repo.
      // If the parent branch is already checked out in another worktree (e.g. a
      // prior evolve session), git refuses the checkout. In that case we parse
      // the worktree path from the error message and run the merge there instead.
      const checkoutResult = await runGit(['checkout', parentBranch!], parentRepoRoot);
      let mergeRoot = parentRepoRoot;
      if (checkoutResult.code !== 0) {
        const alreadyCheckedOutMatch = checkoutResult.stderr.match(
          /(?:already checked out at|already used by worktree at) '([^']+)'/,
        );
        if (alreadyCheckedOutMatch) {
          // Parent branch lives in a different worktree — merge from there.
          mergeRoot = alreadyCheckedOutMatch[1];
        } else {
          return Response.json(
            { error: `git checkout ${parentBranch} failed:\n${checkoutResult.stderr}` },
            { status: 500 },
          );
        }
      }

      // Stash any uncommitted local changes in mergeRoot so they don't block
      // the merge. Git refuses to merge when tracked files would be overwritten.
      let stashed = false;
      const statusResult = await runGit(['status', '--porcelain'], mergeRoot);
      if (statusResult.stdout.trim()) {
        const stashResult = await runGit(
          ['stash', 'push', '-u', '-m', 'primordia-auto-stash-before-merge'],
          mergeRoot,
        );
        // Only treat as stashed if git actually created a stash entry
        stashed = stashResult.code === 0 && !stashResult.stdout.includes('No local changes');
      }

      // Merge the preview branch into the parent branch (in the appropriate worktree).
      const mergeResult = await runGit(
        ['merge', branch, '--no-ff', '-m', `chore: merge ${branch}`],
        mergeRoot,
      );

      // If the merge failed, restore any stash and surface the error.
      if (mergeResult.code !== 0) {
        // Attempt automatic conflict resolution via Claude Code before giving up.
        const resolution = await resolveConflictsWithClaude(mergeRoot, branch!, parentBranch!);
        if (!resolution.success) {
          // Restore a clean state so the user can retry or investigate manually.
          await runGit(['merge', '--abort'], mergeRoot);
          if (stashed) {
            await runGit(['stash', 'pop'], mergeRoot);
          }
          return Response.json(
            {
              error:
                `git merge failed and automatic conflict resolution also failed.\n\n` +
                `Merge error:\n${mergeResult.stderr}\n\n` +
                `Auto-resolution log:\n${resolution.log}`,
            },
            { status: 500 },
          );
        }
        // Claude successfully resolved the conflicts and committed — fall through to cleanup.
      }

      // Restore stashed changes on top of the merge result.
      let stashWarning: string | undefined;
      if (stashed) {
        const popResult = await runGit(['stash', 'pop'], mergeRoot);
        if (popResult.code !== 0) {
          // Stash pop conflicted — not fatal, but worth surfacing to the user.
          stashWarning =
            `Merge succeeded but restoring your stashed changes produced a conflict. ` +
            `Run \`git stash pop\` manually to resolve:\n${popResult.stderr}`;
        }
      }

      // Remove this worktree, delete the preview branch, and scrub any git
      // config entries that were written for it (e.g. branch.<name>.parent).
      // We run worktree remove first so git no longer considers the branch
      // "checked out", which allows branch -d to succeed.
      await runGit(['worktree', 'remove', '--force', worktreePath], parentRepoRoot);
      await runGit(['branch', '-d', branch], parentRepoRoot);
      // --remove-section exits with code 1 when the section is absent — ignore.
      await runGit(['config', '--remove-section', `branch.${branch}`], parentRepoRoot);

      // Shut down the preview server shortly after sending the response.
      setTimeout(() => process.exit(0), 500);
      return Response.json({ outcome: 'accepted', branch, parentBranch, stashWarning });
    }

    // action === 'reject'
    await runGit(['worktree', 'remove', '--force', worktreePath], parentRepoRoot);
    // Force-delete since the branch was never merged.
    await runGit(['branch', '-D', branch], parentRepoRoot);
    // Clean up the git config section written for this branch (e.g. branch.<name>.parent).
    // --remove-section exits with code 1 when the section is absent — that is fine.
    await runGit(['config', '--remove-section', `branch.${branch}`], parentRepoRoot);

    setTimeout(() => process.exit(0), 500);
    return Response.json({ outcome: 'rejected' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
