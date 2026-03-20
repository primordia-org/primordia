// app/api/deploy-context/route.ts
// Server-side endpoint that fetches the PR and its linked issue for Vercel
// deploy previews. Called once on mount by ChatInterface so the chat is
// pre-loaded with "works-in-progress" context.
//
// Response (JSON):
//   { context: string | null }
//
// Returns null when:
//   - VERCEL_GIT_PULL_REQUEST_ID is not set (i.e. production or local)
//   - Required GITHUB_TOKEN / GITHUB_REPO env vars are missing
//   - GitHub API requests fail
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo read access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"

interface GitHubPR {
  number: number;
  title: string;
  body: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
}

export async function GET() {
  const prId = process.env.VERCEL_GIT_PULL_REQUEST_ID;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  // Only meaningful when there's a PR ID (preview deployments)
  if (!prId || !token || !repo) {
    return Response.json({ context: null });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // ── 1. Fetch the PR ────────────────────────────────────────────────────────

  const prRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prId}`,
    { headers }
  );

  if (!prRes.ok) {
    return Response.json({ context: null });
  }

  const pr = (await prRes.json()) as GitHubPR;

  // ── 2. Find the linked issue from the PR body ──────────────────────────────
  // Looks for "Closes #N", "Fixes #N", "Resolves #N" (case-insensitive).

  let issue: GitHubIssue | null = null;
  const issueMatch = pr.body?.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (issueMatch) {
    const issueRes = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueMatch[1]}`,
      { headers }
    );
    if (issueRes.ok) {
      issue = (await issueRes.json()) as GitHubIssue;
    }
  }

  // ── 3. Build the context string ────────────────────────────────────────────

  const lines: string[] = [
    `⚠️ This is a **deploy preview** — a work-in-progress build, not the production app.`,
    `**PR [#${pr.number}](${pr.html_url})**: ${pr.title} (branch: \`${pr.head.ref}\`)`,
  ];

  if (issue) {
    lines.push(
      `**Linked issue [#${issue.number}](${issue.html_url})**: ${issue.title}`
    );
  }

  return Response.json({ context: lines.join("\n"), prNumber: pr.number, prUrl: pr.html_url, prBaseBranch: pr.base.ref });
}
