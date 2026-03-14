// app/api/merge-pr/route.ts
// Merges a PR via the GitHub API using a regular merge commit.
// Called when the user clicks "Accept Changes" in the merge card on a deploy preview.
//
// POST body: { prNumber: number }
// Response:  { merged: true, message: string } | { error: string }
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo write access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"

import { NextRequest } from "next/server";

interface GitHubMergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

export async function POST(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return Response.json(
      { error: "Missing GITHUB_TOKEN or GITHUB_REPO" },
      { status: 500 }
    );
  }

  const body = (await req.json()) as { prNumber?: number };

  if (!body.prNumber) {
    return Response.json({ error: "Missing prNumber" }, { status: 400 });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  const mergeRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${body.prNumber}/merge`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ merge_method: "merge" }),
    }
  );

  if (!mergeRes.ok) {
    const errData = (await mergeRes.json()) as { message?: string };
    return Response.json(
      { error: errData.message ?? `GitHub error: ${mergeRes.statusText}` },
      { status: mergeRes.status }
    );
  }

  const data = (await mergeRes.json()) as GitHubMergeResult;
  return Response.json(data);
}
