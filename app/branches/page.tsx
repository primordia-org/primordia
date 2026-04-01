// app/branches/page.tsx
// Shows all local git branches as a tree rooted at the current branch, with
// links to active preview servers. Only meaningful in development mode.
//
// Implemented as a React Server Component — data is fetched directly on the
// server, no separate API route needed. This also makes diagnostics trivial
// since all git output and process state are available inline.

import { spawnSync } from "child_process";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import type { EvolveSession } from "@/lib/db/types";
import { PageNavBar } from "@/components/PageNavBar";
import { PruneBranchesButton } from "@/components/PruneBranchesButton";
import { buildPageTitle } from "@/lib/page-title";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Branches") };
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BranchData {
  name: string;
  /** True if this branch is currently checked out in the main repo. */
  isCurrent: boolean;
  /** Value of git config branch.<name>.parent — set by the local evolve flow. */
  parent: string | null;
  /** Preview server URL if a session is active, null otherwise. */
  previewUrl: string | null;
  /** Session status, or null if no session is active for this branch. */
  sessionStatus: string | null;
  /** Evolve session ID, or null if no session exists for this branch. */
  sessionId: string | null;
}

interface BranchNode extends BranchData {
  children: BranchNode[];
}

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
  spawnError: string | null;
}

interface DiagnosticInfo {
  cwd: string;
  nodeEnv: string;
  gitVersion: GitResult;
  branchList: GitResult;
  currentBranch: GitResult;
  activeSessions: number;
  sessions: EvolveSession[];
}

// ─── Git helpers ───────────────────────────────────────────────────────────────

function runGit(args: string[], cwd: string): GitResult {
  try {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return {
      stdout: (result.stdout ?? "").trim(),
      stderr: (result.stderr ?? "").trim(),
      code: result.status ?? 1,
      spawnError: result.error ? result.error.message : null,
    };
  } catch (err) {
    return {
      stdout: "",
      stderr: "",
      code: 1,
      spawnError: err instanceof Error ? err.message : String(err),
    };
  }
}

function gitConfigValue(key: string, cwd: string): string | null {
  const r = runGit(["config", key], cwd);
  return r.code === 0 && r.stdout ? r.stdout : null;
}

// ─── Data fetching ──────────────────────────────────────────────────────────────

async function getBranchData(): Promise<{
  branches: BranchData[];
  diag: DiagnosticInfo;
}> {
  const cwd = process.cwd();

  const gitVersion = runGit(["--version"], cwd);
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const currentBranchResult = runGit(["branch", "--show-current"], cwd);

  const allBranchNames = branchList.stdout
    ? branchList.stdout.split("\n").filter(Boolean)
    : [];
  const current = currentBranchResult.stdout || "main";

  // Load all evolve sessions from SQLite and build a lookup by branch name.
  const db = await getDb();
  const dbSessions = await db.listEvolveSessions();
  const sessionByBranch = new Map(dbSessions.map((s) => [s.branch, s]));

  const diag: DiagnosticInfo = {
    cwd,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    gitVersion,
    branchList,
    currentBranch: currentBranchResult,
    activeSessions: dbSessions.length,
    sessions: dbSessions,
  };

  const branches: BranchData[] = allBranchNames.map((name) => {
    const parent = gitConfigValue(`branch.${name}.parent`, cwd);
    const session = sessionByBranch.get(name);
    return {
      name,
      isCurrent: name === current,
      parent,
      previewUrl: session?.previewUrl ?? null,
      sessionStatus: session?.status ?? null,
      sessionId: session?.id ?? null,
    };
  });

  // Sort: main first, evolve/* alphabetically, then any other branches
  branches.sort((a, b) => {
    if (a.name === "main") return -1;
    if (b.name === "main") return 1;
    const aE = a.name.startsWith("evolve/");
    const bE = b.name.startsWith("evolve/");
    if (aE && !bE) return -1;
    if (!aE && bE) return 1;
    return a.name.localeCompare(b.name);
  });

  return { branches, diag };
}

// ─── Tree builder ───────────────────────────────────────────────────────────────

