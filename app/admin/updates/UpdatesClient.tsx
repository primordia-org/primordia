"use client";

// app/admin/updates/UpdatesClient.tsx
// Client component for the Fetch Updates admin panel.
// Supports multiple update sources (like Linux distro repos): fetch upstream
// changes and create AI-assisted merge sessions to apply them.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitMerge,
  Loader,
  CloudOff,
  PackageCheck,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Settings,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { SourceStatus, UpdatesResponse, ChangelogEntry } from "@/app/api/admin/updates/route";
import type { FetchFrequency } from "@/lib/update-sources";

interface UpdatesClientProps {
  initialSources: SourceStatus[];
}

// ─── Changelog entry card ─────────────────────────────────────────────────────

function ChangelogEntryCard({ entry }: { entry: ChangelogEntry }) {
  const [open, setOpen] = useState(false);
  // Strip the timestamp prefix "YYYY-MM-DD-HH-MM-SS " to show just the title
  const displayName = entry.filename.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\s+/, "").replace(/\.md$/, "");
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-gray-800/60 hover:bg-gray-800 transition-colors"
      >
        {open ? (
          <ChevronDown size={13} strokeWidth={2} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-gray-400" />
        )}
        <span className="text-xs font-medium text-gray-200 truncate">{displayName}</span>
        <span className="ml-auto text-xs text-gray-500 shrink-0 font-mono">
          {entry.filename.slice(0, 10)}
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-gray-900/60 border-t border-gray-700 max-h-80 overflow-y-auto">
          <MarkdownContent text={entry.content} />
        </div>
      )}
    </div>
  );
}

// ─── Per-source card ──────────────────────────────────────────────────────────

// ─── Frequency + delay labels ─────────────────────────────────────────────────

const FREQUENCY_OPTIONS: { value: FetchFrequency; label: string }[] = [
  { value: "never",  label: "Never (manual only)" },
  { value: "hourly", label: "Every hour" },
  { value: "daily",  label: "Every day" },
  { value: "weekly", label: "Every week" },
];

const DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0,  label: "No delay (latest)" },
  { value: 1,  label: "1 day" },
  { value: 3,  label: "3 days" },
  { value: 7,  label: "1 week" },
  { value: 14, label: "2 weeks" },
  { value: 30, label: "1 month" },
];

/** Short human label for a frequency value, used in the schedule summary line. */
function frequencySummary(freq: FetchFrequency): string | null {
  switch (freq) {
    case "hourly": return "Checked hourly";
    case "daily":  return "Checked daily";
    case "weekly": return "Checked weekly";
    default:       return null; // "never" → omit
  }
}

/** Short human label for a delay value, used in the schedule summary line. */
function delaySummary(days: number): string | null {
  if (days <= 0) return null;
  const opt = DELAY_OPTIONS.find((o) => o.value === days);
  const label = opt ? opt.label : `${days}d`;
  return `Delayed ${label.toLowerCase()}`;
}

