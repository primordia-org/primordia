// app/branches/page.tsx
// Shows branches in two sections:
//   1. Active — the production branch and any non-terminal (not accepted/rejected)
//      children/grandchildren. This is the "live" work in progress.
//   2. Past Sessions — the chain of past production slots (blue-green ancestry),
//      most recent first, each with any accepted/rejected sibling branches nested
//      beneath them.

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
import { getEvolvePrefs } from "@/lib/user-prefs";
import { withBasePath } from "@/lib/base-path";

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
  /** Value of git config branch.<name>.parent — set by the local evolve flow. */
  parent: string | null;
  /** Preview server URL if a session is active, null otherwise. */
  previewUrl: string | null;
  /** Session status, or null if no session is active for this branch. */
  sessionStatus: string | null;
  /** True if an evolve session exists for this branch. */
  hasSession: boolean;
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

interface PastSlot {
  branch: BranchData;
  /** Non-chain branches that had this slot as their parent. */
  children: BranchNode[];
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

  const branches: BranchData[] = allBranchNames
    // Skip branches with slashes — not supported for preview or session URLs.
    .filter((name) => !name.includes('/'))
    .map((name) => {
      const parent = gitConfigValue(`branch.${name}.parent`, cwd);
      const session = sessionByBranch.get(name);
      return {
        name,
        isCurrent: name === current,
        isProduction: name === productionBranch,
        parent,
        previewUrl: session?.previewUrl ?? null,
        sessionStatus: session?.status ?? null,
        hasSession: session !== undefined,
      };
    });

  return { branches, productionBranch, diag };
}

// ─── Section builder ────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["accepted", "rejected"]);

/**
 * Builds three sections from the flat branch list:
 *
 * - `activeProd`: the production branch as a tree root, with only non-terminal
 *   (not accepted/rejected) children/grandchildren nested under it.
 *
 * - `pastSlots`: the chain of past production slots (parent → grandparent → …),
 *   ordered most-recent-first. Each slot includes its non-chain sibling branches
 *   (any branch whose parent was that slot, excluding the branch that was
 *   blue-green-promoted to the next slot).
 *
 * - `unattached`: branches with no `parent` config and no connection to the
 *   production chain — e.g. manually created branches/worktrees.
 */
