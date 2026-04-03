// lib/page-title.ts
// Utility for computing standardized page <title> values.
//
// Production mode (NODE_ENV === "production"):
//   Format:  {pageName} — Primordia
//   Landing: Primordia
//
// Development mode:
//   Format:  {pageName} — Primordia — :{port} — {branch}
//   Landing: Primordia — :{port} — {branch}

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
 *   Production, with page name:    "{pageName} — Primordia"
 *   Production, landing page:      "Primordia"
 *   Development, with page name:   "{pageName} — Primordia — :{port} — {branch}"
 *   Development, landing page:     "Primordia — :{port} — {branch}"
 */
export function buildPageTitle(pageName?: string): string {
  if (process.env.NODE_ENV === "production") {
    return pageName ? `${pageName} — Primordia` : `Primordia`;
  }

  // Development mode: include port and branch for diagnostics.
  const branch = getCurrentBranch();
  const port = process.env.PORT ?? "3000";
  return pageName
    ? `${pageName} — Primordia — :${port} — ${branch ?? "unknown"}`
    : `Primordia — :${port} — ${branch ?? "unknown"}`;
}
