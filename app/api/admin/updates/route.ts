// app/api/admin/updates/route.ts
// Fetch upstream Primordia updates from https://primordia.exe.xyz/api/git
// and create evolve sessions to apply them.
//
// GET
//   Returns current update state: remote config, ahead count, new changelog entries.
//   Returns: UpdateStatusResponse
//
// POST { action: "fetch" }
//   Adds (or confirms) the 'primordia-updates' remote and fetches main →
//   primordia-updates-main tracking branch.
//   Returns: UpdateStatusResponse
//
// POST { action: "create-session" }
//   Creates an evolve session on a new branch from local main with a prompt
//   to merge the fetched updates.
//   Returns: { sessionId: string }
//
// Admin-only.

import { execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { getSessionUser, isAdmin, hasEvolvePermission } from "@/lib/auth";
import {
  startLocalEvolve,
  runGit,
  getRepoRoot,
  getWorktreesDir,
  type LocalSession,
} from "@/lib/evolve-sessions";
import {
  appendSessionEvent,
  getSessionNdjsonPath,
} from "@/lib/session-events";

const REMOTE_NAME = "primordia-updates";
const REMOTE_URL = "https://primordia.exe.xyz/api/git";
const TRACKING_BRANCH = "primordia-updates-main";

export interface ChangelogEntry {
  filename: string;
  content: string;
}

export interface UpdateStatusResponse {
  remoteConfigured: boolean;
  trackingBranchExists: boolean;
  aheadCount: number;
  mergeBase: string | null;
  changelogEntries: ChangelogEntry[];
  hasUpdates: boolean;
}

/** Run git with execFileSync and return trimmed stdout (throws on non-zero). */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Run git and return { stdout, code } — never throws. */
function gitSafe(args: string[], cwd?: string): { stdout: string; code: number } {
  try {
    const stdout = git(args, cwd);
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const msg =
      err &&
      typeof err === "object" &&
      "stdout" in err &&
      typeof (err as { stdout?: unknown }).stdout === "string"
        ? (err as { stdout: string }).stdout
        : "";
    return { stdout: msg.trim(), code: 1 };
  }
}

/** Returns true if the named remote exists in the repo. */
function remoteExists(name: string): boolean {
  try {
    const remotes = git(["remote"]).split("\n").map((r) => r.trim());
    return remotes.includes(name);
  } catch {
    return false;
  }
}

/** Returns true if a local branch with the given name exists. */
function branchExists(name: string): boolean {
  const result = gitSafe(["branch", "--list", name]);
  return result.stdout.trim().length > 0;
}

/**
 * Find the merge base of local `main` and `primordia-updates-main`.
 * Returns null if either branch is missing or the merge-base fails.
 */
function getMergeBase(): string | null {
  if (!branchExists(TRACKING_BRANCH)) return null;
  const r = gitSafe(["merge-base", "main", TRACKING_BRANCH]);
  return r.code === 0 && r.stdout ? r.stdout.trim() : null;
}

/**
 * Count how many commits TRACKING_BRANCH is ahead of local main (via merge-base).
 */
function getAheadCount(mergeBase: string): number {
  const r = gitSafe(["rev-list", "--count", `${mergeBase}..${TRACKING_BRANCH}`]);
  return r.code === 0 ? parseInt(r.stdout.trim() || "0", 10) : 0;
}

/**
 * List changelog/*.md files that were added in TRACKING_BRANCH after mergeBase,
 * and read their content from the tracking branch tree.
 */
function getNewChangelogEntries(mergeBase: string): ChangelogEntry[] {
  const r = gitSafe([
    "diff",
    "--name-only",
    "--diff-filter=A",
    `${mergeBase}..${TRACKING_BRANCH}`,
    "--",
    "changelog/",
  ]);
  if (r.code !== 0 || !r.stdout.trim()) return [];

  const filenames = r.stdout
    .trim()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  const entries: ChangelogEntry[] = [];
  for (const filepath of filenames) {
    const filename = path.basename(filepath);
    const contentResult = gitSafe(["show", `${TRACKING_BRANCH}:${filepath}`]);
    if (contentResult.code === 0) {
      entries.push({ filename, content: contentResult.stdout });
    }
  }

  // Sort by filename (which starts with date), oldest first
  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  return entries;
}

/** Build the full update status object. */
function buildStatus(): UpdateStatusResponse {
  const remoteConfigured = remoteExists(REMOTE_NAME);
  const trackingBranchExists = branchExists(TRACKING_BRANCH);
  const mergeBase = getMergeBase();
  const aheadCount = mergeBase ? getAheadCount(mergeBase) : 0;
  const changelogEntries =
    mergeBase && aheadCount > 0 ? getNewChangelogEntries(mergeBase) : [];

  return {
    remoteConfigured,
    trackingBranchExists,
    aheadCount,
    mergeBase,
    changelogEntries,
    hasUpdates: aheadCount > 0,
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Admin required" }, { status: 403 });

  return Response.json(buildStatus());
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Admin required" }, { status: 403 });

  const body = (await request.json()) as { action?: string };

  // ── action: fetch ─────────────────────────────────────────────────────────
  if (body.action === "fetch") {
    try {
      // Ensure the remote exists
      if (!remoteExists(REMOTE_NAME)) {
        git(["remote", "add", REMOTE_NAME, REMOTE_URL]);
      }

      // Fetch main → primordia-updates-main (refspec: refs/heads/main)
      git([
        "fetch",
        "--no-tags",
        REMOTE_NAME,
        `refs/heads/main:refs/heads/${TRACKING_BRANCH}`,
      ]);

      return Response.json(buildStatus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: `Fetch failed: ${msg.trim()}` }, { status: 500 });
    }
  }

  // ── action: create-session ────────────────────────────────────────────────
  if (body.action === "create-session") {
    if (!(await hasEvolvePermission(user.id))) {
      return Response.json(
        { error: "You need the evolve permission to create sessions." },
        { status: 403 },
      );
    }

    if (!branchExists(TRACKING_BRANCH)) {
      return Response.json(
        { error: "No update branch found. Fetch updates first." },
        { status: 400 },
      );
    }

    const mergeBase = getMergeBase();
    if (!mergeBase) {
      return Response.json(
        { error: "Could not determine merge base between main and the update branch." },
        { status: 400 },
      );
    }

    const aheadCount = getAheadCount(mergeBase);
    if (aheadCount === 0) {
      return Response.json(
        { error: "Already up to date. No commits to merge." },
        { status: 400 },
      );
    }

    // Build a list of new changelog filenames for context in the prompt
    const entries = getNewChangelogEntries(mergeBase);
    const changelogSummary =
      entries.length > 0
        ? entries.map((e) => `- ${e.filename}`).join("\n")
        : "(no changelog entries found)";

    const requestText =
      `Merge the branch \`${TRACKING_BRANCH}\` into the current branch to apply upstream Primordia updates.\n\n` +
      `Steps:\n` +
      `1. Run: git merge ${TRACKING_BRANCH} --no-edit\n` +
      `2. If there are merge conflicts, resolve them carefully — keep local customisations ` +
      `(env vars, branding, instance-specific features) and incorporate upstream improvements.\n` +
      `3. Verify the app still builds: run \`bun run typecheck\` and \`bun run build\`.\n` +
      `4. Update CLAUDE.md if the upstream changes include architectural changes that affect the file map, ` +
      `data flow, or feature list.\n\n` +
      `The following new changelog entries are being merged in:\n${changelogSummary}\n\n` +
      `Source of updates: ${REMOTE_URL} (remote: \`${REMOTE_NAME}\`, branch: \`${TRACKING_BRANCH}\`)`;

    const repoRoot = process.cwd();

    // Find a unique branch name for the session
    const baseBranch = "apply-primordia-updates";
    const isTaken = async (name: string): Promise<boolean> => {
      const r = await runGit(["branch", "--list", name], repoRoot);
      return r.stdout.trim().length > 0;
    };

    let sessionBranch = baseBranch;
    if (await isTaken(baseBranch)) {
      for (let i = 2; i <= 99; i++) {
        const candidate = `${baseBranch}-${i}`;
        if (!(await isTaken(candidate))) {
          sessionBranch = candidate;
          break;
        }
      }
    }

    const repoGitRoot = getRepoRoot(repoRoot);
    const worktreesDir = getWorktreesDir(repoGitRoot);
    const worktreePath = path.join(worktreesDir, sessionBranch);

    // Create the worktree synchronously before fire-and-forget
    const wtResult = await runGit(
      ["worktree", "add", worktreePath, "-b", sessionBranch],
      repoRoot,
    );
    if (wtResult.code !== 0) {
      return Response.json(
        { error: `Failed to create session worktree: ${wtResult.stderr}` },
        { status: 500 },
      );
    }

    // Write initial_request event so the session page is immediately reachable
    const ndjsonPath = getSessionNdjsonPath(worktreePath);
    appendSessionEvent(ndjsonPath, {
      type: "initial_request",
      request: requestText,
      attachments: [],
      ts: Date.now(),
    });

    const session: LocalSession = {
      id: sessionBranch,
      branch: sessionBranch,
      worktreePath,
      status: "starting",
      devServerStatus: "none",
      port: null,
      previewUrl: null,
      request: requestText,
      createdAt: Date.now(),
      userId: user.id,
    };

    void startLocalEvolve(session, requestText, repoRoot, undefined, [], {
      worktreeAlreadyCreated: true,
      initialEventAlreadyWritten: true,
    });

    return Response.json({ sessionId: sessionBranch });
  }

  return Response.json({ error: `Unknown action: ${body.action ?? "(none)"}` }, { status: 400 });
}