function buildSections(
  branches: BranchData[],
  productionBranchName: string,
): {
  activeProd: BranchNode | null;
  pastSlots: PastSlot[];
  unattached: BranchData[];
} {
  const byName = new Map<string, BranchData>(
    branches.map((b) => [b.name, b]),
  );

  // Walk the parent chain from the production branch to discover past slots.
  // Result: [parent-of-prod, grandparent-of-prod, …] — most-recent first.
  const productionChain: string[] = [];
  const productionChainSet = new Set<string>([productionBranchName]);
  {
    // Seed walkVisited with productionBranchName so the walk terminates if
    // the parent chain contains a cycle back to the production branch (which
    // can happen when sibling-reparenting creates long circular parent links).
    const walkVisited = new Set<string>([productionBranchName]);
    let cursor = byName.get(productionBranchName);
    while (
      cursor?.parent &&
      byName.has(cursor.parent) &&
      !walkVisited.has(cursor.parent)
    ) {
      walkVisited.add(cursor.parent);
      productionChain.push(cursor.parent);
      productionChainSet.add(cursor.parent);
      cursor = byName.get(cursor.parent);
    }
  }

  // Recursively build non-terminal children for the active tree.
  function buildActiveChildren(
    parentName: string,
    visited: Set<string>,
  ): BranchNode[] {
    const children: BranchNode[] = [];
    for (const b of branches) {
      if (
        b.parent !== parentName ||
        visited.has(b.name) ||
        TERMINAL_STATUSES.has(b.sessionStatus ?? "")
      )
        continue;
      const node: BranchNode = {
        ...b,
        children: buildActiveChildren(
          b.name,
          new Set([...visited, b.name]),
        ),
      };
      children.push(node);
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    return children;
  }

  // Recursively build all children for past-slot descendants (no terminal filter).
  function buildPastChildren(
    parentName: string,
    excludeName: string | null,
    visited: Set<string>,
  ): BranchNode[] {
    const children: BranchNode[] = [];
    for (const b of branches) {
      if (
        b.parent !== parentName ||
        b.name === excludeName ||
        visited.has(b.name)
      )
        continue;
      const node: BranchNode = {
        ...b,
        children: buildPastChildren(
          b.name,
          null,
          new Set([...visited, b.name]),
        ),
      };
      children.push(node);
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    return children;
  }

  // Active production subtree.
  const prodData = byName.get(productionBranchName);
  const activeProd: BranchNode | null = prodData
    ? {
        ...prodData,
        children: buildActiveChildren(
          productionBranchName,
          new Set([productionBranchName]),
        ),
      }
    : null;

  // Past slots — each ancestor with its non-chain sibling children.
  const pastSlots: PastSlot[] = productionChain.map((slotName, i) => {
    const slotData = byName.get(slotName)!;
    // The child of this slot that was promoted to the next production slot.
    const promotedChild =
      i === 0 ? productionBranchName : productionChain[i - 1];
    const children = buildPastChildren(
      slotName,
      promotedChild,
      new Set([slotName]),
    );
    return { branch: slotData, children };
  });

  // Collect all branch names covered by the active and past-slot trees so we
  // can surface any remaining branches as "unattached" (no connection to the
  // production chain — typically manually created branches or worktrees).
  const covered = new Set<string>([productionBranchName, ...productionChain]);
  // Add all descendants of every covered branch.
  let frontier = [...covered];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const b of branches) {
      if (b.parent && covered.has(b.parent) && !covered.has(b.name)) {
        covered.add(b.name);
        next.push(b.name);
      }
    }
    frontier = next;
  }
  const unattached = branches
    .filter((b) => !covered.has(b.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { activeProd, pastSlots, unattached };
}

// ─── Status display helpers ──────────────────────────────────────────────────────

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
  "running-claude": "running claude…",
  "starting-server": "starting server…",
  starting: "starting…",
  error: "error",
  accepted: "accepted",
  rejected: "rejected",
};

// ─── Recursive branch row ───────────────────────────────────────────────────────

function BranchRow({
  node,
  depth,
  linePrefix,
  isLast,
  currentServerUrl,
  canCreateSession,
}: {
  node: BranchNode;
  depth: number;
  linePrefix: string;
  isLast: boolean;
  currentServerUrl: string;
  /** Whether to show the "+ session" button for branches without sessions. */
  canCreateSession: boolean;
}) {
  const isRoot = depth === 0;
  const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
  const childLinePrefix = isRoot
    ? ""
    : linePrefix + (isLast ? "   " : "│  ");

  const url = node.isProduction ? currentServerUrl : node.previewUrl;
  const statusColor = node.sessionStatus
    ? (STATUS_COLOR[node.sessionStatus] ?? "text-gray-400")
    : "";
  const statusLabel = node.sessionStatus
    ? (STATUS_LABEL[node.sessionStatus] ?? node.sessionStatus)
    : null;

  const isTerminal = TERMINAL_STATUSES.has(node.sessionStatus ?? "");

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
        {node.hasSession ? (
          <Link
            href={`/evolve/session/${node.name}`}
            className={
              node.isProduction
                ? "text-white font-bold hover:text-gray-200"
                : node.isCurrent
                  ? "text-white font-bold hover:text-gray-200"
                  : isTerminal
                    ? "text-gray-600 hover:text-gray-500"
                    : "text-gray-300 hover:text-gray-100"
            }
          >
            {node.name}
            {node.isProduction && (
              <span className="text-blue-400 font-normal ml-1">(production)</span>
            )}
            {node.isCurrent && !node.isProduction && (
              <span className="text-gray-500 font-normal ml-1">(current)</span>
            )}
          </Link>
        ) : (
          <span
            className={
              node.isProduction
                ? "text-white font-bold"
                : node.isCurrent
                  ? "text-white font-bold"
                  : isTerminal
                    ? "text-gray-600"
                    : "text-gray-300"
            }
          >
            {node.name}
            {node.isProduction && (
              <span className="text-blue-400 font-normal ml-1">(production)</span>
            )}
            {node.isCurrent && !node.isProduction && (
              <span className="text-gray-500 font-normal ml-1">(current)</span>
            )}
          </span>
        )}
        {statusLabel && !node.isProduction && (
          <span className={`text-xs shrink-0 ${statusColor}`}>
            [{statusLabel}]
          </span>
        )}

        {/* Show "+ session" only for active (non-terminal) branches without a session */}
        {canCreateSession &&
          !node.hasSession &&
          !node.isCurrent &&
          !node.isProduction &&
          !isTerminal && (
            <CreateSessionFromBranchButton branchName={node.name} />
          )}
        {url && (
          <a
            href={url}
            target={node.isCurrent ? "_self" : "_blank"}
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 ml-1 shrink-0 flex items-center"
            title={node.isProduction ? "View site" : "Open preview"}
          >
            <ExternalLink size={13} strokeWidth={2} />
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
          canCreateSession={canCreateSession}
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
  const user = await getSessionUser();
  const [userIsAdmin, userCanEvolve, evolvePrefs] = user
    ? await Promise.all([isAdmin(user.id), hasEvolvePermission(user.id), getEvolvePrefs(user.id)])
    : [false, false, null];

  const { branches, productionBranch, diag } = await getBranchData();
  const { activeProd, pastSlots, unattached } = buildSections(branches, productionBranch);

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

      {/* ── Active section ── */}
      <div className="mt-2">
        <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mb-2">
          Active
        </p>
        {activeProd ? (
          <div className="space-y-0">
            <BranchRow
              node={activeProd}
              depth={0}
              linePrefix=""
              isLast={true}
              currentServerUrl={currentServerUrl}
              canCreateSession={userCanEvolve}
            />
          </div>
        ) : (
          <p className="text-gray-500 text-sm font-mono">
            No production branch found.
          </p>
        )}
      </div>

      {/* ── Past Sessions section ── */}
      {pastSlots.length > 0 && (
        <div className="mt-8">
          <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mb-2">
            Past Sessions
          </p>
          <div className="space-y-0">
            {pastSlots.map((slot) => {
              const slotNode: BranchNode = {
                ...slot.branch,
                children: slot.children,
              };
              return (
                <BranchRow
                  key={slot.branch.name}
                  node={slotNode}
                  depth={0}
                  linePrefix=""
                  isLast={true}
                  currentServerUrl={currentServerUrl}
                  canCreateSession={false}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Unattached Branches section ── */}
      {unattached.length > 0 && (
        <div className="mt-8">
          <p className="text-xs text-gray-500 font-mono uppercase tracking-widest mb-2">
            Other Branches
          </p>
          <div className="space-y-0">
            {unattached.map((b) => {
              const node: BranchNode = { ...b, children: [] };
              return (
                <BranchRow
                  key={b.name}
                  node={node}
                  depth={0}
                  linePrefix=""
                  isLast={true}
                  currentServerUrl={currentServerUrl}
                  canCreateSession={userCanEvolve}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-8 border-t border-gray-800 pt-4 text-xs text-gray-600 font-mono space-y-1">
        <p>
          ● green = preview server active · ● dim = no active session · branch name
          links to session · <span className="text-blue-400"><ExternalLink size={10} className="inline" /></span> = open
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