function buildTree(branches: BranchData[]): BranchNode[] {
  const byName = new Map<string, BranchNode>(
    branches.map((b) => [b.name, { ...b, children: [] }]),
  );
  const roots: BranchNode[] = [];

  for (const node of byName.values()) {
    if (node.name === "main") {
      roots.unshift(node);
    } else if (node.parent && byName.has(node.parent)) {
      byName.get(node.parent)!.children.push(node);
    } else if (node.parent && !byName.has(node.parent)) {
      const main = byName.get("main");
      if (main) main.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const node of byName.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return roots;
}

// ─── Status display helpers ──────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  ready: "text-green-400",
  "running-claude": "text-yellow-400",
  "starting-server": "text-yellow-400",
  starting: "text-gray-400",
  error: "text-red-400",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "ready",
  "running-claude": "running claude…",
  "starting-server": "starting server…",
  starting: "starting…",
  error: "error",
};

// ─── Recursive branch row ───────────────────────────────────────────────────────

function BranchRow({
  node,
  depth,
  linePrefix,
  isLast,
  currentServerUrl,
}: {
  node: BranchNode;
  depth: number;
  linePrefix: string;
  isLast: boolean;
  currentServerUrl: string;
}) {
  const isRoot = depth === 0;
  const connector = isRoot ? "" : isLast ? "└── " : "├── ";
  const childLinePrefix = isRoot
    ? ""
    : linePrefix + (isLast ? "    " : "│   ");

  // This server instance only knows about sessions it spawned (its own children).
  // The current branch of this server is shown with the server's own URL.
  const url = node.isCurrent ? currentServerUrl : node.previewUrl;
  const statusColor = node.sessionStatus
    ? (STATUS_COLOR[node.sessionStatus] ?? "text-gray-400")
    : "";
  const statusLabel = node.sessionStatus
    ? (STATUS_LABEL[node.sessionStatus] ?? node.sessionStatus)
    : null;

  return (
    <>
      <div className="flex items-baseline gap-1.5 font-mono text-sm leading-7 flex-wrap">
        {!isRoot && (
          <span className="text-gray-600 whitespace-pre select-none shrink-0">
            {linePrefix + connector}
          </span>
        )}
        <span className={url ? "text-green-400 shrink-0" : "text-gray-600 shrink-0"}>
          ●
        </span>
        <span className={node.isCurrent ? "text-white font-bold" : "text-gray-300"}>
          {node.name}
          {node.isCurrent && (
            <span className="text-gray-500 font-normal ml-1">(current)</span>
          )}
        </span>
        {statusLabel && !node.isCurrent && (
          <span className={`text-xs shrink-0 ${statusColor}`}>
            [{statusLabel}]
          </span>
        )}
        {node.sessionId && (
          <Link
            href={`/evolve/session/${node.sessionId}`}
            className="text-purple-400 hover:text-purple-300 text-xs ml-1 shrink-0"
          >
            session ↗
          </Link>
        )}
        {url && (
          <a
            href={url}
            target={node.isCurrent ? "_self" : "_blank"}
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-xs ml-1 shrink-0"
          >
            {url} ↗
          </a>
        )}
      </div>
      {node.children.map((child, i) => (
        <BranchRow
          key={child.name}
          node={child}
          depth={depth + 1}
          linePrefix={childLinePrefix}
          isLast={i === node.children.length - 1}
          currentServerUrl={currentServerUrl}
        />
      ))}
    </>
  );
}

// ─── Diagnostic result row helper ────────────────────────────────────────────────

function GitResultRow({
  label,
  result,
}: {
  label: string;
  result: GitResult;
}) {
  return (
    <div>
      <p className="text-gray-400">
        {label}{" "}
        <span
          className={
            result.code === 0 ? "text-green-600" : "text-red-400"
          }
        >
          (exit {result.code})
        </span>
        {result.spawnError && (
          <span className="text-red-400"> — spawn error: {result.spawnError}</span>
        )}
      </p>
      {result.stdout && (
        <pre className="text-green-600 whitespace-pre-wrap pl-2">
          {result.stdout}
        </pre>
      )}
      {result.stderr && (
        <pre className="text-red-400 whitespace-pre-wrap pl-2">
          stderr: {result.stderr}
        </pre>
      )}
      {!result.stdout && !result.stderr && !result.spawnError && (
        <pre className="text-gray-700 pl-2">(no output)</pre>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default async function BranchesPage() {
  if (process.env.NODE_ENV !== "development") {
    return (
      <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
        <p className="text-red-400 text-sm">
          Branches page is only available in development mode.
        </p>
      </main>
    );
  }

  const { branches, diag } = await getBranchData();
  const tree = buildTree(branches);

  // Compute the public-facing URL for this server instance using forwarded headers,
  // matching the pattern used in app/api/auth/exe-dev/route.ts (getPublicOrigin).
  // When running behind exe.dev's proxy, x-forwarded-proto/host give the real URL.
  // Falls back to http://localhost:PORT for plain local dev.
  const [headerStore, sessionUser] = await Promise.all([
    headers(),
    getSessionUser(),
  ]);
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    `localhost:${process.env.PORT ?? "3000"}`;
  const currentServerUrl = `${proto}://${host}`;

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">

      {/* Header — session resolved server-side so the hamburger is instant */}
      <PageNavBar subtitle="Local Branches" currentPage="branches" initialSession={sessionUser} />

      {/* Actions row */}
      <div className="flex items-center gap-2 mt-3 mb-4">
        <PruneBranchesButton />
      </div>

      {/* Branch tree or empty state */}
      {tree.length === 0 ? (
        <p className="text-gray-500 text-sm font-mono">
          No local branches found.
        </p>
      ) : (
        <div className="space-y-0">
          {tree.map((node, i) => (
            <BranchRow
              key={node.name}
              node={node}
              depth={0}
              linePrefix=""
              isLast={i === tree.length - 1}
              currentServerUrl={currentServerUrl}
            />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 border-t border-gray-800 pt-4 text-xs text-gray-600 font-mono space-y-1">
        <p>● green = preview server active · ● dim = no active session · <span className="text-purple-400">session ↗</span> = view evolve session</p>
        <p>Development mode only</p>
      </div>

      {/* Diagnostics — always visible to help debug empty/unexpected output */}
      <details className="mt-6 text-xs font-mono open:ring-1 open:ring-gray-800 open:rounded open:p-3">
        <summary className="text-gray-600 cursor-pointer hover:text-gray-400 select-none py-1">
          Diagnostics ({branches.length} branch
          {branches.length === 1 ? "" : "es"} found,{" "}
          {diag.activeSessions} active session
          {diag.activeSessions === 1 ? "" : "s"})
        </summary>
        <div className="mt-3 space-y-3 text-gray-500">
          <p>
            <span className="text-gray-400">cwd:</span> {diag.cwd}
          </p>
          <p>
            <span className="text-gray-400">NODE_ENV:</span> {diag.nodeEnv}
          </p>
          <GitResultRow
            label="git --version"
            result={diag.gitVersion}
          />
          <GitResultRow
            label="git branch --format=%(refname:short)"
            result={diag.branchList}
          />
          <GitResultRow
            label="git branch --show-current"
            result={diag.currentBranch}
          />
          <div>
            <p className="text-gray-400">
              evolve sessions ({diag.sessions.length})
            </p>
            {diag.sessions.length === 0 ? (
              <pre className="text-gray-700 pl-2">(none)</pre>
            ) : (
              <table className="mt-1 pl-2 w-full border-collapse">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left pr-4 font-normal">id</th>
                    <th className="text-left pr-4 font-normal">branch</th>
                    <th className="text-left pr-4 font-normal">status</th>
                    <th className="text-left font-normal">port</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.sessions.map((s) => (
                    <tr key={s.id} className="text-gray-400">
                      <td className="pr-4">
                        <Link
                          href={`/evolve/session/${s.id}`}
                          className="text-purple-400 hover:text-purple-300"
                        >
                          {s.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="pr-4">{s.branch}</td>
                      <td className={`pr-4 ${STATUS_COLOR[s.status] ?? "text-gray-400"}`}>
                        {s.status}
                      </td>
                      <td>{s.port ?? <span className="text-gray-700">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </details>
    </main>
  );
}
