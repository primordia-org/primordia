"use client";

// app/admin/updates/UpdatesClient.tsx
// Client component for the Fetch Updates admin panel.
// Lets admins pull upstream Primordia changes and create merge sessions.

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
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { UpdateStatusResponse, ChangelogEntry } from "@/app/api/admin/updates/route";

interface UpdatesClientProps {
  initialStatus: UpdateStatusResponse;
}

function ChangelogEntryCard({ entry }: { entry: ChangelogEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left bg-gray-800/60 hover:bg-gray-800 transition-colors"
      >
        {open ? (
          <ChevronDown size={14} strokeWidth={2} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-gray-400" />
        )}
        <span className="text-sm font-mono text-gray-200 truncate">{entry.filename}</span>
      </button>
      {open && (
        <div className="px-4 py-3 bg-gray-900/60 text-sm text-gray-300 whitespace-pre-wrap font-mono text-xs border-t border-gray-700 max-h-64 overflow-y-auto">
          {entry.content}
        </div>
      )}
    </div>
  );
}

export default function UpdatesClient({ initialStatus }: UpdatesClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState<UpdateStatusResponse>(initialStatus);
  const [fetching, setFetching] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleFetch() {
    setFetching(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(withBasePath("/api/admin/updates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch" }),
      });
      const data = (await res.json()) as UpdateStatusResponse & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Fetch failed");
      } else {
        setStatus(data);
        if (data.hasUpdates) {
          setSuccessMsg(
            `Fetched successfully. ${data.aheadCount} new commit${data.aheadCount === 1 ? "" : "s"} available.`,
          );
        } else {
          setSuccessMsg("Already up to date — no new commits.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  }

  async function handleCreateSession() {
    setCreatingSession(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(withBasePath("/api/admin/updates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-session" }),
      });
      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to create session");
      } else if (data.sessionId) {
        router.push(withBasePath(`/evolve/session/${data.sessionId}`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingSession(false);
    }
  }

  const { remoteConfigured, trackingBranchExists, aheadCount, changelogEntries, hasUpdates } =
    status;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
          !trackingBranchExists
            ? "bg-gray-800/50 border-gray-700 text-gray-400"
            : hasUpdates
            ? "bg-blue-900/30 border-blue-700/50"
            : "bg-green-900/30 border-green-700/50"
        }`}
      >
        {!trackingBranchExists ? (
          <CloudOff size={18} strokeWidth={2} className="shrink-0 mt-0.5 text-gray-500" />
        ) : hasUpdates ? (
          <Download size={18} strokeWidth={2} className="shrink-0 mt-0.5 text-blue-400" />
        ) : (
          <PackageCheck size={18} strokeWidth={2} className="shrink-0 mt-0.5 text-green-400" />
        )}
        <div>
          {!trackingBranchExists ? (
            <>
              <p className="font-medium text-gray-300">No upstream data yet</p>
              <p className="mt-0.5 text-gray-400">
                Click <strong>Fetch Updates</strong> to check for upstream changes from{" "}
                <code className="bg-gray-700 px-1 rounded text-xs">primordia.exe.xyz</code>.
              </p>
            </>
          ) : hasUpdates ? (
            <>
              <p className="font-medium text-blue-200">
                {aheadCount} new commit{aheadCount === 1 ? "" : "s"} available
              </p>
              <p className="mt-0.5 text-blue-300/80">
                The upstream Primordia instance is ahead of your local{" "}
                <code className="bg-blue-900/50 px-1 rounded text-xs">main</code>.
                Review the changes below, then create a merge session.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-green-200">Up to date</p>
              <p className="mt-0.5 text-green-300/80">
                Your local <code className="bg-green-900/50 px-1 rounded text-xs">main</code> is
                already at or ahead of the upstream version.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Feedback messages */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>
            <span className="font-medium">Error: </span>
            {error}
          </span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm">
          <CheckCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Actions */}
      <section className="space-y-3">
        <h2 className="text-base font-medium text-gray-200 flex items-center gap-2">
          <RefreshCw size={16} strokeWidth={2} />
          Actions
        </h2>

        <div className="flex flex-wrap gap-3">
          {/* Fetch button */}
          <button
            type="button"
            data-id="updates/fetch-btn"
            onClick={handleFetch}
            disabled={fetching || creatingSession}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {fetching ? (
              <Loader size={14} strokeWidth={2} className="animate-spin" />
            ) : (
              <RefreshCw size={14} strokeWidth={2} />
            )}
            {fetching ? "Fetching…" : "Fetch Updates"}
          </button>

          {/* Create session button — only shown when there are updates */}
          {hasUpdates && (
            <button
              type="button"
              data-id="updates/create-session-btn"
              onClick={handleCreateSession}
              disabled={fetching || creatingSession}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white transition-colors"
            >
              {creatingSession ? (
                <Loader size={14} strokeWidth={2} className="animate-spin" />
              ) : (
                <GitMerge size={14} strokeWidth={2} />
              )}
              {creatingSession ? "Creating session…" : "Create Merge Session"}
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500">
          <strong className="text-gray-400">Fetch Updates</strong> adds the{" "}
          <code className="bg-gray-800 px-1 rounded">primordia-updates</code> remote (
          <code className="bg-gray-800 px-1 rounded">
            https://primordia.exe.xyz/api/git
          </code>
          ) if needed, then fetches the upstream{" "}
          <code className="bg-gray-800 px-1 rounded">main</code> branch into a local
          tracking branch called{" "}
          <code className="bg-gray-800 px-1 rounded">primordia-updates-main</code>.
          <br />
          <strong className="text-gray-400 mt-1 block">Create Merge Session</strong> starts
          an AI-powered evolve session on a new branch. Claude will merge{" "}
          <code className="bg-gray-800 px-1 rounded">primordia-updates-main</code> into your{" "}
          <code className="bg-gray-800 px-1 rounded">main</code>, resolve conflicts, and
          verify the build. You can then preview and accept the result.
        </p>
      </section>

      {/* Changelog entries */}
      {trackingBranchExists && (
        <section className="space-y-3">
          <h2 className="text-base font-medium text-gray-200 flex items-center gap-2">
            <Download size={16} strokeWidth={2} />
            New changelog entries
            {changelogEntries.length > 0 && (
              <span className="ml-1 px-2 py-0.5 text-xs rounded-full bg-blue-700/60 text-blue-200 font-normal">
                {changelogEntries.length}
              </span>
            )}
          </h2>

          {changelogEntries.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              {hasUpdates
                ? "No new changelog files found in the upstream commits."
                : "No new entries — your local main is already up to date."}
            </p>
          ) : (
            <div className="space-y-2">
              {changelogEntries.map((entry) => (
                <ChangelogEntryCard key={entry.filename} entry={entry} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Remote info */}
      <section className="pt-4 border-t border-gray-800 space-y-1">
        <h3 className="text-sm font-medium text-gray-400">Remote details</h3>
        <div className="text-xs text-gray-500 space-y-0.5">
          <p>
            Remote name:{" "}
            <code className="bg-gray-800 px-1 rounded">primordia-updates</code>
            {remoteConfigured ? (
              <span className="ml-2 text-green-500">✓ configured</span>
            ) : (
              <span className="ml-2 text-gray-600">(will be added on first fetch)</span>
            )}
          </p>
          <p>
            Remote URL:{" "}
            <code className="bg-gray-800 px-1 rounded text-gray-400">
              https://primordia.exe.xyz/api/git
            </code>
          </p>
          <p>
            Tracking branch:{" "}
            <code className="bg-gray-800 px-1 rounded">primordia-updates-main</code>
            {trackingBranchExists ? (
              <span className="ml-2 text-green-500">✓ exists</span>
            ) : (
              <span className="ml-2 text-gray-600">(created on first fetch)</span>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
