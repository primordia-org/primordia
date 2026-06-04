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
  /** Short commit hash at this branch tip, for log-style display. */
  shortSha: string | null;
  /** First line of the branch tip commit message. */
  subject: string | null;
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
      const shortSha = runGit(["rev-parse", "--short=8", name], cwd);
      const subject = runGit(["log", "-1", "--format=%s", name], cwd);
      return {
        name,
        isCurrent: name === current,
        isProduction: name === productionBranch,
        parent,
        activeParent: parent,
        previewUrl: session?.previewUrl ?? null,
        sessionStatus: session?.status ?? null,
        hasSession: session !== undefined,
        shortSha: shortSha.code === 0 && shortSha.stdout ? shortSha.stdout : null,
        subject: subject.code === 0 && subject.stdout ? subject.stdout : null,
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

// ─── Log graph rendering ───────────────────────────────────────────────────────

function buildBranchForest(
  branches: BranchData[],
  productionBranchName: string,
): BranchNode[] {
  const byName = new Map(branches.map((branch) => [branch.name, branch]));
  const nodes = new Map(
    branches.map((branch) => [branch.name, { ...branch, children: [] as BranchNode[] }]),
  );
  const childNames = new Set<string>();

  function wouldCreateCycle(branchName: string, parentName: string): boolean {
    let cursor: string | null = parentName;
    const visited = new Set<string>([branchName]);
    while (cursor) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = byName.get(cursor)?.activeParent ?? byName.get(cursor)?.parent ?? null;
    }
    return false;
  }

  for (const branch of branches) {
    const parentName = branch.activeParent ?? branch.parent;
    if (!parentName || !nodes.has(parentName) || wouldCreateCycle(branch.name, parentName)) {
      continue;
    }
    nodes.get(parentName)!.children.push(nodes.get(branch.name)!);
    childNames.add(branch.name);
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      if (a.isProduction) return 1;
      if (b.isProduction) return -1;
      return a.name.localeCompare(b.name);
    });
  }

  return [...nodes.values()]
    .filter((node) => !childNames.has(node.name))
    .sort((a, b) => {
      if (a.name === productionBranchName) return 1;
      if (b.name === productionBranchName) return -1;
      if (a.isProduction) return 1;
      if (b.isProduction) return -1;
      return a.name.localeCompare(b.name);
    });
}

function GraphGlyphs({ graph, isActive }: { graph: string; isActive: boolean }) {
  const starIndex = graph.indexOf("*");
  if (starIndex === -1) {
    return <span className="text-gray-600">{graph}</span>;
  }

  return (
    <span>
      <span className="text-gray-600">{graph.slice(0, starIndex)}</span>
      <span className={isActive ? "text-green-400" : "text-gray-500"}>*</span>
      <span className="text-gray-600">{graph.slice(starIndex + 1)}</span>
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

function BranchGraphLine({
  branch,
  graph,
  currentServerUrl,
  canCreateSession,
}: {
  branch: BranchData;
  graph: string;
  currentServerUrl: string;
  canCreateSession: boolean;
}) {
  return (
    <div className="flex min-w-max items-baseline gap-1.5 whitespace-nowrap leading-7">
      <span className="whitespace-pre select-none shrink-0">
        <GraphGlyphs graph={graph} isActive={branch.isProduction || Boolean(branch.previewUrl)} />
      </span>
      <span className="text-gray-600 shrink-0">{branch.shortSha ?? "────────"}</span>
      <BranchRef
        branch={branch}
        currentServerUrl={currentServerUrl}
        canCreateSession={canCreateSession}
      />
      {branch.subject && (
        <span className="min-w-0 max-w-sm truncate text-gray-600">
          — {branch.subject}
        </span>
      )}
    </div>
  );
}

function BranchGraphNode({
  node,
  depth,
  isLast,
  linePrefix,
  currentServerUrl,
  canCreateSession,
}: {
  node: BranchNode;
  depth: number;
  isLast: boolean;
  linePrefix: string;
  currentServerUrl: string;
  canCreateSession: boolean;
}) {
  const isRoot = depth === 0;
  const branchGraph = isRoot ? "* " : `${linePrefix}${isLast ? "  " : "| "}* `;
  const connectorGraph = isRoot ? "" : `${linePrefix}${isLast ? " /" : "|/"}`;
  const childLinePrefix = isRoot ? "" : `${linePrefix}${isLast ? "  " : "| "}`;

  return (
    <>
      {node.children.map((child, index) => (
        <BranchGraphNode
          key={child.name}
          node={child}
          depth={depth + 1}
          isLast={index === node.children.length - 1}
          linePrefix={childLinePrefix}
          currentServerUrl={currentServerUrl}
          canCreateSession={canCreateSession}
        />
      ))}
      {!isRoot && (
        <div className="min-w-max whitespace-pre font-mono text-sm leading-4 text-gray-600 select-none">
          {connectorGraph}
        </div>
      )}
      <BranchGraphLine
        branch={node}
        graph={branchGraph}
        currentServerUrl={currentServerUrl}
        canCreateSession={canCreateSession}
      />
    </>
  );
}

function BranchStructureGraph({
  roots,
  currentServerUrl,
  canCreateSession,
}: {
  roots: BranchNode[];
  currentServerUrl: string;
  canCreateSession: boolean;
}) {
  return (
    <div className="overflow-x-auto pb-1 font-mono text-sm">
      {roots.map((root, index) => (
        <BranchGraphNode
          key={root.name}
          node={root}
          depth={0}
          isLast={index === roots.length - 1}
          linePrefix=""
          currentServerUrl={currentServerUrl}
          canCreateSession={canCreateSession}
        />
      ))}
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
  const branchRoots = buildBranchForest(branches, productionBranch);

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
        {branchRoots.length > 0 ? (
          <BranchStructureGraph
            roots={branchRoots}
            currentServerUrl={currentServerUrl}
            canCreateSession={userCanEvolve}
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
          * green = preview server active · * dim = no active session · branch
          heads are connected by recorded parentage, with child heads indented to the
          right of their parent · short hash and latest commit subject mirror git log output · branch name links to session ·{" "}
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
