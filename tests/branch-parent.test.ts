import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getBranchParent } from "../lib/branch-parent";

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

test("branch-marker source falls back to legacy git-config parent metadata", () => {
  const productionSha = git(["rev-parse", "production"]);
  git(["switch", "-c", "automate-common-steps"]);
  commit("branch work");
  git(["config", "branch.automate-common-steps.parent", "production"]);

  expect(getBranchParent("automate-common-steps", repo, "branch-marker")).toEqual({
    parentBranch: "production",
    parentSha: productionSha,
  });
});

test("branch-marker source infers production parent from ancestry when metadata is missing", () => {
  const productionSha = git(["rev-parse", "production"]);
  git(["switch", "-c", "automate-common-steps"]);
  commit("branch work");

  expect(getBranchParent("automate-common-steps", repo, "branch-marker")).toEqual({
    parentBranch: "production",
    parentSha: productionSha,
  });
});
