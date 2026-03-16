// app/changelog/page.tsx
//
// Server Component — reads public/changelog.json (generated at build time by
// scripts/generate-changelog.mjs) and renders a chronological list of commits.
// No client-side JS needed.

import fs from "fs";
import path from "path";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog — Primordia",
  description: "Automatically generated changelog from git history.",
};

interface CommitEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

function loadCommits(): CommitEntry[] {
  try {
    const filePath = path.join(process.cwd(), "public", "changelog.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as CommitEntry[];
  } catch {
    return [];
  }
}

export default function ChangelogPage() {
  const commits = loadCommits();
  const repo = process.env.GITHUB_REPO ?? "";

  return (
    <main className="flex flex-col w-full max-w-3xl mx-auto px-4 py-6 min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Primordia
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Changelog</p>
        </div>
        <Link
          href="/"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Back to app
        </Link>
      </header>

      {/* Commit list */}
      {commits.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No changelog data available. Run{" "}
          <code className="bg-gray-800 px-1 rounded text-xs">
            node scripts/generate-changelog.mjs
          </code>{" "}
          to generate it.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-6">
            {commits.length} commits — auto-generated from git history
          </p>
          <ol className="space-y-0">
            {commits.map((commit) => {
              const commitUrl =
                repo
                  ? `https://github.com/${repo}/commit/${commit.hash}`
                  : null;

              const dateLabel = new Date(commit.date).toLocaleDateString(
                "en-US",
                { year: "numeric", month: "short", day: "numeric" }
              );

              return (
                <li
                  key={commit.hash}
                  className="flex gap-4 items-start border-b border-gray-800/60 py-3 last:border-0"
                >
                  {/* Date column */}
                  <time
                    dateTime={commit.date}
                    className="text-xs text-gray-500 w-24 flex-shrink-0 pt-0.5"
                  >
                    {dateLabel}
                  </time>

                  {/* Message + meta column */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-100 leading-snug break-words">
                      {commit.message}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {commit.author}
                      {commitUrl ? (
                        <>
                          {" · "}
                          <a
                            href={commitUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-blue-400 hover:text-blue-300"
                          >
                            {commit.shortHash}
                          </a>
                        </>
                      ) : (
                        <>
                          {" · "}
                          <span className="font-mono">{commit.shortHash}</span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
