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
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { SourceStatus, UpdatesResponse, ChangelogEntry } from "@/app/api/admin/updates/route";

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

interface SourceCardProps {
  source: SourceStatus;
  onFetch: (sourceId: string) => Promise<void>;
  onToggle: (sourceId: string, enabled: boolean) => Promise<void>;
  onRemove: (sourceId: string) => Promise<void>;
  onCreateSession: (sourceId: string) => Promise<void>;
  busy: boolean;
}

function SourceCard({ source, onFetch, onToggle, onRemove, onCreateSession, busy }: SourceCardProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);

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

        {/* Name + URL */}
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
