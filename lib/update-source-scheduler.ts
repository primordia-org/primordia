// lib/update-source-scheduler.ts
// Background scheduler that automatically fetches update sources according to
// the per-source fetchFrequency setting.
//
// Started by lib/scheduled-jobs.ts, currently invoked by the reverse-proxy singleton.
//
// How it works:
//   - A single setInterval runs every CHECK_INTERVAL_MS (5 minutes).
//   - On each tick, all enabled sources with fetchFrequency !== "never" are
//     checked. If more than `frequencyMs[frequency]` time has elapsed since
//     `lastFetchedAt`, the source is fetched.
//   - Only `git fetch` is performed — no auto-apply. The delay is applied at
//     fetch time: the tracking branch is advanced only to the most recent commit
//     older than fetchDelayDays, so the tracking branch always points to the
//     "safe" tip with no further post-processing needed.
//   - Errors are logged but never crash the scheduler.
//   - The scheduler is a singleton: calling startUpdateSourceScheduler() more
//     than once is a no-op (idempotent).

import { execFileSync } from "child_process";
import { readSources, setLastFetchedAt, fetchSourceUpdates, type UpdateSource } from "./update-sources";
import { sendWebPushToCategory } from "./web-push";

// ─── Frequency → milliseconds ─────────────────────────────────────────────────

const FREQUENCY_MS: Partial<Record<string, number>> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** How often the scheduler wakes up to check if any source is due. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let schedulerStarted = false;

function gitSafe(repoRoot: string, args: string[]): { stdout: string; code: number } {
  try {
    return {
      stdout: execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
      code: 0,
    };
  } catch {
    return { stdout: "", code: 1 };
  }
}

function getMergeBase(repoRoot: string, source: UpdateSource): string | null {
  const mergeBase = gitSafe(repoRoot, ["merge-base", "main", source.trackingBranch]);
  return mergeBase.code === 0 && mergeBase.stdout ? mergeBase.stdout : null;
}

function getAheadCount(repoRoot: string, source: UpdateSource, mergeBase: string): number {
  const ahead = gitSafe(repoRoot, ["rev-list", "--count", `${mergeBase}..${source.trackingBranch}`]);
  return ahead.code === 0 ? parseInt(ahead.stdout || "0", 10) : 0;
}

function getUpdateNotificationBody(repoRoot: string, source: UpdateSource, aheadCount: number, mergeBase: string): string {
  const changelogDiff = gitSafe(repoRoot, [
    "diff", "--name-only", "--diff-filter=A", `${mergeBase}..${source.trackingBranch}`, "--", "changelog/",
  ]);
  const changelogFiles = changelogDiff.code === 0 && changelogDiff.stdout
    ? changelogDiff.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const changelogTitles = changelogFiles.slice(0, 2).map((file) => {
    const filename = file.split("/").pop() ?? file;
    return filename.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\s+/, "").replace(/\.md$/, "");
  });
  const changelogSummary = changelogTitles.length > 0
    ? ` Changelog: ${changelogTitles.join("; ")}${changelogFiles.length > changelogTitles.length ? ` +${changelogFiles.length - changelogTitles.length} more` : ""}.`
    : "";
  return `${aheadCount} upstream commit${aheadCount === 1 ? "" : "s"} available from ${source.name}.${changelogSummary} Open Updates to review and create a merge session.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the background update-source scheduler.
 * Safe to call multiple times — only the first call has any effect.
 */
export function startUpdateSourceScheduler(repoRoot: string): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalId = setInterval(() => runSchedulerTick(repoRoot), CHECK_INTERVAL_MS);

  // Don't let the interval keep the process alive during tests / graceful shutdown.
  if (typeof intervalId === "object" && intervalId && "unref" in intervalId) {
    (intervalId as { unref(): void }).unref();
  }

  console.log(
    `[update-source-scheduler] Started (check interval: ${CHECK_INTERVAL_MS / 1000}s)`,
  );
}

// ─── Scheduler tick ───────────────────────────────────────────────────────────

function runSchedulerTick(repoRoot: string): void {
  let sources: UpdateSource[];
  try {
    sources = readSources(repoRoot);
  } catch {
    // Git might not be available (test env, etc.) — silently skip.
    return;
  }

  const now = Date.now();

  for (const source of sources) {
    if (!source.enabled) continue;
    if (!source.fetchFrequency || source.fetchFrequency === "never") continue;

    const intervalMs = FREQUENCY_MS[source.fetchFrequency];
    if (!intervalMs) continue;

    const elapsed = now - (source.lastFetchedAt ?? 0);
    if (elapsed < intervalMs) continue;

    // This source is due for a fetch.
    const fetchError = fetchSourceUpdates(source, repoRoot);
    if (fetchError) {
      console.error(
        `[update-source-scheduler] Fetch failed for ${source.id}: ${fetchError}`,
      );
    } else {
      setLastFetchedAt(repoRoot, source.id, now);
      const mergeBase = getMergeBase(repoRoot, source);
      const aheadCount = mergeBase ? getAheadCount(repoRoot, source, mergeBase) : 0;
      console.log(`[update-source-scheduler] Fetched ${source.id} (${source.fetchFrequency})`);
      if (aheadCount > 0 && mergeBase) {
        void sendWebPushToCategory("primordia-updates", {
          title: "Primordia Updates",
          body: getUpdateNotificationBody(repoRoot, source, aheadCount, mergeBase),
          url: "/admin/updates",
        }).catch((pushErr) => console.error(`[update-source-scheduler] Push notification failed: ${pushErr}`));
      }
    }
  }
}

// All fetch logic (including delay handling) lives in lib/update-sources.ts
// via fetchSourceUpdates(). No local git helpers needed here.
