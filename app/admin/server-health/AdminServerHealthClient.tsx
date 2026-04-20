"use client";
// components/AdminServerHealthClient.tsx
// Shows server disk/memory usage, configurable proxy thresholds, and worktree cleanup.

import { useState, useEffect, useCallback, useRef } from "react";
import { withBasePath } from "@/lib/base-path";

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

interface HealthData {
  disk: DiskInfo | null;
  memory: MemoryInfo | null;
  oldestNonProdWorktree: NonProdWorktree | null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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

  async function handleDeleteOldest() {
    if (!data?.oldestNonProdWorktree) return;
    const { branch, path } = data.oldestNonProdWorktree;
    if (
      !confirm(
        `Delete worktree for branch "${branch}"?\n\nPath: ${path}\n\nThis will kill its dev server, remove the worktree, and delete the branch. This cannot be undone.`,
      )
    )
      return;

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
      setDeleteMessage(`Deleted worktree for branch "${result.deleted.branch}".`);
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

  const { disk, memory, oldestNonProdWorktree } = data;

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
                When disk usage reaches this level, the oldest non-production worktrees are deleted automatically. Checked every 5 minutes.
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

      {/* Worktree cleanup */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Worktree cleanup</h2>
        <p className="text-sm text-gray-500 mb-4">
          Old non-prod worktrees accumulate on disk after evolve sessions are accepted or
          abandoned. Deleting the oldest one frees disk space.
        </p>
        {oldestNonProdWorktree ? (
          <div className="p-4 rounded border border-gray-700 bg-gray-900 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-gray-200 font-mono truncate">
                {oldestNonProdWorktree.branch}
              </p>
              <p className="text-xs text-gray-500 truncate">{oldestNonProdWorktree.path}</p>
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
          <p className="text-sm text-gray-500">No non-prod worktrees found.</p>
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
