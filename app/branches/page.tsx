// app/branches/page.tsx
// Shows local branches as a git log --graph-inspired view. Production history
// and active branch descendants are rendered as one connected graph, with newer
// branch tips above their parents so the graph visually grows upward.

import { spawnSync } from "child_process";
import { headers } from "next/headers";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import type { EvolveSession } from "@/lib/db/types";
import { listSessionsFromFilesystem } from "@/lib/session-events";
import { PageNavBar } from "@/components/PageNavBar";
import { CreateSessionFromBranchButton } from "./CreateSessionFromBranchButton";
import { buildPageTitle } from "@/lib/page-title";
import { getSessionUser, isAdmin, hasEvolvePermission } from "@/lib/auth";
import { getBranchParentSource, getEvolvePrefs } from "@/lib/user-prefs";
import { withBasePath } from "@/lib/base-path";
import { getBranchParent, type BranchParentSource } from "@/lib/branch-parent";
import {
  computeBranchGraphLayout,
  computeBranchGraphUnicodeRows,
  type BranchGraphMergeEdge,
} from "@/lib/branch-graph-layout";
import { BranchParentSourceToggle } from "./BranchParentSourceToggle";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Branches") };
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BranchData {
  name: string;
  /** True if this branch is currently checked out in the main repo. */
  isCurrent: boolean;
  /** True if this branch is the configured production branch. */
  isProduction: boolean;
  /** Recorded branch parent branch name, or null if unknown. */
  parent: string | null;
  /**
   * Parent used for the active branch tree. Accepted session branches are
   * skipped over so live work remains attached to the nearest active ancestor.
   */
  activeParent: string | null;
  /** Preview server URL if a session is active, null otherwise. */
  previewUrl: string | null;
  /** Session status, or null if no session is active for this branch. */
  sessionStatus: string | null;
  /** True if an evolve session exists for this branch. */
  hasSession: boolean;
  /** Full commit hash at this branch tip, for merge-edge detection. */
  tipSha: string | null;
  /** Branch marker commit hash, for merge-edge scan ranges. */
  markerSha: string | null;
  /** Branch marker unix timestamp, for graph layout ordering. */
  markerTimestamp: number | null;
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

async function getBranchData(parentSource: BranchParentSource): Promise<{
  branches: BranchData[];
  productionBranch: string;
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

  const productionBranch =
    gitConfigValue("primordia.productionBranch", cwd) ?? "main";

  // Load all evolve sessions from the filesystem and build a lookup by branch name.
  const fsSessions = listSessionsFromFilesystem(cwd);
  const sessionByBranch = new Map(fsSessions.map((s) => [s.branch, s]));

  const diag: DiagnosticInfo = {
    cwd,
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    gitVersion,
    branchList,
    currentBranch: currentBranchResult,
    activeSessions: fsSessions.length,
    sessions: fsSessions,
  };

  const branchesWithRecordedParents: BranchData[] = allBranchNames
    // Skip the historical main alias and branches with slashes (slashes are not
    // supported for preview or session URLs).
    .filter((name) => name !== 'main' && !name.includes('/'))
    .map((name) => {
      const parent = getBranchParent(name, cwd, parentSource)?.parentBranch ?? null;
      const session = sessionByBranch.get(name);
      const tipSha = runGit(["rev-parse", name], cwd);
      const markerInfo = runGit([
        "log",
        name,
        "--first-parent",
        "--grep",
        "^Branched-From:",
        "--format=%ct %H",
        "-n",
        "1",
      ], cwd);
      const [markerTimestampText, markerSha] = markerInfo.stdout.split(/\s+/, 2);
      const markerTimestamp = Number.parseInt(markerTimestampText ?? "", 10);
      return {
        name,
        isCurrent: name === current,
        isProduction: name === productionBranch,
        parent,
        activeParent: parent,
        previewUrl: session?.previewUrl ?? null,
        sessionStatus: session?.status ?? null,
        hasSession: session !== undefined,
        tipSha: tipSha.code === 0 && tipSha.stdout ? tipSha.stdout : null,
        markerSha: markerInfo.code === 0 && markerSha ? markerSha : null,
        markerTimestamp: Number.isNaN(markerTimestamp) ? null : markerTimestamp,
      };
    });

  const byName = new Map(branchesWithRecordedParents.map((b) => [b.name, b]));

  function isGitAncestor(ancestor: string, descendant: string): boolean {
    if (ancestor === descendant) return true;
    return runGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd).code === 0;
  }

  function skipAcceptedParents(parent: string | null, visited = new Set<string>()): string | null {
    if (!parent || visited.has(parent)) return parent;
    visited.add(parent);
    const parentBranch = byName.get(parent);
    if (!parentBranch) return parent;
    if (parentBranch.sessionStatus === "accepted" && !parentBranch.isProduction) {
      if (productionBranch && isGitAncestor(parent, productionBranch)) {
        return productionBranch;
      }
      return skipAcceptedParents(parentBranch.parent, visited);
    }
    return parent;
  }

  const branches = branchesWithRecordedParents.map((branch) => ({
    ...branch,
    activeParent: skipAcceptedParents(branch.parent),
  }));

  return { branches, productionBranch, diag };
}

