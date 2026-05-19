import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getBranchParent, readBranchMarker, writeBranchMarker } from "../lib/branch-parent";

let repo: string;

function git(args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(message: string): string {
  execFileSync("git", ["-C", repo, "commit", "--allow-empty", "-m", message], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  return git(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "primordia-branch-parent-"));
  git(["init", "-b", "production"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test User"]);
  git(["config", "primordia.productionBranch", "production"]);
  commit("production base");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("writeBranchMarker writes readable branch parent trailers", () => {
  const productionSha = git(["rev-parse", "production"]);
  git(["switch", "-c", "automate-common-steps"]);

  writeBranchMarker(repo, "production", productionSha);

  expect(readBranchMarker("automate-common-steps", repo)).toEqual({
    parentBranch: "production",
    parentSha: productionSha,
  });
});

test("writeBranchMarker reports git commit failures", () => {
  expect(() => writeBranchMarker(join(repo, "missing-worktree"), "production", "abc123")).toThrow(
    /Failed to write branch marker commit/,
  );
});

test("branch-marker source does not fall back to legacy git-config parent metadata", () => {
  git(["switch", "-c", "automate-common-steps"]);
  commit("branch work");
  git(["config", "branch.automate-common-steps.parent", "production"]);

  expect(getBranchParent("automate-common-steps", repo, "branch-marker")).toBeNull();
});

test("branch-marker source does not infer production parent from ancestry", () => {
  git(["switch", "-c", "automate-common-steps"]);
  commit("branch work");

  expect(getBranchParent("automate-common-steps", repo, "branch-marker")).toBeNull();
});
