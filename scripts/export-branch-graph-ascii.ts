#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { getBranchParent, type BranchParentSource } from "../lib/branch-parent";
import {
  computeBranchGraphLayout,
  renderBranchGraphAscii,
  type BranchGraphInputNode,
} from "../lib/branch-graph-layout";

interface GitResult {
  stdout: string;
  code: number;
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    stdout: (result.stdout ?? "").trim(),
    code: result.status ?? 1,
  };
}

function gitConfigValue(key: string, cwd: string): string | null {
  const result = runGit(["config", "--get", key], cwd);
  return result.code === 0 && result.stdout ? result.stdout : null;
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

function markerTimestamp(branch: string, cwd: string): number | null {
  const result = runGit(
    [
      "log",
      branch,
      "--first-parent",
      "--grep",
      "^Branched-From:",
      "--format=%ct",
      "-n",
      "1",
    ],
    cwd,
  );
  if (result.code !== 0 || !result.stdout) return null;
  const timestamp = Number.parseInt(result.stdout, 10);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function listBranches(cwd: string, source: BranchParentSource): BranchGraphInputNode[] {
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const branchNames = branchList.stdout
    ? branchList.stdout.split("\n").filter(Boolean)
    : [];

  return branchNames
    .filter((name) => name !== "main" && !name.includes("/"))
    .map((name) => ({
      name,
      parent: getBranchParent(name, cwd, source)?.parentBranch ?? null,
      markerTimestamp: markerTimestamp(name, cwd),
    }));
}

const { source, cwd } = parseArgs();
const productionBranch = gitConfigValue("primordia.productionBranch", cwd) ?? "main";
const nodes = listBranches(cwd, source);
const layout = computeBranchGraphLayout(nodes, productionBranch);
process.stdout.write(renderBranchGraphAscii(layout));
