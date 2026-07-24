#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { getBranchParent } from "@/lib/branch-parent";
import {
  computeBranchGraphLayout,
  renderBranchGraphAscii,
  type BranchGraphInputNode,
} from "@/lib/branch-graph-layout";

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

function parseArgs(): { cwd: string } {
  let cwd = process.cwd();

  for (const arg of process.argv.slice(2)) {
    if (arg === "--branch-marker" || arg === "--source=branch-marker") {
      continue;
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { cwd };
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

function listBranches(cwd: string): BranchGraphInputNode[] {
  const branchList = runGit(["branch", "--format=%(refname:short)"], cwd);
  const branchNames = branchList.stdout
    ? branchList.stdout.split("\n").filter(Boolean)
    : [];

  return branchNames
    .filter((name) => name !== "main" && !name.includes("/"))
    .map((name) => ({
      name,
      parent: getBranchParent(name, cwd)?.parentBranch ?? null,
      markerTimestamp: markerTimestamp(name, cwd),
    }));
}

const { cwd } = parseArgs();
const productionBranch = gitConfigValue("primordia.productionBranch", cwd) ?? "main";
const nodes = listBranches(cwd);
const layout = computeBranchGraphLayout(nodes, productionBranch);
process.stdout.write(renderBranchGraphAscii(layout));
