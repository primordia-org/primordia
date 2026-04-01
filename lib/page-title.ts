// lib/page-title.ts
// Utility for computing standardized page <title> values.
//
// Format (non-main branch):  {pageName} — Primordia — :{port} — {branch}
// Format (main branch):      {pageName} — Primordia
//
// Landing page (no pageName):
// Format (non-main branch):  Primordia — :{port} — {branch}
// Format (main branch):      Primordia

import { execSync } from "child_process";

function getCurrentBranch(): string | null {
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
 *   Main branch, with page name:    "{pageName} — Primordia"
 *   Other branch, with page name:   "{pageName} — Primordia — :{port} — {branch}"
 *   Main branch, landing page:      "Primordia"
 *   Other branch, landing page:     "Primordia — :{port} — {branch}"
 */

export function buildPageTitle(pageName?: string): string {
  const branch = getCurrentBranch();
  const isMain = !branch || branch === "main";

  if (isMain) {
    return pageName ? `${pageName} — Primordia` : `Primordia`;
  }

  const port = process.env.PORT ?? "3000";
  return pageName
    ? `${pageName} — Primordia — :${port} — ${branch}`
    : `Primordia — :${port} — ${branch}`;
}
