#!/usr/bin/env node
// scripts/generate-changelog.mjs
//
// Generates public/changelog.json from git history.
// Run automatically as a prebuild/predev step (see package.json).
//
// Handles shallow clones:
// - Vercel: does a shallow clone with no remote configured, so
//   `git fetch --deepen` fails.  Instead we use `git pull --unshallow`
//   with the public HTTPS URL constructed from Vercel system env vars.
//   See: https://github.com/vercel/vercel/discussions/5737#discussioncomment-7984929
// - GitHub Actions / local: deepen with --filter=tree:0 (commits only,
//   no blobs or trees).

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const COMMIT_LIMIT = 300;

const isVercel = !!process.env.VERCEL;

if (isVercel) {
  // Vercel shallow clones have no remote configured, so `git fetch --deepen`
  // fails with "no remote".  Pull directly from the public HTTPS URL instead.
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  const ref = process.env.VERCEL_GIT_COMMIT_REF || "main";

  if (owner && slug) {
    const repoUrl = `https://github.com/${owner}/${slug}.git`;
    try {
      execSync(`git pull --unshallow "${repoUrl}" "main:${ref}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });
      console.log("changelog: git pull --unshallow succeeded (Vercel)");
    } catch (e) {
      // Not fatal — e.g. already unshallow, or private repo without token.
      console.warn("changelog: git pull --unshallow skipped (not fatal):", e.message);
    }
  } else {
    console.warn(
      "changelog: VERCEL_GIT_REPO_OWNER/SLUG not set; skipping unshallow"
    );
  }
} else {
  // Non-Vercel (GitHub Actions, local dev): deepen the shallow clone so we
  // get enough history.
  // --filter=tree:0  → fetch only commit objects (no trees, no blobs).
  // Safe to skip if the repo already has full history.
  try {
    execSync(`git fetch --deepen=${COMMIT_LIMIT} --filter=tree:0`, {
      cwd: repoRoot,
      stdio: "pipe",
    });
    console.log("changelog: git fetch (deepen) succeeded");
  } catch {
    // Not fatal — the remote may be unavailable or the clone already has
    // enough depth.  We'll work with whatever commits are locally available.
    console.warn("changelog: git fetch --deepen skipped (not fatal)");
  }
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
