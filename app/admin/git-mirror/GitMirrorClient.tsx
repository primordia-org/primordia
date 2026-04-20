"use client";

// components/GitMirrorClient.tsx
// Admin panel for configuring a git mirror remote.
//
// When a remote named "mirror" exists in the repo, every production deploy
// automatically runs `git push mirror` after advancing the main branch pointer.
//
// This component lets admins add or remove the mirror remote directly from the
// browser — no SSH required. The API route runs the git commands on the server.

import { useState } from "react";
import { CheckCircle, Circle, GitBranch, ExternalLink, Loader, Trash2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

interface GitMirrorClientProps {
  /** The current URL of the "mirror" remote, or null if none is configured. */
  mirrorUrl: string | null;
}

export default function GitMirrorClient({ mirrorUrl: initialMirrorUrl }: GitMirrorClientProps) {
  const [mirrorUrl, setMirrorUrl] = useState(initialMirrorUrl);
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hasMirror = mirrorUrl !== null;

  async function handleSetMirror(e: React.FormEvent) {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(withBasePath("/api/admin/git-mirror"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Unknown error");
      } else {
        setMirrorUrl(url);
        setUrlInput("");
        setSuccessMsg("Mirror configured and initial push succeeded.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMirror() {
    if (!confirm("Remove the mirror remote? Future deploys will no longer push to it.")) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(withBasePath("/api/admin/git-mirror"), { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Unknown error");
      } else {
        setMirrorUrl(null);
        setSuccessMsg("Mirror remote removed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div
        className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
          hasMirror
            ? "bg-green-900/30 border-green-700/50"
            : "bg-gray-800/50 border-gray-700 text-gray-400"
        }`}
      >
        {hasMirror ? (
          <CheckCircle size={18} strokeWidth={2} className="shrink-0 mt-0.5 text-green-400" aria-hidden="true" />
        ) : (
          <Circle size={18} strokeWidth={2} className="shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div>
          {hasMirror ? (
            <>
              <p className="font-medium text-green-200">Mirror remote is configured</p>
              <p className="mt-0.5 text-green-400 font-mono text-xs break-all">{mirrorUrl}</p>
              <p className="mt-1 text-green-300/80">
                Every production deploy automatically runs{" "}
                <code className="bg-green-900/50 px-1 rounded">git push mirror</code>.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-gray-300">No mirror remote configured</p>
              <p className="mt-0.5">
                Follow the steps below to start mirroring every production deploy to an
                external git host.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Feedback messages */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          <span className="font-medium">Error: </span>{error}
        </div>
      )}
      {successMsg && (
        <div className="px-4 py-3 rounded-lg bg-green-900/30 border border-green-700/50 text-green-300 text-sm">
          ✅ {successMsg}
        </div>
      )}

      {/* Instructions + form */}
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-3 flex items-center gap-2">
          <GitBranch size={16} strokeWidth={2} aria-hidden="true" />
          {hasMirror ? "Update or remove mirror" : "Set up a git mirror"}
        </h2>

        <ol className="space-y-5 text-sm text-gray-300 mb-6">
          {/* Step 1 */}
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-700/60 border border-blue-500/50 text-blue-300 text-xs font-bold flex items-center justify-center mt-0.5">
              1
            </span>
            <div className="flex-1 space-y-1">
              <p className="font-medium text-gray-200">Create a repository on GitHub</p>
              <p className="text-gray-400">
                Go to GitHub and create a new repository. Leave it empty — no README,
                no initial commits.
              </p>
            </div>
          </li>

          {/* Step 2 */}
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-700/60 border border-blue-500/50 text-blue-300 text-xs font-bold flex items-center justify-center mt-0.5">
              2
            </span>
            <div className="flex-1 space-y-2">
              <p className="font-medium text-gray-200">
                Enable the exe.dev GitHub Integration
              </p>
              <p className="text-gray-400">
                The{" "}
                <a
                  href="https://exe.dev/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-id="git-mirror/integration-link"
                  className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-1"
                >
                  exe.dev GitHub Integration
                  <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
                </a>{" "}
                gives your server an authenticated push URL for your GitHub repository.
                Follow the integration setup, then copy the push URL it provides — it
                looks like:
              </p>
              <p className="font-mono text-xs text-gray-500 bg-gray-900 border border-gray-700 rounded px-3 py-2 break-all">
                https://your-server-github.int.exe.xyz/owner/repo.git
              </p>
            </div>
          </li>

          {/* Step 3 */}
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-700/60 border border-blue-500/50 text-blue-300 text-xs font-bold flex items-center justify-center mt-0.5">
              3
            </span>
            <div className="flex-1 space-y-3">
              <p className="font-medium text-gray-200">
                Paste the repository URL and activate the mirror
              </p>
              <p className="text-gray-400">
                The server will add the mirror remote and do an initial push to verify
                the connection.
              </p>
              <form onSubmit={handleSetMirror} className="flex gap-2">
                <input
                  data-id="git-mirror/url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    // Strip "git clone " prefix that users may accidentally paste
                    const val = e.target.value.replace(/^git\s+clone\s+/i, "");
                    setUrlInput(val);
                  }}
                  placeholder="https://your-server-github.int.exe.xyz/owner/repo.git"
                  required
                  disabled={loading}
                  className="flex-1 min-w-0 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                />
                <button
                  data-id="git-mirror/save-mirror"
                  type="submit"
                  disabled={loading || !urlInput.trim()}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 text-white disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
                      Pushing…
                    </>
                  ) : (
                    hasMirror ? "Update mirror" : "Set mirror"
                  )}
                </button>
              </form>
              <p className="text-xs text-gray-500">
                This runs{" "}
                <code className="bg-gray-800 px-1 rounded">
                  git remote add --mirror=push mirror &lt;url&gt;
                </code>{" "}
                followed by{" "}
                <code className="bg-gray-800 px-1 rounded">git push mirror</code>{" "}
                on the server.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* Remove section */}
      {hasMirror && (
        <section className="pt-4 border-t border-gray-800">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Remove mirror</h3>
          <p className="text-sm text-gray-500 mb-3">
            Removes the mirror remote from the server. Future deploys will no longer
            push to it. This does not delete the remote repository.
          </p>
          <button
            data-id="git-mirror/remove-mirror"
            type="button"
            onClick={handleRemoveMirror}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 text-red-300 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            )}
            Remove mirror
          </button>
        </section>
      )}
    </div>
  );
}
