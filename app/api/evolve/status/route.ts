// app/api/evolve/status/route.ts
// Polls GitHub for the current status of an evolve issue:
//   - Claude's comment on the issue (the claude-code-action response)
//   - The PR auto-created for the issue (branch naming: claude/issue-{N}-*)
//   - The Vercel deploy preview URL posted as a PR comment
//
// GET /api/evolve/status?issueNumber=N
//
// Response (JSON):
//   {
//     claudeComment:    string | null,   // body of Claude's issue comment
//     claudeCommentUrl: string | null,   // link to view Claude's comment on GitHub
//     prNumber:         number | null,
//     prUrl:            string | null,
//     deployPreviewUrl: string | null,
//   }
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo + issues read access
//   GITHUB_REPO   — "owner/repo" string

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const issueNumberStr = searchParams.get("issueNumber");

  if (!issueNumberStr) {
    return Response.json(
      { error: "issueNumber query param required" },
      { status: 400 }
    );
  }

  const issueNumber = parseInt(issueNumberStr, 10);
  if (isNaN(issueNumber)) {
    return Response.json(
      { error: "issueNumber must be a number" },
      { status: 400 }
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return Response.json(
      { error: "GITHUB_TOKEN and GITHUB_REPO environment variables are required" },
      { status: 500 }
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    // 1. Fetch issue comments — find Claude's response comment
    const commentsRes = await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
      { headers }
    );
    if (!commentsRes.ok) {
      throw new Error(`GitHub API error ${commentsRes.status} fetching issue comments`);
    }
    const issueComments = (await commentsRes.json()) as GitHubComment[];
    const claudeComment = findClaudeComment(issueComments);

    // 2. Find the PR created for this issue
    // The claude-code-action names branches: claude/issue-{N}-{date}-{time}
    const prsRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?state=all&per_page=30&sort=created&direction=desc`,
      { headers }
    );
    if (!prsRes.ok) {
      throw new Error(`GitHub API error ${prsRes.status} fetching PRs`);
    }
    const prs = (await prsRes.json()) as GitHubPR[];
    const matchedPR = prs.find(
      (pr) =>
        pr.head.ref.startsWith(`claude/issue-${issueNumber}-`) ||
        pr.head.ref === `claude/issue-${issueNumber}`
    );

    // 3. If a PR exists, look for Vercel's deploy preview comment
    let deployPreviewUrl: string | null = null;
    if (matchedPR) {
      const prCommentsRes = await fetch(
        `https://api.github.com/repos/${repo}/issues/${matchedPR.number}/comments`,
        { headers }
      );
      if (prCommentsRes.ok) {
        const prComments = (await prCommentsRes.json()) as GitHubComment[];
        deployPreviewUrl = findVercelPreviewUrl(prComments);
      }
    }

    return Response.json({
      claudeComment: claudeComment?.body ?? null,
      claudeCommentUrl: claudeComment?.html_url ?? null,
      prNumber: matchedPR?.number ?? null,
      prUrl: matchedPR?.html_url ?? null,
      deployPreviewUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch status";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string; type: string };
}

interface GitHubPR {
  number: number;
  html_url: string;
  head: { ref: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The claude-code-action posts a comment that contains "Claude Code is working"
// or a "View job run" link. It may be posted by github-actions[bot] or the PAT owner.
function findClaudeComment(comments: GitHubComment[]): GitHubComment | null {
  for (const comment of comments) {
    if (
      comment.body.includes("Claude Code is working") ||
      comment.body.includes("View job run") ||
      comment.body.includes("actions/runs")
    ) {
      return comment;
    }
  }
  return null;
}

// Vercel's GitHub bot posts a comment containing the preview URL.
// The URL pattern is typically: https://<project>-<hash>.vercel.app
function findVercelPreviewUrl(comments: GitHubComment[]): string | null {
  for (const comment of comments) {
    const isVercelComment =
      comment.user.login.toLowerCase().includes("vercel") ||
      comment.body.toLowerCase().includes("vercel") ||
      comment.body.includes("Deploy Preview");

    if (isVercelComment) {
      // Try to extract a vercel.app URL from the comment body
      const match = comment.body.match(/https:\/\/[^\s)<>"]+\.vercel\.app[^\s)<>"']*/);
      if (match) return match[0];
    }
  }
  return null;
}