// ─── Status display helpers ──────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["accepted", "rejected"]);

const STATUS_COLOR: Record<string, string> = {
  ready: "text-green-400",
  "running-claude": "text-yellow-400",
  "starting-server": "text-yellow-400",
  starting: "text-gray-400",
  error: "text-red-400",
  accepted: "text-gray-600",
  rejected: "text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "ready",
  "running-claude": "running agent…",
  "starting-server": "starting server…",
  starting: "starting…",
  error: "error",
  accepted: "accepted",
  rejected: "rejected",
};

// ─── Unicode graph rendering ───────────────────────────────────────────────────

function buildMergeEdges(branches: BranchData[], cwd: string): BranchGraphMergeEdge[] {
  const branchByTip = new Map(
    branches
      .filter((branch) => branch.tipSha)
      .map((branch) => [branch.tipSha!, branch.name]),
  );
  const edges: BranchGraphMergeEdge[] = [];
  const seen = new Set<string>();

  for (const target of branches) {
    const range = target.markerSha ? `${target.markerSha}..${target.name}` : target.name;
    const mergeParents = runGit(
      ["log", range, "--first-parent", "--merges", "--format=%P"],
      cwd,
    );
    if (mergeParents.code !== 0 || !mergeParents.stdout) continue;

    for (const line of mergeParents.stdout.split("\n")) {
      const parents = line.trim().split(/\s+/).filter(Boolean);
      for (const mergedParentSha of parents.slice(1)) {
        const mergedBranch = branchByTip.get(mergedParentSha);
        if (!mergedBranch || mergedBranch === target.name) continue;
        const key = `${mergedBranch}\0${target.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: mergedBranch, to: target.name });
      }
    }
  }

  return edges;
}

function GraphGlyphs({ graph, isActive }: { graph: string; isActive: boolean }) {
  return (
    <span>
      {Array.from(graph).map((char, index) => (
        <span
          // Graph strings are tiny and static per render; index is stable here.
          key={`${char}-${index}`}
          className={char === "●" ? (isActive ? "text-green-400" : "text-gray-500") : "text-gray-600"}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

function BranchRef({
  branch,
  currentServerUrl,
  canCreateSession,
}: {
  branch: BranchData;
  currentServerUrl: string;
  canCreateSession: boolean;
}) {
  const url = branch.isProduction ? currentServerUrl : branch.previewUrl;
  const statusColor = branch.sessionStatus
    ? (STATUS_COLOR[branch.sessionStatus] ?? "text-gray-400")
    : "";
  const statusLabel = branch.sessionStatus
    ? (STATUS_LABEL[branch.sessionStatus] ?? branch.sessionStatus)
    : null;
  const isTerminal = TERMINAL_STATUSES.has(branch.sessionStatus ?? "");
  const className = branch.isProduction
    ? "text-white font-bold hover:text-gray-200"
    : branch.isCurrent
      ? "text-white font-bold hover:text-gray-200"
      : isTerminal
        ? "text-gray-600 hover:text-gray-500"
        : "text-gray-300 hover:text-gray-100";

  const label = (
    <>
      {branch.name}
      {branch.isProduction && (
        <span className="text-blue-400 font-normal ml-1">(production)</span>
      )}
      {branch.isCurrent && !branch.isProduction && (
        <span className="text-gray-500 font-normal ml-1">(current)</span>
      )}
    </>
  );

  return (
    <span className="inline-flex items-baseline gap-1.5">
      {branch.hasSession ? (
        <Link href={`/evolve/session/${branch.name}`} className={className}>
          {label}
        </Link>
      ) : (
        <span className={className.replace(/ hover:[^ ]+/g, "")}>{label}</span>
      )}
      {statusLabel && !branch.isProduction && (
        <span className={`text-xs shrink-0 ${statusColor}`}>[{statusLabel}]</span>
      )}
      {canCreateSession &&
        !branch.hasSession &&
        !branch.isCurrent &&
        !branch.isProduction &&
        !isTerminal && <CreateSessionFromBranchButton branchName={branch.name} />}
      {url && (
        <a
          href={url}
          target={branch.isCurrent ? "_self" : "_blank"}
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 shrink-0 inline-flex items-center"
          title={branch.isProduction ? "View site" : "Open preview"}
        >
          <ExternalLink size={13} strokeWidth={2} />
        </a>
      )}
    </span>
  );
}

function BranchStructureGraph({
  branches,
  productionBranch,
  currentServerUrl,
  canCreateSession,
  cwd,
}: {
  branches: BranchData[];
  productionBranch: string;
  currentServerUrl: string;
  canCreateSession: boolean;
  cwd: string;
}) {
  const byName = new Map(branches.map((branch) => [branch.name, branch]));
  const layout = computeBranchGraphLayout(
    branches.map((branch) => ({
      name: branch.name,
      parent: branch.parent,
      markerTimestamp: branch.markerTimestamp,
    })),
    productionBranch,
  );
  const rows = computeBranchGraphUnicodeRows(layout, buildMergeEdges(branches, cwd));

  return (
    <div className="overflow-x-auto pb-1 font-mono text-sm">
      {rows.map((row, index) => {
        if (row.kind === "connector") {
          return (
            <div
              key={`connector-${index}-${row.graph}`}
              className="min-w-max whitespace-pre leading-4 text-gray-600 select-none"
            >
              {row.graph}
            </div>
          );
        }

        const branch = byName.get(row.branchName);
        if (!branch) return null;
        return (
          <div
            key={`branch-${branch.name}`}
            className="flex min-w-max items-baseline gap-1.5 whitespace-nowrap leading-7"
          >
            <span className="whitespace-pre select-none shrink-0">
              <GraphGlyphs graph={row.graph} isActive={branch.isProduction || Boolean(branch.previewUrl)} />
            </span>
            <BranchRef
              branch={branch}
              currentServerUrl={currentServerUrl}
              canCreateSession={canCreateSession}
            />
          </div>
        );
      })}
    </div>
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
  const user = await getSessionUser();
  const [userIsAdmin, userCanEvolve, evolvePrefs, parentSource] = user
    ? await Promise.all([isAdmin(user.id), hasEvolvePermission(user.id), getEvolvePrefs(user.id), getBranchParentSource(user.id)])
    : [false, false, null, await getBranchParentSource(null)];

  const { branches, productionBranch, diag } = await getBranchData(parentSource);

  const [headerStore] = await Promise.all([headers()]);
  const sessionUser = user
    ? { id: user.id, username: user.username, isAdmin: userIsAdmin }
    : null;
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  const host =
    headerStore.get("x-forwarded-host") ??
    headerStore.get("host") ??
    `localhost:${process.env.PORT ?? "3000"}`;
  const currentServerUrl = `${proto}://${host}`;

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">

      {/* Header */}
      <PageNavBar
        subtitle="Local Branches"
        currentPage="branches"
        initialSession={sessionUser}
        initialHarness={evolvePrefs?.initialHarness}
        initialModel={evolvePrefs?.initialModel}
        initialCavemanMode={evolvePrefs?.initialCavemanMode}
        initialCavemanIntensity={evolvePrefs?.initialCavemanIntensity}
      />

      <BranchParentSourceToggle
        initialSource={parentSource}
        disabled={!user}
      />

      {/* ── Connected production graph ── */}

      <div className="mt-2">
        <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mb-2">
          Branch Graph
        </p>
        {branches.length > 0 ? (
          <BranchStructureGraph
            branches={branches}
            productionBranch={productionBranch}
            currentServerUrl={currentServerUrl}
            canCreateSession={userCanEvolve}
            cwd={diag.cwd}
          />
        ) : (
          <p className="text-gray-500 text-sm font-mono">
            No production branch found.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="mt-8 border-t border-gray-800 pt-4 text-xs text-gray-600 font-mono space-y-1">
        <p>
          ● green = preview server active · ● dim = no active session · unicode
          connectors show branch parentage and merge hints · branch name links to session ·{" "}
          <span className="text-blue-400"><ExternalLink size={10} className="inline" /></span> = open
          branch · <span className="text-purple-500">+ session</span> = start new
          session on existing branch
        </p>
        <p>
          Clone:{" "}
          <span className="text-gray-400 select-all">
            {currentServerUrl}{withBasePath("/api/git")}
          </span>
        </p>
      </div>

      {/* Diagnostics — only shown to admins */}
      {userIsAdmin && (
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
            <p>
              <span className="text-gray-400">production branch:</span>{" "}
              <span className="text-blue-400">{productionBranch}</span>
            </p>
            <GitResultRow label="git --version" result={diag.gitVersion} />
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
                            href={`/evolve/session/${s.branch}`}
                            className="text-purple-400 hover:text-purple-300"
                          >
                            {s.branch}
                          </Link>
                        </td>
                        <td className="pr-4">{s.branch}</td>
                        <td
                          className={`pr-4 ${STATUS_COLOR[s.status] ?? "text-gray-400"}`}
                        >
                          {s.status}
                        </td>
                        <td>
                          {s.port ?? (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </details>
      )}
    </main>
  );
}
