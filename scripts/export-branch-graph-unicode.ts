#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { getBranchParent, type BranchParentSource } from "../lib/branch-parent";
import {
  computeBranchGraphLayout,
  renderBranchGraphUnicode,
  type BranchGraphInputNode,
  type BranchGraphMergeEdge,
} from "../lib/branch-graph-layout";

interface GitResult { stdout: string; code: number }
interface BranchInfo extends BranchGraphInputNode { tipSha: string; markerSha: string | null }

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: (result.stdout ?? "").trim(), code: result.status ?? 1 };
}

function gitConfigValue(key: string, cwd: string): string | null {
  const result = runGit(["config", "--get", key], cwd);
  return result.code === 0 && result.stdout ? result.stdout : null;
}

function parseArgs(): { source: BranchParentSource; cwd: string } {
  let source: BranchParentSource = "branch-marker";
  let cwd = process.cwd();
  for (const arg of process.argv.slice(2)) {
    if (arg === "--branch-marker") source = "branch-marker";
    else if (arg === "--git-config") source = "git-config";
    else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value !== "git-config" && value !== "branch-marker") throw new Error(`Unknown parent source: ${value}`);
      source = value;
    } else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { source, cwd };
}

function markerInfo(branch: string, cwd: string): { timestamp: number | null; sha: string | null } {
  const result = runGit([
    "log",
    branch,
    "--first-parent",
    "--grep",
    "^Branched-From:",
    "--format=%ct %H",
    "-n",
    "1",
  ], cwd);
  if (result.code !== 0 || !result.stdout) return { timestamp: null, sha: null };
  const [timestampText, sha] = result.stdout.split(/\s+/, 2);
  const timestamp = Number.parseInt(timestampText ?? "", 10);
  return { timestamp: Number.isNaN(timestamp) ? null : timestamp, sha: sha ?? null };
}

function listBranches(cwd: string, source: BranchParentSource): BranchInfo[] {
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const branchNames = branchList.stdout ? branchList.stdout.split("\n").filter(Boolean) : [];
  return branchNames
    .filter((name) => name !== "main" && !name.includes("/"))
    .map((name) => {
      const tip = runGit(["rev-parse", name], cwd);
      const marker = markerInfo(name, cwd);
      return {
        name,
        parent: getBranchParent(name, cwd, source)?.parentBranch ?? null,
        markerTimestamp: marker.timestamp,
        tipSha: tip.code === 0 ? tip.stdout : "",
        markerSha: marker.sha,
      };
    });
}

function buildMergeEdges(branches: BranchInfo[], cwd: string): BranchGraphMergeEdge[] {
  const branchByTip = new Map(branches.filter((branch) => branch.tipSha).map((branch) => [branch.tipSha, branch.name]));
  const edges: BranchGraphMergeEdge[] = [];
  const seen = new Set<string>();

  for (const target of branches) {
    const range = target.markerSha ? `${target.markerSha}..${target.name}` : target.name;
    const mergeParents = runGit(["log", range, "--first-parent", "--merges", "--format=%P"], cwd);
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

const { source, cwd } = parseArgs();
const productionBranch = gitConfigValue("primordia.productionBranch", cwd) ?? "main";
const branches = listBranches(cwd, source);
const layout = computeBranchGraphLayout(branches, productionBranch);
const mergeEdges = buildMergeEdges(branches, cwd);
process.stdout.write(renderBranchGraphUnicode(layout, mergeEdges, productionBranch));
