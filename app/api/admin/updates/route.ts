// app/api/admin/updates/route.ts
// Manage upstream Primordia update sources and create merge sessions.
//
// GET
//   Returns all configured sources with their current git status.
//   Response: { sources: SourceStatus[] }
//
// POST { action: "fetch-all" }
//   Fetches all enabled sources. Returns updated source statuses.
//
// POST { action: "fetch-source", sourceId: string }
//   Fetches a single source.
//
// POST { action: "add-source", name: string, url: string }
//   Adds a new update source.
//
// POST { action: "remove-source", sourceId: string }
//   Removes a non-built-in source (and its git remote + tracking branch).
//
// POST { action: "toggle-source", sourceId: string, enabled: boolean }
//   Enables or disables a source.
//
// POST { action: "create-session", sourceId: string }
//   Creates an evolve session to merge a source's tracking branch into main.
//   Returns: { sessionId: string }
//
// Admin-only for all operations.

import { execFileSync } from "child_process";
import * as path from "path";
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
import {
  readSources,
  addSource,
  removeSource,
  setSourceEnabled,
  type UpdateSource,
} from "@/lib/update-sources";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  filename: string;
  content: string;
}

export interface SourceStatus extends UpdateSource {
  remoteConfigured: boolean;
  trackingBranchExists: boolean;
  aheadCount: number;
  mergeBase: string | null;
  changelogEntries: ChangelogEntry[];
  hasUpdates: boolean;
  /** Non-null when fetch failed last time for this source. */
  fetchError: string | null;
}

export interface UpdatesResponse {
  sources: SourceStatus[];
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitSafe(args: string[], cwd?: string): { stdout: string; code: number } {
  try {
    return { stdout: git(args, cwd), code: 0 };
  } catch (err: unknown) {
    const out =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: unknown }).stdout)
        : "";
    return { stdout: out.trim(), code: 1 };
  }
}

function remoteExists(name: string): boolean {
  try {
    return git(["remote"]).split("\n").map((r) => r.trim()).includes(name);
  } catch {
    return false;
  }
}

function branchExists(name: string): boolean {
  return gitSafe(["branch", "--list", name]).stdout.trim().length > 0;
}

function getMergeBase(trackingBranch: string): string | null {
  if (!branchExists(trackingBranch)) return null;
  const r = gitSafe(["merge-base", "main", trackingBranch]);
  return r.code === 0 && r.stdout ? r.stdout.trim() : null;
}

function getAheadCount(mergeBase: string, trackingBranch: string): number {
  const r = gitSafe(["rev-list", "--count", `${mergeBase}..${trackingBranch}`]);
  return r.code === 0 ? parseInt(r.stdout.trim() || "0", 10) : 0;
}

function getNewChangelogEntries(mergeBase: string, trackingBranch: string): ChangelogEntry[] {
  const r = gitSafe([
    "diff", "--name-only", "--diff-filter=A",
    `${mergeBase}..${trackingBranch}`, "--", "changelog/",
  ]);
  if (r.code !== 0 || !r.stdout.trim()) return [];

  const filenames = r.stdout.trim().split("\n").map((f) => f.trim()).filter(Boolean);
  const entries: ChangelogEntry[] = [];
  for (const filepath of filenames) {
    const filename = path.basename(filepath);
    const cr = gitSafe(["show", `${trackingBranch}:${filepath}`]);
    if (cr.code === 0) entries.push({ filename, content: cr.stdout });
  }
  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  return entries;
}

function buildSourceStatus(source: UpdateSource): SourceStatus {
  const remoteConfigured = remoteExists(source.id);
  const trackingBranchExists = branchExists(source.trackingBranch);
  const mergeBase = getMergeBase(source.trackingBranch);
  const aheadCount = mergeBase ? getAheadCount(mergeBase, source.trackingBranch) : 0;
  const changelogEntries =
    mergeBase && aheadCount > 0
      ? getNewChangelogEntries(mergeBase, source.trackingBranch)
      : [];
  return {
    ...source,
    remoteConfigured,
    trackingBranchExists,
    aheadCount,
    mergeBase,
    changelogEntries,
    hasUpdates: aheadCount > 0,
    fetchError: null,
  };
}

/**
 * Fetch a single source.
 * If the git remote was manually removed, recreates it from the stored URL.
 * Returns the updated status, with fetchError set on failure.
 */
function fetchSource(source: UpdateSource): SourceStatus {
  try {
    if (!remoteExists(source.id)) {
      // Remote was manually deleted — recreate it using the URL from git config
      // (source.url comes from remote.{id}.url set by addSource / ensureBuiltin).
      git(["remote", "add", source.id, source.url]);
    }
    git([
      "fetch", "--no-tags", source.id,
      `refs/heads/main:refs/heads/${source.trackingBranch}`,
    ]);
    return buildSourceStatus(source);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...buildSourceStatus(source),
      fetchError: msg.trim(),
    };
  }
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: Response.json({ error: "Authentication required" }, { status: 401 }) };
  if (!(await isAdmin(user.id))) return { user: null, error: Response.json({ error: "Admin required" }, { status: 403 }) };
  return { user, error: null };
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const sources = readSources(process.cwd());
  const statuses = sources.map(buildSourceStatus);
  return Response.json({ sources: statuses } satisfies UpdatesResponse);
}

