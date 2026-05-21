// lib/dependency-audit-scheduler.ts
// Daily background `bun audit` severe-vulnerability checker.

import {
  readDependencyAuditNotification,
  runBunAudit,
  writeDependencyAuditNotification,
} from "./dependency-audit";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let schedulerStarted = false;

export function startDependencyAuditScheduler(repoRoot: string): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalId = setInterval(() => runSchedulerTick(repoRoot), CHECK_INTERVAL_MS);
  if (typeof intervalId === "object" && intervalId && "unref" in intervalId) {
    (intervalId as { unref(): void }).unref();
  }

  // Check shortly after boot without blocking startup.
  const timeoutId = setTimeout(() => runSchedulerTick(repoRoot), 30_000);
  if (typeof timeoutId === "object" && timeoutId && "unref" in timeoutId) {
    (timeoutId as { unref(): void }).unref();
  }

  console.log(`[dependency-audit-scheduler] Started (check interval: ${CHECK_INTERVAL_MS / 1000}s)`);
}

function runSchedulerTick(repoRoot: string): void {
  try {
    const state = readDependencyAuditNotification(repoRoot);
    const elapsed = Date.now() - (state.lastCheckedAt ?? 0);
    if (elapsed < DAY_MS) return;

    const result = runBunAudit("high");
    writeDependencyAuditNotification(repoRoot, result);
    if (result.severeFindings.length > 0) {
      console.warn(
        `[dependency-audit-scheduler] Found ${result.severeFindings.length} high/critical dependency issue(s)`,
      );
    } else {
      console.log("[dependency-audit-scheduler] No high/critical dependency issues found");
    }
  } catch (err) {
    console.error(`[dependency-audit-scheduler] Audit failed: ${err}`);
  }
}
