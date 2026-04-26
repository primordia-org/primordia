// app/admin/updates/page.tsx — Fetch upstream Primordia updates admin panel.
// Lets admins pull changes from configured update sources and create
// AI-assisted merge sessions to apply them.
// Admin-only.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { execFileSync } from "child_process";
import * as path from "path";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getEvolvePrefs } from "@/lib/user-prefs";
import { getDb } from "@/lib/db";
import { buildPageTitle } from "@/lib/page-title";
import ForbiddenPage from "@/components/ForbiddenPage";
import { PageNavBar } from "@/components/PageNavBar";
import AdminSubNav from "@/components/AdminSubNav";
import UpdatesClient from "./UpdatesClient";
import { readSources } from "@/lib/update-sources";
import type { SourceStatus, ChangelogEntry } from "@/app/api/admin/updates/route";

export function generateMetadata(): Metadata {
  return {
    title: buildPageTitle("Fetch Updates"),
    description: "Fetch and apply upstream Primordia updates from configured sources.",
  };
}

// ─── Server-side git helpers (same logic as the API route, duplicated here to
//     avoid importing from a route file in a page context) ─────────────────────

function gitSafe(args: string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { stdout, code: 0 };
  } catch {
    return { stdout: "", code: 1 };
  }
}

function remoteExists(name: string): boolean {
  try {
    return execFileSync("git", ["remote"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .map((r) => r.trim())
      .includes(name);
  } catch {
    return false;
  }
}

function branchExists(name: string): boolean {
  return gitSafe(["branch", "--list", name]).stdout.trim().length > 0;
}

function getMergeBase(trackingBranch: string): string | null {
  if (!branchExists(trackingBranch)) return null;
  const r = gitSafe(["merge-base", "main", trackingBranch]);
  return r.code === 0 && r.stdout ? r.stdout.trim() : null;
}

function getAheadCount(mergeBase: string, trackingBranch: string): number {
  const r = gitSafe(["rev-list", "--count", `${mergeBase}..${trackingBranch}`]);
  return r.code === 0 ? parseInt(r.stdout.trim() || "0", 10) : 0;
}

function getNewChangelogEntries(mergeBase: string, trackingBranch: string): ChangelogEntry[] {
  const r = gitSafe([
    "diff", "--name-only", "--diff-filter=A",
    `${mergeBase}..${trackingBranch}`, "--", "changelog/",
  ]);
  if (r.code !== 0 || !r.stdout.trim()) return [];

  const filenames = r.stdout.trim().split("\n").map((f) => f.trim()).filter(Boolean);
  const entries: ChangelogEntry[] = [];
  for (const filepath of filenames) {
    const filename = path.basename(filepath);
    const cr = gitSafe(["show", `${trackingBranch}:${filepath}`]);
    if (cr.code === 0) entries.push({ filename, content: cr.stdout });
  }
  entries.sort((a, b) => a.filename.localeCompare(b.filename));
  return entries;
}

function buildSourceStatuses(): SourceStatus[] {
  const sources = readSources(process.cwd());
  return sources.map((source) => {
    const remoteConfigured = remoteExists(source.id);
    const trackingBranchExists = branchExists(source.trackingBranch);
    const mergeBase = getMergeBase(source.trackingBranch);
    const aheadCount = mergeBase ? getAheadCount(mergeBase, source.trackingBranch) : 0;
    const changelogEntries =
      mergeBase && aheadCount > 0 ? getNewChangelogEntries(mergeBase, source.trackingBranch) : [];
    return {
      ...source,
      remoteConfigured,
      trackingBranchExists,
      aheadCount,
      mergeBase,
      changelogEntries,
      hasUpdates: aheadCount > 0,
      fetchError: null,
    } satisfies SourceStatus;
  });
}

export default async function AdminUpdatesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = await getDb();
  const [adminCheck, allRoles] = await Promise.all([isAdmin(user.id), db.getAllRoles()]);

  const adminRoleName = allRoles.find((r) => r.name === "admin")?.displayName ?? "admin";

  if (!adminCheck) {
    return (
      <ForbiddenPage
        pageDescription="This page lets admins fetch upstream Primordia updates from configured sources and create AI-assisted merge sessions to apply them."
        requiredConditions={["Be logged in", `Have the "${adminRoleName}" role`]}
        metConditions={["You are logged in"]}
        unmetConditions={[`You don't have the "${adminRoleName}" role`]}
        howToFix={[
          `The "${adminRoleName}" role is automatically granted to the first user who registered. It cannot be granted via the API.`,
        ]}
      />
    );
  }

  const initialSources = buildSourceStatuses();
  const [sessionUser, evolvePrefs] = await Promise.all([
    Promise.resolve({ id: user.id, username: user.username, isAdmin: true }),
    getEvolvePrefs(user.id),
  ]);

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-dvh">
      <PageNavBar
        subtitle="Admin"
        currentPage="admin"
        initialSession={sessionUser}
        initialHarness={evolvePrefs.initialHarness}
        initialModel={evolvePrefs.initialModel}
        initialCavemanMode={evolvePrefs.initialCavemanMode}
        initialCavemanIntensity={evolvePrefs.initialCavemanIntensity}
      />
      <AdminSubNav currentTab="updates" />
      <UpdatesClient initialSources={initialSources} />
    </main>
  );
}
