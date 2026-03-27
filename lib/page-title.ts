// lib/page-title.ts
// Utility for computing standardized page <title> values.
//
// Format (non-main branch):  {pageName} — Primordia — :{port} - {branch}
// Format (main branch):      {pageName} — Primordia

import { execSync } from "child_process";

function getCurrentBranch(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    return process.env.VERCEL_GIT_COMMIT_REF;
  }
  try {
    return (
      execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Returns a page title in the standardized Primordia format.
 *
 *   Main branch:   "{pageName} — Primordia"
 *   Other branch:  "{pageName} — Primordia — :{port} - {branch}"
 */
export function buildPageTitle(pageName: string): string {
  const branch = getCurrentBranch();
  const isMain = !branch || branch === "main";

  if (isMain) {
    return `${pageName} — Primordia`;
  }

  const port = process.env.PORT ?? "3000";
  return `${pageName} — Primordia — :${port} - ${branch}`;
}