export async function POST(request: Request) {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const body = (await request.json()) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const repoRoot = process.cwd();

  // ── fetch-all ─────────────────────────────────────────────────────────────
  if (action === "fetch-all") {
    const sources = readSources(repoRoot);
    const statuses = sources.map((s) => (s.enabled ? fetchSource(s) : buildSourceStatus(s)));
    return Response.json({ sources: statuses } satisfies UpdatesResponse);
  }

  // ── fetch-source ──────────────────────────────────────────────────────────
  if (action === "fetch-source") {
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const sources = readSources(repoRoot);
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return Response.json({ error: `Source not found: ${sourceId}` }, { status: 404 });
    const status = fetchSource(source);
    return Response.json({ source: status });
  }

  // ── add-source ────────────────────────────────────────────────────────────
  if (action === "add-source") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!name) return Response.json({ error: "name is required" }, { status: 400 });
    if (!url) return Response.json({ error: "url is required" }, { status: 400 });
    try {
      const source = addSource(repoRoot, name, url);
      const status = buildSourceStatus(source);
      return Response.json({ source: status });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 });
    }
  }

  // ── remove-source ─────────────────────────────────────────────────────────
  if (action === "remove-source") {
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const sources = readSources(repoRoot);
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return Response.json({ error: `Source not found: ${sourceId}` }, { status: 404 });
    if (source.builtin) return Response.json({ error: "Cannot delete a built-in source." }, { status: 400 });
    try {
      removeSource(repoRoot, sourceId);
      // Clean up git remote and tracking branch (best-effort)
      if (remoteExists(sourceId)) {
        gitSafe(["remote", "remove", sourceId]);
      }
      if (branchExists(source.trackingBranch)) {
        gitSafe(["branch", "-D", source.trackingBranch]);
      }
      const updated = readSources(repoRoot).map(buildSourceStatus);
      return Response.json({ sources: updated } satisfies UpdatesResponse);
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 });
    }
  }

  // ── toggle-source ─────────────────────────────────────────────────────────
  if (action === "toggle-source") {
    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const enabled = body.enabled === true;
    try {
      setSourceEnabled(repoRoot, sourceId, enabled);
      const updated = readSources(repoRoot).map(buildSourceStatus);
      return Response.json({ sources: updated } satisfies UpdatesResponse);
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 400 });
    }
  }

  // ── create-session ────────────────────────────────────────────────────────
  if (action === "create-session") {
    if (!(await hasEvolvePermission(user!.id))) {
      return Response.json(
        { error: "You need the evolve permission to create sessions." },
        { status: 403 },
      );
    }

    const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
    const sources = readSources(repoRoot);
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return Response.json({ error: `Source not found: ${sourceId}` }, { status: 404 });

    if (!branchExists(source.trackingBranch)) {
      return Response.json({ error: "No tracking branch found. Fetch updates first." }, { status: 400 });
    }

    const mergeBase = getMergeBase(source.trackingBranch);
    if (!mergeBase) {
      return Response.json({ error: "Could not determine merge base." }, { status: 400 });
    }

    const aheadCount = getAheadCount(mergeBase, source.trackingBranch);
    if (aheadCount === 0) {
      return Response.json({ error: "Already up to date." }, { status: 400 });
    }

    const entries = getNewChangelogEntries(mergeBase, source.trackingBranch);
    const changelogSummary =
      entries.length > 0
        ? entries.map((e) => `- ${e.filename}`).join("\n")
        : "(no changelog entries found)";

    const requestText =
      `Merge the branch \`${source.trackingBranch}\` into the current branch to apply updates from "${source.name}" (${source.url}).\n\n` +
      `Steps:\n` +
      `1. Run: git merge ${source.trackingBranch} --no-edit\n` +
      `2. If there are merge conflicts, resolve them carefully — keep local customisations ` +
      `(env vars, branding, instance-specific features) and incorporate upstream improvements.\n` +
      `3. Verify the app still builds: run \`bun run typecheck\` and \`bun run build\`.\n` +
      `4. Update CLAUDE.md if the upstream changes include architectural changes that affect the file map, ` +
      `data flow, or feature list.\n\n` +
      `The following new changelog entries are being merged in:\n${changelogSummary}\n\n` +
      `Source: ${source.url} (remote: \`${source.id}\`, tracking branch: \`${source.trackingBranch}\`)`;

    // Find a unique branch name for the session
    const baseBranch = `apply-${source.id}`;
    const isTaken = async (name: string) => {
      const r = await runGit(["branch", "--list", name], repoRoot);
      return r.stdout.trim().length > 0;
    };

    let sessionBranch = baseBranch;
    if (await isTaken(baseBranch)) {
      for (let i = 2; i <= 99; i++) {
        const candidate = `${baseBranch}-${i}`;
        if (!(await isTaken(candidate))) { sessionBranch = candidate; break; }
      }
    }

    const repoGitRoot = getRepoRoot(repoRoot);
    const worktreesDir = getWorktreesDir(repoGitRoot);
    const worktreePath = path.join(worktreesDir, sessionBranch);

    const wtResult = await runGit(["worktree", "add", worktreePath, "-b", sessionBranch], repoRoot);
    if (wtResult.code !== 0) {
      return Response.json({ error: `Failed to create worktree: ${wtResult.stderr}` }, { status: 500 });
    }

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
      userId: user!.id,
    };

    void startLocalEvolve(session, requestText, repoRoot, undefined, [], {
      worktreeAlreadyCreated: true,
      initialEventAlreadyWritten: true,
    });

    return Response.json({ sessionId: sessionBranch });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
