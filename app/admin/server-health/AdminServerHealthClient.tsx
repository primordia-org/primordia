"use client";
// components/AdminServerHealthClient.tsx
// Shows server disk/memory usage, configurable proxy thresholds, and worktree cleanup.

import { useState, useEffect, useCallback, useRef } from "react";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/events-client";

interface DiskInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

interface MemoryInfo {
  totalMB: number;
  usedMB: number;
  availableMB: number;
  usedPercent: number;
}

interface NonProdWorktree {
  path: string;
  branch: string;
  ctimeMs: number;
}

type LeakDiagnosticsCategory = "cpu_usage" | "memory_leak";

interface LeakDiagnosticsInfo {
  exists: boolean;
  path: string;
  capturedAt: number | null;
  sizeBytes: number | null;
  reason: string | null;
  categories: LeakDiagnosticsCategory[];
  dismissedCategories: LeakDiagnosticsCategory[];
  activeCategories: LeakDiagnosticsCategory[];
}

interface OomKillEvent {
  occurredAt: string | null;
  pid: number | null;
  processName: string | null;
  taskMemcg: string | null;
  totalVmKB: number | null;
  anonRssKB: number | null;
  fileRssKB: number | null;
  raw: string;
}

interface OomKillSummary {
  checkedAt: number;
  source: "journalctl" | "dmesg" | "unavailable";
  events: OomKillEvent[];
  error: string | null;
}

interface PrimordiaMemoryProcess {
  pid: number;
  ppid: number;
  etimes: number;
  cpuPercent: number;
  rssKB: number;
  oomScoreAdj: number | null;
  category: string;
  command: string;
}

interface PrimordiaMemorySnapshot {
  checkedAt: number;
  totalRssKB: number;
  coreApiCommandRssKB: number;
  coreApiCommandCount: number;
  longLivedCoreApiCommandCount: number;
  topProcesses: PrimordiaMemoryProcess[];
}

