// app/api/deploy-context/route.ts
// Server-side endpoint that fetches the PR and its linked issue for Vercel
// deploy previews. Called once on mount by ChatInterface so the chat is
// pre-loaded with "works-in-progress" context.
//
// Response (JSON):
//   { context: string | null, prNumber?: number, prUrl?: string, prState?: "open" | "closed" | "merged", prBranch?: string, prBaseBranch?: string }
//
// Returns null context when:
//   - Not a preview branch (i.e. this is production or local)
//   - Required GITHUB_TOKEN / GITHUB_REPO env vars are missing
//   - GitHub API requests fail
//   - No PR is found (branch push before PR creation, and no PR exists yet)
//
// PR lookup strategy:
//   1. If VERCEL_GIT_PULL_REQUEST_ID is set, use it directly.
//   2. If it is empty (deploy created before PR was opened) and branch is not
//      "main", search for a PR by branch name via the GitHub API.
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo read access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"

interface GitHubPR {
  number: number;
  title: string;
  body: string;
  html_url: string;
  state: "open" | "closed";
  merged_at: string | null;
  head: { ref: string };
  base: { ref: string };
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
}

type PRState = "open" | "closed" | "merged";

function getPRState(pr: GitHubPR): PRState {
  if (pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  return "open";
}

export async function GET() {
  const prId = process.env.VERCEL_GIT_PULL_REQUEST_ID;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.VERCEL_GIT_COMMIT_REF;

  if (!token || !repo) {
    return Response.json({ context: null });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let pr: GitHubPR | null = null;

  if (prId) {
    // ── Strategy 1: PR ID is known — fetch directly ────────────────────────
    const prRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${prId}`,
      { headers }
    );
    if (!prRes.ok) {
      return Response.json({ context: null });
    }
    pr = (await prRes.json()) as GitHubPR;
  } else if (branch && branch !== "main" && branch !== "master") {
    // ── Strategy 2: No PR ID yet — look up PR by branch name ──────────────
    // This happens when Vercel deploys a branch push before any PR is opened.
    const owner = repo.split("/")[0];
    const searchRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(owner)}:${encodeURIComponent(branch)}&state=all&per_page=1`,
      { headers }
    );
    if (searchRes.ok) {
      const prs = (await searchRes.json()) as GitHubPR[];
      if (prs.length > 0) {
        pr = prs[0];
      }
    }
  }

  if (!pr) {
    return Response.json({ context: null });
  }

  const prState = getPRState(pr);

  // ── Find the linked issue from the PR body ─────────────────────────────────
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

  // ── Build the context string ───────────────────────────────────────────────

  const stateLabel =
    prState === "merged" ? " ✅ merged" :
    prState === "closed" ? " 🗑️ closed" : "";

  const lines: string[] = [
    `⚠️ This is a **deploy preview** — a work-in-progress build, not the production app.`,
    `**PR [#${pr.number}](${pr.html_url})**: ${pr.title} (branch: \`${pr.head.ref}\`)${stateLabel}`,
  ];

  if (issue) {
    lines.push(
      `**Linked issue [#${issue.number}](${issue.html_url})**: ${issue.title}`
    );
  }

  return Response.json({
    context: lines.join("\n"),
    prNumber: pr.number,
    prUrl: pr.html_url,
    prState,
    prBranch: pr.head.ref,
    prBaseBranch: pr.base.ref,
  });
}
