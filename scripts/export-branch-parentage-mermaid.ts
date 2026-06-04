#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { getBranchParent, type BranchParentSource } from "../lib/branch-parent";
import { listSessionsFromFilesystem } from "../lib/session-events";

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface BranchInfo {
  name: string;
  parent: string | null;
  effectiveParent: string | null;
  sessionStatus: string | null;
  isProduction: boolean;
  isCurrent: boolean;
}

interface EdgeInfo {
  parent: string;
  child: string;
  source: "recorded" | "ancestry" | "accepted-collapse";
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    code: result.status ?? 1,
  };
}

function gitConfigValue(key: string, cwd: string): string | null {
  const result = runGit(["config", "--get", key], cwd);
  return result.code === 0 && result.stdout ? result.stdout : null;
}

function parseArgs(): { source: BranchParentSource; cwd: string } {
  let source: BranchParentSource = "git-config";
  let cwd = process.cwd();

  for (const arg of process.argv.slice(2)) {
    if (arg === "--branch-marker") {
      source = "branch-marker";
    } else if (arg === "--git-config") {
      source = "git-config";
    } else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value !== "git-config" && value !== "branch-marker") {
        throw new Error(`Unknown parent source: ${value}`);
      }
      source = value;
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { source, cwd };
}

function isGitAncestor(ancestor: string, descendant: string, cwd: string): boolean {
  if (ancestor === descendant) return false;
  return runGit(["merge-base", "--is-ancestor", ancestor, descendant], cwd).code === 0;
}

function revDistance(ancestor: string, descendant: string, cwd: string): number | null {
  const result = runGit(["rev-list", `${ancestor}..${descendant}`, "--count"], cwd);
  const distance = Number.parseInt(result.stdout, 10);
  return Number.isNaN(distance) ? null : distance;
}

function nearestAncestor(branchName: string, branches: BranchInfo[], cwd: string): string | null {
  let best: { name: string; distance: number } | null = null;
  for (const candidate of branches) {
    if (candidate.name === branchName || !isGitAncestor(candidate.name, branchName, cwd)) continue;
    const distance = revDistance(candidate.name, branchName, cwd);
    if (distance === null) continue;
    if (!best || distance < best.distance) best = { name: candidate.name, distance };
  }
  return best?.name ?? null;
}

function buildBranchInfos(cwd: string, source: BranchParentSource): {
  branches: BranchInfo[];
  productionBranch: string;
} {
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const currentBranch = runGit(["branch", "--show-current"], cwd).stdout;
  const productionBranch = gitConfigValue("primordia.productionBranch", cwd) ?? "main";
  const sessions = listSessionsFromFilesystem(cwd);
  const sessionByBranch = new Map(sessions.map((session) => [session.branch, session]));

  const branchNames = branchList.stdout
    ? branchList.stdout.split("\n").filter(Boolean)
    : [];

  const branches: BranchInfo[] = branchNames
    .filter((name) => name !== "main" && !name.includes("/"))
    .map((name) => {
      const parent = getBranchParent(name, cwd, source)?.parentBranch ?? null;
      const session = sessionByBranch.get(name);
      return {
        name,
        parent,
        effectiveParent: parent,
        sessionStatus: session?.status ?? null,
        isProduction: name === productionBranch,
        isCurrent: name === currentBranch,
      };
    });

  const byName = new Map(branches.map((branch) => [branch.name, branch]));

  function skipAcceptedParents(parent: string | null, visited = new Set<string>()): string | null {
    if (!parent || visited.has(parent)) return parent;
    visited.add(parent);
    const parentBranch = byName.get(parent);
    if (!parentBranch) return parent;
    if (parentBranch.sessionStatus === "accepted" && !parentBranch.isProduction) {
      if (productionBranch && isGitAncestor(parent, productionBranch, cwd)) {
        return productionBranch;
      }
      return skipAcceptedParents(parentBranch.parent, visited);
    }
    return parent;
  }

  for (const branch of branches) {
    branch.effectiveParent = skipAcceptedParents(branch.parent);
  }

  return { branches, productionBranch };
}

function buildEdges(branches: BranchInfo[], cwd: string): EdgeInfo[] {
  const branchNames = new Set(branches.map((branch) => branch.name));
  const parentByBranch = new Map<string, string>();
  const edges: EdgeInfo[] = [];

  function wouldCreateCycle(branchName: string, parentName: string): boolean {
    let cursor: string | null = parentName;
    const visited = new Set<string>([branchName]);
    while (cursor) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = parentByBranch.get(cursor) ?? null;
    }
    return false;
  }

  for (const branch of branches) {
    const explicitParent = branch.effectiveParent ?? branch.parent;
    const explicitParentExists = explicitParent && branchNames.has(explicitParent);
    const parentName = explicitParentExists ? explicitParent : nearestAncestor(branch.name, branches, cwd);
    if (!parentName || !branchNames.has(parentName) || wouldCreateCycle(branch.name, parentName)) continue;

    parentByBranch.set(branch.name, parentName);
    edges.push({
      parent: parentName,
      child: branch.name,
      source: explicitParentExists
        ? branch.effectiveParent !== branch.parent
          ? "accepted-collapse"
          : "recorded"
        : "ancestry",
    });
  }

  return edges;
}

function mermaidId(name: string): string {
  return `b_${Buffer.from(name).toString("base64url")}`;
}

function mermaidLabel(branch: BranchInfo): string {
  const badges = [branch.isProduction ? "production" : null, branch.isCurrent ? "current" : null]
    .filter(Boolean)
    .join(", ");
  return badges ? `${branch.name} (${badges})` : branch.name;
}

function quoteMermaidLabel(label: string): string {
  return label.replace(/"/g, "#quot;");
}

function renderMermaid(branches: BranchInfo[], edges: EdgeInfo[], source: BranchParentSource): string {
  const lines = [
    "flowchart BT",
    `  %% parent source: ${source}`,
    "  %% edges point from parent branch to child branch",
  ];

  for (const branch of branches) {
    lines.push(`  ${mermaidId(branch.name)}["${quoteMermaidLabel(mermaidLabel(branch))}"]`);
  }

  for (const edge of edges) {
    const label = edge.source === "recorded" ? "" : `|${edge.source}|`;
    lines.push(`  ${mermaidId(edge.parent)} -->${label} ${mermaidId(edge.child)}`);
  }

  const roots = branches.filter((branch) => !edges.some((edge) => edge.child === branch.name));
  if (roots.length > 0) {
    lines.push(`  %% roots: ${roots.map((branch) => branch.name).join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

const { source, cwd } = parseArgs();
const { branches } = buildBranchInfos(cwd, source);
const edges = buildEdges(branches, cwd);
process.stdout.write(renderMermaid(branches, edges, source));
