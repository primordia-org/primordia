// app/page.tsx — The main entry point for Primordia
// This is a React Server Component. It reads the current git branch and the
// most recent changelog entry at request time (no client-side fetches needed),
// then passes them as props to the ChatInterface client component.
//
// On Vercel deployments, built-in env vars are used:
//   VERCEL_GIT_COMMIT_REF — branch name
//
// In local dev and git worktrees, falls back to running git commands directly.
//
// Preview instance detection is handled in app/layout.tsx (shared across all
// pages) and passed to AcceptRejectBar.

import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import ChatInterface from "@/components/ChatInterface";

function runGit(cmd: string): string | null {
  try {
    return (
      execSync(cmd, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

// Matches: YYYY-MM-DD-HH-MM-SS Description of change.md
const CHANGELOG_FILENAME_RE = /^(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}) (.+)\.md$/;

function getMostRecentChangelogEntry(): string | null {
  try {
    const changelogDir = join(process.cwd(), "changelog");
    const files = readdirSync(changelogDir)
      .filter((f) => CHANGELOG_FILENAME_RE.test(f))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const latest = files[0];
    const m = latest.match(CHANGELOG_FILENAME_RE);
    const title = m ? m[2] : latest.replace(/\.md$/, "");
    const body = readFileSync(join(changelogDir, latest), "utf-8").trim();
    return body ? `**${title}**\n\n${body}` : `**${title}**`;
  } catch {
    return null;
  }
}

export default function Home() {
  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ?? runGit("git branch --show-current");

  const commitMessage = getMostRecentChangelogEntry();

  // Compute deploy-preview link data here (server component) so ChatInterface
  // stays environment-agnostic and doesn't reference Vercel env vars directly.
  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null;
  const headerHref = productionUrl ? `https://${productionUrl}` : null;

  const isPreview = process.env.VERCEL_ENV === "preview";
  const prId = process.env.VERCEL_GIT_PULL_REQUEST_ID ?? null;
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER ?? null;
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG ?? null;
  const prLink =
    isPreview && prId && repoOwner && repoSlug
      ? { id: prId, url: `https://github.com/${repoOwner}/${repoSlug}/pull/${prId}` }
      : null;

  return (
    <ChatInterface
      branch={branch ?? null}
      commitMessage={commitMessage ?? null}
      headerHref={headerHref}
      prLink={prLink}
    />
  );
}
