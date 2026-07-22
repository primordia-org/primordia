// lib/leak-diagnostics-scheduler.ts
// Periodically detects CPU/memory leak symptoms and notifies when diagnostics exist.

import {
  checkAndCaptureLeakDiagnostics,
  readLeakDiagnosticsNotificationState,
  readLeakDiagnosticsSummary,
  writeLeakDiagnosticsNotificationState,
} from "./leak-diagnostics";
import { sendWebPushToCategory } from "./web-push";

const CAPTURE_INTERVAL_MS = 60 * 1000;
const NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000;

export interface LeakDiagnosticsSchedulerOptions {
  captureIntervalMs?: number;
  notificationIntervalMs?: number;
}

let schedulerStarted = false;

export function startLeakDiagnosticsScheduler(repoRoot: string, options: LeakDiagnosticsSchedulerOptions = {}): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const captureIntervalMs = options.captureIntervalMs ?? CAPTURE_INTERVAL_MS;
  const notificationIntervalMs = options.notificationIntervalMs ?? NOTIFICATION_INTERVAL_MS;
  const captureInterval = setInterval(() => runCaptureTick(repoRoot), captureIntervalMs);
  if (typeof captureInterval === "object" && captureInterval && "unref" in captureInterval) {
    (captureInterval as { unref(): void }).unref();
  }

  const notificationInterval = setInterval(() => runNotificationTick(repoRoot), notificationIntervalMs);
  if (typeof notificationInterval === "object" && notificationInterval && "unref" in notificationInterval) {
    (notificationInterval as { unref(): void }).unref();
  }

  const bootTimeout = setTimeout(() => {
    runCaptureTick(repoRoot);
    runNotificationTick(repoRoot);
  }, 45_000);
  if (typeof bootTimeout === "object" && bootTimeout && "unref" in bootTimeout) {
    (bootTimeout as { unref(): void }).unref();
  }

  console.log(`[leak-diagnostics-scheduler] Started (capture interval: ${captureIntervalMs / 1000}s)`);
}

export function runLeakDiagnosticsJobOnce(repoRoot: string): void {
  runCaptureTick(repoRoot);
  runNotificationTick(repoRoot);
}

function runCaptureTick(repoRoot: string): void {
  try {
    const result = checkAndCaptureLeakDiagnostics(repoRoot);
    if (result.captured) runNotificationTick(repoRoot);
  } catch (err) {
    console.error(`[leak-diagnostics-scheduler] Capture failed: ${err}`);
  }
}

function runNotificationTick(repoRoot: string): void {
  try {
    const summary = readLeakDiagnosticsSummary(repoRoot);
    if (!summary.exists || !summary.capturedAt) return;

    const roundedMtime = Math.round(summary.capturedAt);
    if (readLeakDiagnosticsNotificationState(repoRoot) === roundedMtime) return;

    writeLeakDiagnosticsNotificationState(repoRoot, roundedMtime);
    void sendWebPushToCategory("server-health-alerts", {
      title: "CPU / memory diagnostics captured",
      body: summary.reason
        ? `Primordia detected possible CPU or memory leakage: ${summary.reason}. Open Server Health to start an investigation session.`
        : "Primordia detected possible CPU or memory leakage. Open Server Health to start an investigation session.",
      url: "/admin/server-health",
      tag: "primordia-server-health-leak-diagnostics",
    }).catch((pushErr) => console.error(`[leak-diagnostics-scheduler] Push notification failed: ${pushErr}`));
  } catch (err) {
    console.error(`[leak-diagnostics-scheduler] Notification check failed: ${err}`);
  }
}
