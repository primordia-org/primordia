// app/chat/page.tsx — The chat interface entry point
// Moved from app/page.tsx so that the root "/" can be the landing page.
// Reads current git branch and most-recent changelog entry at request time,
// then passes them as props to the ChatInterface client component.

import { execSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import ChatInterface from "@/components/ChatInterface";
import { getSessionUser } from "@/lib/auth";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Chat") };
}

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

export default async function ChatPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const branch = runGit("git branch --show-current");

  const commitMessage = getMostRecentChangelogEntry();

  return (
    <ChatInterface
      branch={branch ?? null}
      commitMessage={commitMessage ?? null}
    />
  );
}