interface HealthData {
  disk: DiskInfo | null;
  memory: MemoryInfo | null;
  oldestNonProdWorktree: NonProdWorktree | null;
  leakDiagnostics: LeakDiagnosticsInfo;
  oomKills: OomKillSummary;
  primordiaMemory: PrimordiaMemorySnapshot;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatKb(kb: number | null): string {
  if (kb === null) return "—";
  return formatBytes(kb * 1024);
}

function formatDuration(seconds: number): string {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

function UsageBar({ percent, threshold = 90 }: { percent: number; threshold?: number }) {
  const color =
    percent >= threshold ? "bg-red-500" : percent >= threshold * 0.78 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
      <div
        className={`${color} h-2 rounded-full transition-all`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function AdminServerHealthClient() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [creatingLeakSession, setCreatingLeakSession] = useState<LeakDiagnosticsCategory | null>(null);
  const [dismissingLeakIssue, setDismissingLeakIssue] = useState<LeakDiagnosticsCategory | null>(null);
  const [leakSessionError, setLeakSessionError] = useState<string | null>(null);

  // Configurable proxy settings
  const [diskCleanupThresholdPct, setDiskCleanupThresholdPct] = useState(90);
  const [previewInactivityMin, setPreviewInactivityMin] = useState(30);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [healthRes, settingsRes] = await Promise.all([
        fetch(withBasePath("/api/admin/server-health")),
        fetch(withBasePath("/api/admin/proxy-settings")),
      ]);
      if (!healthRes.ok) {
        const body = await healthRes.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${healthRes.status}`);
      }
      setData(await healthRes.json());
      if (settingsRes.ok) {
        const s = await settingsRes.json().catch(() => null);
        if (s) {
          if (typeof s.diskCleanupThresholdPct === "number") setDiskCleanupThresholdPct(s.diskCleanupThresholdPct);
          if (typeof s.previewInactivityMin === "number") setPreviewInactivityMin(s.previewInactivityMin);
        }
      }
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  function scheduleSettingsSave(patch: { diskCleanupThresholdPct?: number; previewInactivityMin?: number }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(withBasePath("/api/admin/proxy-settings"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const rb = await res.json().catch(() => ({}));
          throw new Error((rb as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        setSaveStatus("saved");
        savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("error");
      }
    }, 500);
  }

  async function handleCreateLeakSession(category: LeakDiagnosticsCategory) {
    trackEvent("admin/leak-diagnostics-session-created/v1", { path: data?.leakDiagnostics.path, category });
    setCreatingLeakSession(category);
    setLeakSessionError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/server-health"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-leak-diagnostics-session", category }),
      });
      const body = await res.json().catch(() => ({})) as { threadId?: string; error?: string };
      if (!res.ok || !body.threadId) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.assign(withBasePath(`/thread/${body.threadId}`));
    } catch (e) {
      setLeakSessionError(String(e));
      setCreatingLeakSession(null);
    }
  }

  async function handleDismissLeakIssue(category: LeakDiagnosticsCategory) {
    trackEvent("admin/leak-diagnostics-dismissed/v1", { path: data?.leakDiagnostics.path, category });
    setDismissingLeakIssue(category);
    setLeakSessionError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/server-health"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss-leak-diagnostics-issue", category }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await loadData();
    } catch (e) {
      setLeakSessionError(String(e));
    } finally {
      setDismissingLeakIssue(null);
    }
  }

  async function handleDeleteOldest() {
    if (!data?.oldestNonProdWorktree) return;
    const { branch, path } = data.oldestNonProdWorktree;
    if (
      !confirm(
        `Delete thread "${branch}"?\n\nPath: ${path}\n\nThis will kill its preview server and remove its workspace. This cannot be undone.`,
      )
    )
      return;

    trackEvent("admin/oldest-worktree-deleted/v1", { branch, path });
    setDeleting(true);
    setDeleteMessage(null);
    setDeleteError(null);
    try {
      const res = await fetch(withBasePath("/api/admin/server-health"), { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { deleted: { branch: string; path: string } };
      setDeleteMessage(`Deleted thread "${result.deleted.branch}".`);
      await loadData();
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading server health…</p>;
  }

  if (fetchError) {
    return <p className="text-sm text-red-400">{fetchError}</p>;
  }

  if (!data) return null;

  const { disk, memory, oldestNonProdWorktree, leakDiagnostics, oomKills, primordiaMemory } = data;
  const activeLeakCategories = leakDiagnostics.activeCategories.length > 0
    ? leakDiagnostics.activeCategories
    : leakDiagnostics.categories.filter((category) => !leakDiagnostics.dismissedCategories.includes(category));

  const saveIndicator =
    saveStatus === "saving" ? (
      <span className="text-xs text-gray-500">Saving…</span>
    ) : saveStatus === "saved" ? (
      <span className="text-xs text-green-500">Saved</span>
    ) : saveStatus === "error" ? (
      <span className="text-xs text-red-400">Save failed</span>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Disk */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3">Disk space</h2>
        {disk ? (
          <div className="p-4 rounded border border-gray-700 bg-gray-900">
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>
                {formatBytes(disk.usedBytes)} used of {formatBytes(disk.totalBytes)}
              </span>
              <span className="text-gray-400">{formatBytes(disk.availableBytes)} free</span>
            </div>
            <UsageBar percent={disk.usedPercent} threshold={diskCleanupThresholdPct} />
            <p className="text-xs text-gray-500 mt-1">{disk.usedPercent}% used</p>

            <div className="mt-4 pt-4 border-t border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">
                  Auto-cleanup threshold
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200 tabular-nums w-10 text-right">
                    {diskCleanupThresholdPct}%
                  </span>
                  {saveIndicator}
                </div>
              </div>
              <input
                data-id="admin-health/disk-cleanup-threshold"
                type="range"
                min={50}
                max={99}
                step={1}
                value={diskCleanupThresholdPct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDiskCleanupThresholdPct(v);
                  scheduleSettingsSave({ diskCleanupThresholdPct: v, previewInactivityMin });
                }}
                className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>50%</span>
                <span>99%</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                When disk usage reaches this level, the oldest non-production thread workspaces are deleted automatically. Checked every 5 minutes.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Disk info unavailable.</p>
        )}
      </section>

      {/* Memory */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3">Memory</h2>
        {memory ? (
          <div className="p-4 rounded border border-gray-700 bg-gray-900">
            <div className="flex justify-between text-sm text-gray-300 mb-1">
              <span>
                {memory.usedMB.toLocaleString()} MB used of {memory.totalMB.toLocaleString()} MB
              </span>
              <span className="text-gray-400">
                {memory.availableMB.toLocaleString()} MB free
              </span>
            </div>
            <UsageBar percent={memory.usedPercent} />
            <p className="text-xs text-gray-500 mt-1">{memory.usedPercent}% used</p>

            <div className="mt-4 pt-4 border-t border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-gray-400">
                  Preview server inactivity timeout
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200 tabular-nums w-16 text-right">
                    {previewInactivityMin} min
                  </span>
                  {saveIndicator}
                </div>
              </div>
              <input
                data-id="admin-health/preview-inactivity-timeout"
                type="range"
                min={5}
                max={240}
                step={5}
                value={previewInactivityMin}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPreviewInactivityMin(v);
                  scheduleSettingsSave({ diskCleanupThresholdPct, previewInactivityMin: v });
                }}
                className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>5 min</span>
                <span>240 min</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Preview dev servers are stopped after this many minutes without traffic. Shorter values free memory sooner; longer values keep servers warm.
              </p>
            </div>

          </div>
        ) : (
          <p className="text-sm text-gray-500">Memory info unavailable.</p>
        )}
      </section>

      {/* Primordia memory */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Primordia process memory</h2>
        <p className="text-sm text-gray-500 mb-4">
          Snapshot of live Primordia processes, including OOM priority. Higher OOM adjustment values are killed sooner.
        </p>
        <div className="p-4 rounded border border-gray-700 bg-gray-900">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Total Primordia RSS</p>
              <p className="mt-1 font-medium text-gray-200">{formatKb(primordiaMemory.totalRssKB)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Core API command RSS</p>
              <p className="mt-1 font-medium text-gray-200">{formatKb(primordiaMemory.coreApiCommandRssKB)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Long-lived Core API commands</p>
              <p className="mt-1 font-medium text-gray-200">{primordiaMemory.longLivedCoreApiCommandCount} / {primordiaMemory.coreApiCommandCount}</p>
            </div>
          </div>
          {primordiaMemory.longLivedCoreApiCommandCount > 0 && (
            <p className="mt-3 text-xs text-amber-300">
              Long-lived `bun scripts/primordia.ts ... --follow` commands are currently consuming memory. This supports the theory that the new Core API/log-follow path can amplify OOM pressure when clients leave command followers behind.
            </p>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">RSS</th>
                  <th className="py-2 pr-4 font-medium">OOM adj</th>
                  <th className="py-2 pr-4 font-medium">Age</th>
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Command</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 text-gray-300">
                {primordiaMemory.topProcesses.slice(0, 12).map((proc) => (
                  <tr key={proc.pid} title={proc.command}>
                    <td className="py-2 pr-4 tabular-nums">{formatKb(proc.rssKB)}</td>
                    <td className="py-2 pr-4 tabular-nums">{proc.oomScoreAdj ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-gray-400">{formatDuration(proc.etimes)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{proc.category}</td>
                    <td className="py-2 pr-4 max-w-[22rem] truncate font-mono text-gray-500">{proc.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* OOM diagnostics */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Recent OOM kills</h2>
        <p className="text-sm text-gray-500 mb-4">
          Kernel out-of-memory events explain abrupt SIGKILL exits. These entries come from recent kernel logs and identify which process the OOM killer selected.
        </p>
        <div className="p-4 rounded border border-gray-700 bg-gray-900">
          {oomKills.source === "unavailable" ? (
            <p className="text-sm text-gray-500">Kernel OOM logs unavailable: {oomKills.error ?? "unknown error"}</p>
          ) : oomKills.events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Time</th>
                    <th className="py-2 pr-4 font-medium">Process</th>
                    <th className="py-2 pr-4 font-medium">PID</th>
                    <th className="py-2 pr-4 font-medium">RSS</th>
                    <th className="py-2 pr-4 font-medium">Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 text-gray-300">
                  {oomKills.events.map((event, index) => (
                    <tr key={`${event.pid ?? "unknown"}-${event.occurredAt ?? index}`} title={event.raw}>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-400">{event.occurredAt ?? "unknown"}</td>
                      <td className="py-2 pr-4 font-mono">{event.processName ?? "unknown"}</td>
                      <td className="py-2 pr-4 tabular-nums">{event.pid ?? "—"}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatKb(event.anonRssKB)}</td>
                      <td className="py-2 pr-4 max-w-[18rem] truncate text-gray-500">{event.taskMemcg ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-amber-300">
                Yes: recent SIGKILL exits were OOM-killer events. Lack of swap means short memory spikes can kill Primordia processes before normal logs flush.
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No recent OOM kills found in kernel logs via {oomKills.source}.</p>
          )}
        </div>
      </section>

      {/* Leak diagnostics */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Diagnostics issues</h2>
        <p className="text-sm text-gray-500 mb-4">
          Primordia separates sustained CPU usage from memory pressure so admins can investigate or dismiss each issue independently.
        </p>
        <div className="space-y-3">
          {leakDiagnostics.exists && activeLeakCategories.length > 0 ? (
            activeLeakCategories.map((category) => {
              const isCpu = category === "cpu_usage";
              const title = isCpu ? "CPU usage diagnostics" : "Memory leak diagnostics";
              const description = isCpu
                ? "Sustained load or high Primordia CPU usage was detected while the app should have been idle."
                : "High memory pressure or possible memory retention was detected while the app should have been idle.";
              return (
                <div key={category} className="p-4 rounded border border-gray-700 bg-gray-900">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-200">{title}</p>
                      <p className="mt-1 text-sm text-gray-400">{description}</p>
                      {leakDiagnostics.reason && (
                        <p className="mt-2 text-sm text-gray-400">{leakDiagnostics.reason}</p>
                      )}
                      <p className="mt-2 truncate font-mono text-xs text-gray-500" title={leakDiagnostics.path}>{leakDiagnostics.path}</p>
                      {leakDiagnostics.capturedAt && (
                        <p className="mt-1 text-xs text-gray-600">Captured {new Date(leakDiagnostics.capturedAt).toLocaleString()}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                      <button
                        data-id={`admin-health/create-leak-diagnostics-session/${category}`}
                        onClick={() => handleCreateLeakSession(category)}
                        disabled={creatingLeakSession !== null || dismissingLeakIssue !== null}
                        className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creatingLeakSession === category ? "Creating thread…" : "Investigate and fix"}
                      </button>
                      <button
                        data-id={`admin-health/dismiss-leak-diagnostics/${category}`}
                        onClick={() => handleDismissLeakIssue(category)}
                        disabled={creatingLeakSession !== null || dismissingLeakIssue !== null}
                        className="rounded border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {dismissingLeakIssue === category ? "Dismissing…" : "Dismiss issue"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          ) : leakDiagnostics.exists && leakDiagnostics.dismissedCategories.length > 0 ? (
            <div className="p-4 rounded border border-gray-700 bg-gray-900">
              <p className="text-sm text-gray-500">All captured CPU and memory diagnostics issues have been dismissed.</p>
            </div>
          ) : (
            <div className="p-4 rounded border border-gray-700 bg-gray-900">
              <p className="text-sm text-gray-500">No CPU usage or memory leak diagnostics have been captured.</p>
            </div>
          )}
          {leakSessionError && <p className="text-sm text-red-400">{leakSessionError}</p>}
        </div>
      </section>

      {/* Thread cleanup */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Thread cleanup</h2>
        <p className="text-sm text-gray-500 mb-4">
          Old non-production thread workspaces accumulate on disk after threads are accepted or
          abandoned. Deleting the oldest one frees disk space.
        </p>
        {oldestNonProdWorktree ? (
          <div className="p-4 rounded border border-gray-700 bg-gray-900 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-gray-200 font-mono truncate">
                {oldestNonProdWorktree.branch}
              </p>
              {oldestNonProdWorktree.ctimeMs > 0 && (
                <p className="text-xs text-gray-600 mt-0.5">
                  {new Date(oldestNonProdWorktree.ctimeMs).toLocaleString()}
                </p>
              )}
            </div>
            <button
              data-id="admin-health/delete-oldest-worktree"
              onClick={handleDeleteOldest}
              disabled={deleting}
              className="shrink-0 px-3 py-1.5 text-sm rounded bg-red-800 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            >
              {deleting ? "Deleting…" : "Delete oldest"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No non-production threads found.</p>
        )}

        {deleteMessage && (
          <p className="mt-3 text-sm text-green-400">{deleteMessage}</p>
        )}
        {deleteError && (
          <p className="mt-3 text-sm text-red-400">{deleteError}</p>
        )}
      </section>
    </div>
  );
}
