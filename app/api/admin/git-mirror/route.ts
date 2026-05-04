// app/api/admin/git-mirror/route.ts
// Manage the "mirror" git remote.
//
// POST { url: string }
//   Adds (or updates) the "mirror" remote as a push mirror, then does an
//   initial `git push mirror` to verify the connection.
//   Returns { ok: true } on success, { error: string } on failure.
//
// DELETE
//   Removes the "mirror" remote.
//   Returns { ok: true } on success, { error: string } on failure.
//
// Admin-only.

import { execFileSync } from "child_process";
import { getSessionUser, isAdmin } from "@/lib/auth";

/** Run a git command in the main repo root; returns stdout or throws. */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Returns true if a remote named "mirror" already exists. */
function mirrorExists(): boolean {
  try {
    const remotes = git(["remote"]).split("\n").map((r) => r.trim());
    return remotes.includes("mirror");
  } catch {
    return false;
  }
}

/** JSON body for POST /admin/git-mirror */
export interface AdminGitMirrorBody {
  url: string; // SSH or HTTPS URL of the remote repository to mirror pushes to.
}

/**
 * Add or update the push mirror remote
 * @description Adds (or updates) a 'mirror' git remote as a push mirror and verifies the connection with an initial push. Admin only.
 * @tag Admin
 * @body AdminGitMirrorBody
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Admin required" }, { status: 403 });

  const body = (await request.json()) as { url?: string };
  const url = (body.url ?? "").trim();
  if (!url) return Response.json({ error: "url is required" }, { status: 400 });

  try {
    if (mirrorExists()) {
      // Update the push URL on the existing remote.
      git(["remote", "set-url", "--push", "mirror", url]);
    } else {
      // Add a brand-new push mirror remote.
      git(["remote", "add", "--mirror=push", "mirror", url]);
    }

    // Initial push to verify the connection.
    try {
      git(["push", "mirror"]);
    } catch (pushErr) {
      // Push failed — remove the remote so we don't leave a broken state.
      try { git(["remote", "remove", "mirror"]); } catch { /* best-effort */ }
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      return Response.json(
        { error: `Remote added but initial push failed: ${msg.trim()}` },
        { status: 422 },
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg.trim() }, { status: 500 });
  }
}

/**
 * Remove the push mirror remote
 * @description Removes the 'mirror' git remote. Admin only.
 * @tag Admin
 */
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!(await isAdmin(user.id))) return Response.json({ error: "Admin required" }, { status: 403 });

  try {
    git(["remote", "remove", "mirror"]);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg.trim() }, { status: 500 });
  }
}
