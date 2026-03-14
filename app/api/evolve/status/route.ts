// app/api/evolve/status/route.ts
// Polls GitHub for the live state of an evolve pipeline run.
// Called repeatedly by the chat UI to show CI progress in real time.
//
// Query params:
//   issueNumber=N  — the GitHub issue number to check
//
// Response (JSON):
//   {
//     claudeComment?: { body: string; htmlUrl: string; updatedAt: string },
//     pr?: { number: number; htmlUrl: string; title: string },
//     deployPreviewUrl?: string
//   }
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo + issues read access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"

interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  updated_at: string;
  user: { login: string; type: string };
}

interface GitHubPR {
  number: number;
  html_url: string;
  title: string;
  head: { ref: string };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const issueNumber = parseInt(searchParams.get("issueNumber") ?? "", 10);

  if (isNaN(issueNumber)) {
    return Response.json(
      { error: "issueNumber query param required" },
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

  // ── 1. Fetch issue comments — find Claude's comment ──────────────────────

  let claudeComment:
    | { body: string; htmlUrl: string; updatedAt: string }
    | undefined;

  const commentsRes = await fetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=50`,
    { headers }
  );

  if (commentsRes.ok) {
    const comments = (await commentsRes.json()) as GitHubComment[];

    // Claude's comment is posted by a Bot user or a user whose login contains
    // "claude". The claude-code-action posts under whichever account is
    // configured, but it's always distinct from the human issue author.
    const claudeCommentRaw = comments.find(
      (c) =>
        c.user.type === "Bot" ||
        c.user.login.toLowerCase().includes("claude")
    );

    if (claudeCommentRaw) {
      claudeComment = {
        body: claudeCommentRaw.body,
        htmlUrl: claudeCommentRaw.html_url,
        updatedAt: claudeCommentRaw.updated_at,
      };
    }
  }

  // ── 2. Find the PR for this issue (branch: claude/issue-{N}-*) ───────────

  let pr: { number: number; htmlUrl: string; title: string } | undefined;
  let deployPreviewUrl: string | undefined;

  const prsRes = await fetch(
    `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`,
    { headers }
  );

  if (prsRes.ok) {
    const prs = (await prsRes.json()) as GitHubPR[];

    const matchingPr = prs.find((p) =>
      p.head.ref.includes(`issue-${issueNumber}-`)
    );

    if (matchingPr) {
      pr = {
        number: matchingPr.number,
        htmlUrl: matchingPr.html_url,
        title: matchingPr.title,
      };

      // ── 3. Scan PR comments for a Vercel deploy preview URL ─────────────

      const prCommentsRes = await fetch(
        `https://api.github.com/repos/${repo}/issues/${matchingPr.number}/comments?per_page=30`,
        { headers }
      );

      if (prCommentsRes.ok) {
        const prComments = (await prCommentsRes.json()) as GitHubComment[];

        for (const comment of prComments) {
          const match = comment.body.match(/https:\/\/[\w-]+\.vercel\.app/);
          if (match) {
            deployPreviewUrl = match[0];
            break;
          }
        }
      }
    }
  }

  return Response.json({ claudeComment, pr, deployPreviewUrl });
}
