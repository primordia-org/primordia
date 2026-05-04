// lib/update-sources.ts
// Manages the list of git-based update sources for the "Fetch Updates" admin panel.
//
// ─── Storage: remote.{id}.* in git config ─────────────────────────────────────
//
// Update sources piggyback on the standard `remote.*` git config namespace,
// extending it with Primordia-specific fields — exactly the same way the
// codebase extends `branch.*` with `branch.{name}.port` and `branch.{name}.parent`.
//
// A source entry in .git/config looks like:
//
//   [remote "primordia-official"]
//       url             = https://primordia.exe.xyz/api/git
//       fetch           = +refs/heads/*:refs/remotes/primordia-official/*
//       updateSource    = true
//       displayName     = Primordia Official
//       builtin         = true
//       enabled         = true
//       fetchFrequency  = daily
//       fetchDelayDays  = 7
//       lastFetchedAt   = 1714300000000
//
// The `url` and `fetch` fields are set by `git remote add` (standard git).
// The remaining fields are Primordia-specific metadata added on top.
//
// fetchFrequency controls how often the background scheduler automatically fetches
// this source. Values: "never", "hourly", "daily", "weekly". Defaults to "never".
//
// fetchDelayDays controls a safety buffer: instead of using the latest commit on
// the tracking branch, the system only surfaces commits whose committer date is at
// least N days old. This guards against supply-chain attacks — new upstream commits
// are held in quarantine for the configured number of days before being offered as
// available updates. 0 means use the latest commit immediately.
//
// lastFetchedAt is the Unix-millisecond timestamp of the most recent successful
// auto-fetch. Used by the scheduler to decide when the next fetch is due.
//
// This means every update source is also a fully functional git remote —
// `git fetch primordia-official` works without any translation layer.
//
// Enumerate all update sources:
//   git config --get-regexp 'remote\.[^.]+\.updateSource'
//   (outputs "remote.{id}.updatesource true" per source — git lowercases field names)
//
// See CLAUDE.md §"Git Config as Key-Value Store" for the full pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "child_process";

/** How often the scheduler auto-fetches this source. */
export type FetchFrequency = "never" | "hourly" | "daily" | "weekly";

export interface UpdateSource {
  /** Remote name in git config — also used as the git remote. */
  id: string;
  /** Human-readable display name (stored as remote.{id}.displayName). */
  name: string;
  /** Git remote URL (stored as remote.{id}.url via `git remote add`). */
  url: string;
  /** Local tracking branch for the upstream `main`, always `${id}-main`. */
  trackingBranch: string;
  /** Whether this source is included in fetch operations (remote.{id}.enabled). */
  enabled: boolean;
  /**
   * True for the built-in Primordia Official source. Built-in sources cannot
   * be deleted, only disabled (remote.{id}.builtin = true).
   */
  builtin: boolean;
  /**
   * How often the background scheduler auto-fetches this source.
   * "never" (default) disables automatic fetching.
   */
  fetchFrequency: FetchFrequency;
  /**
   * Safety buffer in days. Only commits whose committer date is at least this
   * many days old are surfaced as available updates. 0 = no delay (latest tip).
   * Stored as remote.{id}.fetchDelayDays in git config.
   */
  fetchDelayDays: number;
  /**
   * Unix-millisecond timestamp of the most recent successful auto-fetch, or null
   * if never auto-fetched. Stored as remote.{id}.lastFetchedAt.
   */
  lastFetchedAt: number | null;
}

// ─── Built-in source ──────────────────────────────────────────────────────────

const BUILTIN_ID = "primordia-official";
const BUILTIN_SOURCE: UpdateSource = {
  id: BUILTIN_ID,
  name: "Primordia Official",
  url: "https://primordia.exe.xyz/api/git",
  trackingBranch: "primordia-official-main",
  enabled: true,
  builtin: true,
  fetchFrequency: "never",
  fetchDelayDays: 0,
  lastFetchedAt: null,
};

// ─── Low-level git helpers ───────────────────────────────────────────────────

