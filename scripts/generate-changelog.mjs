#!/usr/bin/env node
// scripts/generate-changelog.mjs
//
// Generates public/changelog.json from git history.
// Run automatically as a prebuild/predev step (see package.json).
//
// Handles shallow clones (default in Vercel and GitHub Actions) by deepening
// the clone with --filter=tree:0, which fetches only commit objects and avoids
// downloading any blobs or trees.

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const COMMIT_LIMIT = 300;

// Deepen the shallow clone so we get enough history.
// --filter=tree:0  → fetch only commit objects (no trees, no blobs).
// This is safe to skip if the repo already has enough history.
try {
  execSync(`git fetch --deepen=${COMMIT_LIMIT} --filter=tree:0`, {
    cwd: repoRoot,
    stdio: "pipe",
  });
  console.log("changelog: git fetch (deepen) succeeded");
} catch {
  // Not fatal — the remote may be unavailable or the clone already has enough
  // depth.  We'll work with whatever commits are locally available.
  console.warn("changelog: git fetch --deepen skipped (not fatal)");
}

// Read git log.  Use ASCII unit-separator (0x1f) as the field delimiter so
// commit subjects that contain spaces/punctuation don't break parsing.
let logOutput = "";
try {
  logOutput = execSync(
    `git log --format="%H%x1f%an%x1f%aI%x1f%s" --max-count=${COMMIT_LIMIT}`,
    { cwd: repoRoot }
  ).toString();
} catch (e) {
  console.warn("changelog: git log failed:", e.message);
}

const commits = logOutput
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [hash, author, date, ...subjectParts] = line.split("\x1f");
    return {
      hash: hash.trim(),
      shortHash: hash.trim().slice(0, 7),
      author: author.trim(),
      date: date.trim(),
      // Subject may itself contain the delimiter on pathological inputs; join it back.
      message: subjectParts.join("\x1f").trim(),
    };
  })
  .filter((c) => c.hash && c.message);

// Write to public/ so Next.js can serve it statically and server components
// can read it from the filesystem at build/render time.
const publicDir = join(repoRoot, "public");
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, "changelog.json"), JSON.stringify(commits, null, 2));
console.log(`changelog: wrote ${commits.length} commits → public/changelog.json`);
