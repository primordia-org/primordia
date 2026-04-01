#!/usr/bin/env bun
// scripts/watch-changelog.mjs
//
// Dev-mode watcher: watches changelog/ for new or changed .md files and
// re-runs generate-changelog.mjs so lib/generated/system-prompt.ts stays
// up to date without restarting the dev server.
//
// Started automatically by the "dev" script in package.json alongside
// `next dev`.  Uses only Node built-ins — no extra dependencies.

import { watch } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const changelogDir = join(repoRoot, "changelog");
const generateScript = join(__dirname, "generate-changelog.mjs");

console.log("changelog-watcher: watching", changelogDir);

let debounceTimer = null;

function rebuild(filename) {
  console.log(`changelog-watcher: ${filename} changed — rebuilding…`);
  const result = spawnSync("bun", [generateScript], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("changelog-watcher: rebuild failed (exit", result.status + ")");
  }
}

watch(changelogDir, { persistent: true }, (eventType, filename) => {
  if (!filename || !filename.endsWith(".md")) return;
  // Debounce: editors sometimes write a file in multiple rapid events.
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => rebuild(filename), 150);
});
