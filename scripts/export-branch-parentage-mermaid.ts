#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { getBranchParent, type BranchParentSource } from "../lib/branch-parent";

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface BranchInfo {
  name: string;
  tipSha: string;
  markerSha: string | null;
  parent: string | null;
}

interface EdgeInfo {
  from: string;
  to: string;
  label: "parent" | "merge";
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    code: result.status ?? 1,
  };
}

function parseArgs(): { source: BranchParentSource; cwd: string } {
  let source: BranchParentSource = "branch-marker";
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

function listBranches(cwd: string, source: BranchParentSource): BranchInfo[] {
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const branchNames = branchList.stdout
    ? branchList.stdout.split("\n").filter(Boolean)
    : [];

  return branchNames
    .filter((name) => name !== "main" && !name.includes("/"))
    .map((name) => {
      const tip = runGit(["rev-parse", name], cwd);
      const marker = runGit(
        [
          "log",
          name,
          "--first-parent",
          "--grep",
          "^Branched-From:",
          "--format=%H",
          "-n",
          "1",
        ],
        cwd,
      );
      return {
        name,
        tipSha: tip.code === 0 ? tip.stdout : "",
        markerSha: marker.code === 0 && marker.stdout ? marker.stdout : null,
        parent: getBranchParent(name, cwd, source)?.parentBranch ?? null,
      };
    });
}

function buildParentEdges(branches: BranchInfo[]): EdgeInfo[] {
  const branchNames = new Set(branches.map((branch) => branch.name));

  return branches
    .filter((branch) => branch.parent && branchNames.has(branch.parent))
    .map((branch) => ({
      from: branch.parent!,
      to: branch.name,
      label: "parent" as const,
    }));
}

function buildMergeEdges(branches: BranchInfo[], cwd: string): EdgeInfo[] {
  const branchByTip = new Map(
    branches
      .filter((branch) => branch.tipSha)
      .map((branch) => [branch.tipSha, branch.name]),
  );
  const edges: EdgeInfo[] = [];
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
        const key = `${mergedBranch}\0${target.name}\0merge`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: mergedBranch, to: target.name, label: "merge" });
      }
    }
  }

  return edges;
}

function renderMermaid(branches: BranchInfo[], edges: EdgeInfo[], source: BranchParentSource): string {
  const lines = [
    "flowchart BT",
    `  %% parent source: ${source === "branch-marker" ? "branch markers" : "git config"}`,
    "  %% parent edges point from parent branch to child branch",
    "  %% merge edges point from merged branch to receiving branch",
  ];

  for (const branch of branches) {
    lines.push(`  ${branch.name}`);
  }

  lines.push("");

  for (const edge of edges) {
    if (edge.label === "merge") {
      lines.push(`  ${edge.from} --> |merge| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const { source, cwd } = parseArgs();
const branches = listBranches(cwd, source);
const edges = [
  ...buildParentEdges(branches),
  ...buildMergeEdges(branches, cwd),
];
process.stdout.write(renderMermaid(branches, edges, source));