/** Run a git command and return stdout. Throws on non-zero exit. */
function gitRun(args: string[], repoRoot: string): string {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr?.trim() || `git ${args[0]} failed`);
  return r.stdout?.trim() ?? "";
}

/** Run a git command silently, ignoring failures. */
function gitRunSafe(args: string[], repoRoot: string): void {
  spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

/** Ensure a git remote exists with the given URL. Creates or corrects it. */
function ensureRemote(id: string, url: string, repoRoot: string): void {
  const existing = gitGet(`remote.${id}.url`, repoRoot);
  if (!existing) {
    const r = spawnSync("git", ["remote", "add", id, url], { cwd: repoRoot, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git remote add ${id} failed: ${r.stderr?.trim()}`);
  } else if (existing !== url) {
    spawnSync("git", ["remote", "set-url", id, url], { cwd: repoRoot, encoding: "utf8" });
  }
}

// ─── Low-level git config helpers ─────────────────────────────────────────────

function gitGet(key: string, repoRoot: string): string | null {
  const r = spawnSync("git", ["config", "--get", key], { cwd: repoRoot, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function gitGetRegexp(pattern: string, repoRoot: string): Array<{ key: string; value: string }> {
  const r = spawnSync("git", ["config", "--get-regexp", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout.trim()) return [];
  return r.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(" ");
      return idx === -1
        ? { key: line, value: "" }
        : { key: line.slice(0, idx), value: line.slice(idx + 1) };
    });
}

function gitSet(key: string, value: string, repoRoot: string): void {
  const r = spawnSync("git", ["config", key, value], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git config ${key} failed: ${r.stderr?.trim()}`);
}

// ─── Source helpers ────────────────────────────────────────────────────────────

/**
 * Read a single source from git config by remote ID.
 * Returns null if no remote with that name has updateSource=true.
 */
function readSourceById(id: string, repoRoot: string): UpdateSource | null {
  const marker = gitGet(`remote.${id}.updateSource`, repoRoot);
  if (marker !== "true") return null;
  const url = gitGet(`remote.${id}.url`, repoRoot) ?? "";
  const name = gitGet(`remote.${id}.displayName`, repoRoot) ?? id;
  const enabled = gitGet(`remote.${id}.enabled`, repoRoot) !== "false";
  const builtin = gitGet(`remote.${id}.builtin`, repoRoot) === "true";
  const freq = gitGet(`remote.${id}.fetchFrequency`, repoRoot);
  const fetchFrequency: FetchFrequency =
    freq === "hourly" || freq === "daily" || freq === "weekly" ? freq : "never";
  const delayRaw = gitGet(`remote.${id}.fetchDelayDays`, repoRoot);
  const fetchDelayDays = delayRaw ? Math.max(0, parseInt(delayRaw, 10) || 0) : 0;
  const lastRaw = gitGet(`remote.${id}.lastFetchedAt`, repoRoot);
  const lastFetchedAt = lastRaw ? parseInt(lastRaw, 10) || null : null;
  return { id, name, url, trackingBranch: `${id}-main`, enabled, builtin, fetchFrequency, fetchDelayDays, lastFetchedAt };
}

/**
 * Write Primordia-specific metadata fields onto an existing git remote.
 * Does NOT create the remote — call `git remote add` first.
 */
function writeSourceMeta(source: UpdateSource, repoRoot: string): void {
  gitSet(`remote.${source.id}.updateSource`, "true", repoRoot);
  gitSet(`remote.${source.id}.displayName`, source.name, repoRoot);
  gitSet(`remote.${source.id}.builtin`, String(source.builtin), repoRoot);
  gitSet(`remote.${source.id}.enabled`, String(source.enabled), repoRoot);
  gitSet(`remote.${source.id}.fetchFrequency`, source.fetchFrequency, repoRoot);
  gitSet(`remote.${source.id}.fetchDelayDays`, String(source.fetchDelayDays), repoRoot);
}

/**
 * Ensure the built-in source exists as a git remote with correct metadata.
 * Idempotent — safe to call on every readSources().
 */
function ensureBuiltin(repoRoot: string): UpdateSource {
  const url = gitGet(`remote.${BUILTIN_ID}.url`, repoRoot);
  if (!url) {
    // Remote doesn't exist at all — create it.
    const r = spawnSync("git", ["remote", "add", BUILTIN_ID, BUILTIN_SOURCE.url], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      // Could not create (e.g. no git repo in test env) — return the default.
      return BUILTIN_SOURCE;
    }
  } else if (url !== BUILTIN_SOURCE.url) {
    // URL drifted — correct it.
    spawnSync("git", ["remote", "set-url", BUILTIN_ID, BUILTIN_SOURCE.url], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  }

  // Always (re)write the metadata, forcing builtin=true.
  const existing = readSourceById(BUILTIN_ID, repoRoot);
  const source: UpdateSource = {
    ...BUILTIN_SOURCE,
    enabled: existing?.enabled ?? true,
    fetchFrequency: existing?.fetchFrequency ?? "never",
    fetchDelayDays: existing?.fetchDelayDays ?? 0,
    lastFetchedAt: existing?.lastFetchedAt ?? null,
  };
  writeSourceMeta(source, repoRoot);
  return source;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read all update sources from git config.
 * Always includes the built-in source (initialising it if absent).
 * Returns sources with the built-in first, then user-added in git config order.
 */
export function readSources(repoRoot: string): UpdateSource[] {
  const builtin = ensureBuiltin(repoRoot);

  // Enumerate all remotes tagged with updateSource=true.
  // git lowercases key names in --get-regexp output, so the field appears as
  // "remote.{id}.updatesource" (no camel casing in the key portion of output).
  const entries = gitGetRegexp("remote\\.[^.]+\\.updatesource", repoRoot);
  const seen = new Set<string>([BUILTIN_ID]);
  const sources: UpdateSource[] = [builtin];

  for (const { key } of entries) {
    // key = "remote.{id}.updatesource"
    const match = key.match(/^remote\.([^.]+)\.updatesource$/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const source = readSourceById(id, repoRoot);
    if (source) sources.push(source);
  }

  return sources;
}

/**
 * Add a new user-defined update source.
 * Creates a real git remote (`git remote add`) and tags it with Primordia metadata.
 * Returns the newly created source.
 */
export function addSource(repoRoot: string, name: string, url: string): UpdateSource {
  const existing = readSources(repoRoot);
  const baseId = slugify(name);
  const id = uniqueId(baseId, existing.map((s) => s.id));
  const source: UpdateSource = {
    id,
    name,
    url,
    trackingBranch: `${id}-main`,
    enabled: true,
    builtin: false,
    fetchFrequency: "never",
    fetchDelayDays: 0,
    lastFetchedAt: null,
  };

  // Create the git remote first so `git fetch {id}` works immediately.
  const r = spawnSync("git", ["remote", "add", id, url], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git remote add ${id} failed: ${r.stderr?.trim()}`);
  }

  writeSourceMeta(source, repoRoot);
  return source;
}

/**
 * Remove a non-built-in update source.
 * Uses `git remote remove` which deletes the entire [remote "{id}"] section,
 * including all Primordia metadata fields.
 * Throws if the source is built-in or not found.
 */
export function removeSource(repoRoot: string, id: string): void {
  const source = readSourceById(id, repoRoot);
  if (!source) throw new Error(`Update source not found: ${id}`);
  if (source.builtin) throw new Error(`Cannot delete the built-in source "${id}".`);

  const r = spawnSync("git", ["remote", "remove", id], { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git remote remove ${id} failed: ${r.stderr?.trim()}`);
}

/**
 * Toggle the enabled flag for an update source.
 * Works for both built-in (can disable) and user-defined sources.
 */
export function setSourceEnabled(repoRoot: string, id: string, enabled: boolean): void {
  const source = readSourceById(id, repoRoot);
  if (!source) throw new Error(`Update source not found: ${id}`);
  gitSet(`remote.${id}.enabled`, String(enabled), repoRoot);
}

/**
 * Update the fetch schedule settings for a source.
 * Both frequency and delay are updated atomically.
 */
export function setSourceSchedule(
  repoRoot: string,
  id: string,
  fetchFrequency: FetchFrequency,
  fetchDelayDays: number,
): void {
  const source = readSourceById(id, repoRoot);
  if (!source) throw new Error(`Update source not found: ${id}`);
  gitSet(`remote.${id}.fetchFrequency`, fetchFrequency, repoRoot);
  gitSet(`remote.${id}.fetchDelayDays`, String(Math.max(0, fetchDelayDays)), repoRoot);
}

/**
 * Record the timestamp of a successful auto-fetch for scheduler bookkeeping.
 */
export function setLastFetchedAt(repoRoot: string, id: string, timestampMs: number): void {
  gitSet(`remote.${id}.lastFetchedAt`, String(timestampMs), repoRoot);
}

/**
 * Read the last-fetched timestamp for a source, or 0 if never fetched.
 */
export function getLastFetchedAt(repoRoot: string, id: string): number {
  const raw = gitGet(`remote.${id}.lastFetchedAt`, repoRoot);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

// ─── Fetch with delay ─────────────────────────────────────────────────────────

/**
 * Fetch a single update source, applying the delay filter at fetch time.
 *
 * The core idea: the tracking branch always points to the "safe" commit — no
 * post-processing is needed when reading status. Callers can treat the tracking
 * branch tip as the effective tip directly.
 *
 * When fetchDelayDays === 0:
 *   A straight `git fetch` advances the tracking branch to the upstream tip.
 *
 * When fetchDelayDays > 0:
 *   1. Fetch the full upstream to a temporary `{trackingBranch}-incoming` branch.
 *   2. Find the most recent commit on that branch whose committer date is at
 *      least fetchDelayDays days old (via `git log --before`).
 *   3. If such a commit exists, advance the tracking branch to it (force-update).
 *      If not (all upstream commits are newer than the delay window), leave the
 *      tracking branch where it is — it already points to the last "safe" commit.
 *   4. Delete the temp branch regardless.
 *
 * Returns null on success, or an error message string on failure.
 */
export function fetchSourceUpdates(source: UpdateSource, repoRoot: string): string | null {
  try {
    ensureRemote(source.id, source.url, repoRoot);

    if (source.fetchDelayDays <= 0) {
      // Simple path: fetch directly to tracking branch.
      gitRun(
        ["fetch", "--no-tags", source.id,
          `refs/heads/main:refs/heads/${source.trackingBranch}`],
        repoRoot,
      );
      return null;
    }

    // Delayed path: fetch to a staging branch, then find the safe commit.
    const tmpBranch = `${source.trackingBranch}-incoming`;

    // Remove any leftover temp branch from a previous interrupted fetch.
    gitRunSafe(["branch", "-D", tmpBranch], repoRoot);

    try {
      gitRun(
        ["fetch", "--no-tags", source.id,
          `refs/heads/main:refs/heads/${tmpBranch}`],
        repoRoot,
      );

      // Find the latest commit on tmpBranch that is old enough.
      const before = `${source.fetchDelayDays} days ago`;
      const r = spawnSync(
        "git", ["log", `--before=${before}`, "--format=%H", "-1", tmpBranch],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const safeCommit = r.status === 0 ? r.stdout.trim() : "";

      if (safeCommit) {
        // Advance (or create) the tracking branch to the delayed commit.
        gitRun(["branch", "-f", source.trackingBranch, safeCommit], repoRoot);
      }
      // If safeCommit is empty: all upstream commits are newer than the delay
      // window. Leave the tracking branch as-is (preserves the last safe tip).
    } finally {
      // Always clean up the staging branch.
      gitRunSafe(["branch", "-D", tmpBranch], repoRoot);
    }

    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "source"
  );
}

function uniqueId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