function formatLastFetched(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Per-source settings panel ────────────────────────────────────────────────

interface SourceSettingsPanelProps {
  source: SourceStatus;
  onSave: (sourceId: string, freq: FetchFrequency, delayDays: number) => Promise<void>;
  busy: boolean;
}

function SourceSettingsPanel({ source, onSave, busy }: SourceSettingsPanelProps) {
  const [freq, setFreq] = useState<FetchFrequency>(source.fetchFrequency);
  const [delayDays, setDelayDays] = useState<number>(source.fetchDelayDays);
  const [saving, setSaving] = useState(false);

  const isDirty = freq !== source.fetchFrequency || delayDays !== source.fetchDelayDays;

  async function handleSave() {
    setSaving(true);
    await onSave(source.id, freq, delayDays);
    setSaving(false);
  }

  return (
    <div className="px-4 py-3 bg-gray-900/60 border-t border-gray-700/50 space-y-3">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Schedule settings</p>

      {/* Frequency */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 w-28 shrink-0">
          <Clock size={12} strokeWidth={2} />
          Auto-fetch
        </div>
        <select
          value={freq}
          onChange={(e) => setFreq(e.target.value as FetchFrequency)}
          disabled={busy || saving}
          className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
        >
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {source.lastFetchedAt !== null || source.fetchFrequency !== "never" ? (
          <span className="text-xs text-gray-600 shrink-0">
            Last: {formatLastFetched(source.lastFetchedAt)}
          </span>
        ) : null}
      </div>

      {/* Delay */}
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 w-28 shrink-0 pt-1.5">
          <ShieldCheck size={12} strokeWidth={2} />
          Commit delay
        </div>
        <div className="flex-1 space-y-1">
          <select
            value={delayDays}
            onChange={(e) => setDelayDays(parseInt(e.target.value, 10))}
            disabled={busy || saving}
            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
          >
            {DELAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-600 leading-snug">
            {delayDays > 0
              ? `Only commits at least ${delayDays} day${delayDays === 1 ? "" : "s"} old will be shown as available updates. Recent commits are held in a safety buffer.`
              : "The latest commits are used immediately after fetching."}
          </p>
        </div>
      </div>

      {/* Save */}
      {isDirty && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
          >
            {saving ? <Loader size={12} strokeWidth={2} className="animate-spin" /> : null}
            Save settings
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Per-source card ──────────────────────────────────────────────────────────

interface SourceCardProps {
  source: SourceStatus;
  onFetch: (sourceId: string) => Promise<void>;
  onToggle: (sourceId: string, enabled: boolean) => Promise<void>;
  onRemove: (sourceId: string) => Promise<void>;
  onCreateSession: (sourceId: string) => Promise<void>;
  onSaveSettings: (sourceId: string, freq: FetchFrequency, delayDays: number) => Promise<void>;
  busy: boolean;
}

function SourceCard({ source, onFetch, onToggle, onRemove, onCreateSession, onSaveSettings, busy }: SourceCardProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors ${
        !source.enabled
          ? "border-gray-700/50 opacity-60"
          : source.fetchError
          ? "border-red-700/50"
          : source.hasUpdates
          ? "border-blue-700/50"
          : "border-gray-700"
      }`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 bg-gray-800/50">
        {/* Status dot */}
        <div className="mt-1 shrink-0">
          {!source.trackingBranchExists ? (
            <CloudOff size={15} strokeWidth={2} className="text-gray-500" />
          ) : source.fetchError ? (
            <AlertCircle size={15} strokeWidth={2} className="text-red-400" />
          ) : source.hasUpdates ? (
            <Download size={15} strokeWidth={2} className="text-blue-400" />
          ) : (
            <PackageCheck size={15} strokeWidth={2} className="text-green-400" />
          )}
        </div>

        {/* Name + URL + schedule summary */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100">{source.name}</span>
            {source.builtin && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                built-in
              </span>
            )}
            {!source.enabled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-500">
                disabled
              </span>
            )}
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-gray-300 inline-flex items-center gap-1 truncate max-w-xs transition-colors mt-0.5"
          >
            {source.url}
            <ExternalLink size={10} strokeWidth={2} className="shrink-0" />
          </a>
          {/* Schedule summary + settings cog */}
          {(() => {
            const freqText = frequencySummary(source.fetchFrequency);
            const delayText = delaySummary(source.fetchDelayDays);
            const parts = [freqText, delayText].filter(Boolean);
            return (
              <div className="flex items-center gap-1.5 mt-0.5">
                {parts.length > 0 && (
                  <span className="text-xs text-gray-600">
                    {parts.join(" · ") + "."}
                  </span>
                )}
                <button
                  type="button"
                  title="Schedule settings"
                  onClick={() => setSettingsOpen((v) => !v)}
                  disabled={busy}
                  className={`inline-flex items-center gap-1 text-xs disabled:opacity-40 transition-colors ${
                    settingsOpen
                      ? "text-blue-400"
                      : "text-gray-600 hover:text-gray-300"
                  }`}
                >
                  <Settings size={11} strokeWidth={2} />
                  {parts.length === 0 && (
                    <span>Schedule</span>
                  )}
                </button>
              </div>
            );
          })()}
          {source.trackingBranchExists && !source.fetchError && (
            <p className="text-xs text-gray-500 mt-0.5">
              {source.hasUpdates
                ? `${source.aheadCount} new commit${source.aheadCount === 1 ? "" : "s"} · tracking `
                : "Up to date · tracking "}
              <code className="bg-gray-700/60 px-1 rounded">{source.trackingBranch}</code>
            </p>
          )}
          {source.fetchError && (
            <p className="text-xs text-red-400 mt-1 break-words">{source.fetchError}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {/* Enable/disable toggle */}
          <button
            type="button"
            title={source.enabled ? "Disable source" : "Enable source"}
            onClick={() => onToggle(source.id, !source.enabled)}
            disabled={busy}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {source.enabled ? (
              <ToggleRight size={16} strokeWidth={2} className="text-blue-400" />
            ) : (
              <ToggleLeft size={16} strokeWidth={2} />
            )}
          </button>

          {/* Fetch */}
          <button
            type="button"
            title="Fetch this source"
            onClick={() => onFetch(source.id)}
            disabled={busy || !source.enabled}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} strokeWidth={2} />
          </button>

          {/* Create session — only when there are updates */}
          {source.hasUpdates && source.enabled && (
            <button
              type="button"
              title="Create merge session"
              onClick={() => onCreateSession(source.id)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
            >
              <GitMerge size={13} strokeWidth={2} />
              Merge
            </button>
          )}

          {/* Remove (non-builtin only) */}
          {!source.builtin && (
            <button
              type="button"
              title="Remove source"
              onClick={() => onRemove(source.id)}
              disabled={busy}
              className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {/* Schedule settings panel */}
      {settingsOpen && (
        <SourceSettingsPanel
          source={source}
          onSave={onSaveSettings}
          busy={busy}
        />
      )}

      {/* Changelog entries */}
      {source.trackingBranchExists && source.hasUpdates && (
        <div className="border-t border-gray-700/50">
          <button
            type="button"
            onClick={() => setChangelogOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 transition-colors"
          >
            {changelogOpen ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )}
            {source.changelogEntries.length > 0
              ? `${source.changelogEntries.length} new changelog entr${source.changelogEntries.length === 1 ? "y" : "ies"}`
              : "No new changelog files in these commits"}
          </button>
          {changelogOpen && source.changelogEntries.length > 0 && (
            <div className="px-3 pb-3 space-y-2">
              {source.changelogEntries.map((entry) => (
                <ChangelogEntryCard key={entry.filename} entry={entry} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add source form ──────────────────────────────────────────────────────────

interface AddSourceFormProps {
  onAdd: (name: string, url: string) => Promise<void>;
  busy: boolean;
}

function AddSourceForm({ onAdd, busy }: AddSourceFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onAdd(name.trim(), url.trim());
    setName("");
    setUrl("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-dashed border-gray-700 hover:border-gray-500 disabled:opacity-40 transition-colors w-full"
      >
        <Plus size={14} strokeWidth={2} />
        Add update source
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-blue-700/40 rounded-xl p-4 space-y-3 bg-gray-800/30"
    >
      <p className="text-sm font-medium text-gray-200">Add update source</p>
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Name (e.g. My App Layer)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
          className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
        />
        <input
          type="url"
          placeholder="Git URL (e.g. https://example.com/api/git)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={busy}
          className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
        />
      </div>
      <p className="text-xs text-gray-500">
        The source must expose a read-only git HTTP endpoint compatible with{" "}
        <code className="bg-gray-800 px-1 rounded">git fetch</code>. Only the{" "}
        <code className="bg-gray-800 px-1 rounded">main</code> branch is fetched.
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !name.trim() || !url.trim()}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
        >
          {busy ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : <Plus size={13} strokeWidth={2} />}
          Add source
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setName(""); setUrl(""); }}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UpdatesClient({ initialSources }: UpdatesClientProps) {
  const router = useRouter();
  const [sources, setSources] = useState<SourceStatus[]>(initialSources);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function clearFeedback() {
    setGlobalError(null);
    setSuccessMsg(null);
  }

  async function post<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
    try {
      const res = await fetch(withBasePath("/api/admin/updates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as T & { error?: string };
      if (!res.ok || (data as { error?: string }).error) {
        return { data: null, error: (data as { error?: string }).error ?? "Request failed" };
      }
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function handleFetchAll() {
    setBusy(true); clearFeedback();
    const { data, error } = await post<UpdatesResponse>({ action: "fetch-all" });
    if (error) setGlobalError(error);
    else if (data) {
      setSources(data.sources);
      const withUpdates = data.sources.filter((s) => s.hasUpdates).length;
      const failed = data.sources.filter((s) => s.fetchError).length;
      setSuccessMsg(
        failed > 0
          ? `Fetch complete with ${failed} error${failed === 1 ? "" : "s"}. Check source cards for details.`
          : withUpdates > 0
          ? `Fetched. ${withUpdates} source${withUpdates === 1 ? "" : "s"} have new commits.`
          : "All sources are up to date.",
      );
    }
    setBusy(false);
  }

  async function handleFetchSource(sourceId: string) {
    setBusy(true); clearFeedback();
    const { data, error } = await post<{ source: SourceStatus }>({ action: "fetch-source", sourceId });
    if (error) setGlobalError(error);
    else if (data) {
      setSources((prev) => prev.map((s) => (s.id === sourceId ? data.source : s)));
      setSuccessMsg(
        data.source.fetchError
          ? `Fetch failed for ${data.source.name}.`
          : data.source.hasUpdates
          ? `${data.source.name}: ${data.source.aheadCount} new commit${data.source.aheadCount === 1 ? "" : "s"}.`
          : `${data.source.name} is up to date.`,
      );
    }
    setBusy(false);
  }

  async function handleSaveSettings(sourceId: string, freq: FetchFrequency, delayDays: number) {
    setBusy(true); clearFeedback();
    const { data, error } = await post<UpdatesResponse>({
      action: "update-source-settings",
      sourceId,
      fetchFrequency: freq,
      fetchDelayDays: delayDays,
    });
    if (error) setGlobalError(error);
    else if (data) setSources(data.sources);
    setBusy(false);
  }

  async function handleToggle(sourceId: string, enabled: boolean) {
    setBusy(true); clearFeedback();
    const { data, error } = await post<UpdatesResponse>({ action: "toggle-source", sourceId, enabled });
    if (error) setGlobalError(error);
    else if (data) setSources(data.sources);
    setBusy(false);
  }

  async function handleRemove(sourceId: string) {
    const source = sources.find((s) => s.id === sourceId);
    if (!confirm(`Remove source "${source?.name ?? sourceId}"? This will also delete its git remote and tracking branch.`)) return;
    setBusy(true); clearFeedback();
    const { data, error } = await post<UpdatesResponse>({ action: "remove-source", sourceId });
    if (error) setGlobalError(error);
    else if (data) setSources(data.sources);
    setBusy(false);
  }

  async function handleCreateSession(sourceId: string) {
    setBusy(true); clearFeedback();
    const { data, error } = await post<{ sessionId: string }>({ action: "create-session", sourceId });
    if (error) { setGlobalError(error); setBusy(false); return; }
    if (data?.sessionId) {
      router.push(withBasePath(`/evolve/session/${data.sessionId}`));
    }
    setBusy(false);
  }

  async function handleAddSource(name: string, url: string) {
    setBusy(true); clearFeedback();
    const { data, error } = await post<{ source: SourceStatus }>({ action: "add-source", name, url });
    if (error) { setGlobalError(error); setBusy(false); return; }
    if (data) {
      setSources((prev) => [...prev, data.source]);
      setSuccessMsg(`Source "${name}" added.`);
    }
    setBusy(false);
  }

  const totalUpdates = sources.filter((s) => s.hasUpdates && s.enabled).length;

  return (
    <div className="space-y-6">
      {/* Global feedback */}
      {globalError && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span><span className="font-medium">Error: </span>{globalError}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm">
          <CheckCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Top-level actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-id="updates/fetch-all-btn"
          onClick={handleFetchAll}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white transition-colors"
        >
          {busy ? (
            <Loader size={14} strokeWidth={2} className="animate-spin" />
          ) : (
            <RefreshCw size={14} strokeWidth={2} />
          )}
          Fetch All Sources
        </button>

        {totalUpdates > 0 && (
          <span className="text-xs text-blue-300 bg-blue-900/30 border border-blue-700/40 px-2.5 py-1 rounded-full">
            {totalUpdates} source{totalUpdates === 1 ? "" : "s"} with updates
          </span>
        )}
      </div>

      {/* Source cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          Update sources
        </h2>
        <div className="space-y-3">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onFetch={handleFetchSource}
              onToggle={handleToggle}
              onRemove={handleRemove}
              onCreateSession={handleCreateSession}
              onSaveSettings={handleSaveSettings}
              busy={busy}
            />
          ))}
        </div>

        {/* Add source form */}
        <AddSourceForm onAdd={handleAddSource} busy={busy} />
      </section>

    </div>
  );
}
