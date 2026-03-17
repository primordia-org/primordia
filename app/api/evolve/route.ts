// app/api/evolve/route.ts
// Handles three actions for the evolve pipeline:
//
//   action: "search"  — finds open evolve issues in the repo
//   action: "comment" — adds a @claude comment to an existing issue
//   action: "create"  — creates a new labeled GitHub Issue (default)
//
// Request body:
//   { action?: "create"; request: string }
//   { action: "search"; request: string }
//   { action: "comment"; issueNumber: number; request: string }
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo + issues write access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    request?: string;
    issueNumber?: number;
  };

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return Response.json(
      {
        error:
          "GITHUB_TOKEN and GITHUB_REPO environment variables are required. See .env.example.",
      },
      { status: 500 }
    );
  }

  const action = body.action ?? "create";

  // ── Search: find open evolve issues related to the request ─────────────────
  if (action === "search") {
    try {
      const issues = await searchOpenEvolveIssues({
        token,
        repo,
        request: body.request ?? "",
      });
      return Response.json({ issues });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to search issues";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ── Comment: add a @claude follow-up comment to an existing issue or its PR ─
  if (action === "comment") {
    if (!body.issueNumber || !body.request || typeof body.request !== "string") {
      return Response.json(
        { error: "issueNumber and request are required" },
        { status: 400 }
      );
    }
    const commentBody = buildCommentBody(body.request);
    try {
      // If a PR already exists for this issue, comment on the PR instead.
      const existingPr = await findOpenPrForIssue({
        token,
        repo,
        issueNumber: body.issueNumber,
      });
      // GitHub's issue comments endpoint works for PRs too (PRs are issues).
      const targetNumber = existingPr ? existingPr.number : body.issueNumber;
      const result = await addIssueComment({
        token,
        repo,
        issueNumber: targetNumber,
        body: commentBody,
      });
      // Return issueNumber so the frontend can start CI polling on the existing issue.
      // Also return prNumber/prUrl when the comment was posted to a PR.
      return Response.json({
        outcome: "commented",
        issueNumber: body.issueNumber,
        prNumber: existingPr?.number ?? null,
        prUrl: existingPr?.html_url ?? null,
        commentUrl: result.html_url,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to add comment";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ── Create: open a new GitHub Issue (default) ──────────────────────────────
  if (!body.request || typeof body.request !== "string") {
    return Response.json({ error: "request string required" }, { status: 400 });
  }

  const issueBody = buildIssueBody(body.request);

  try {
    const result = await createGitHubIssue({
      token,
      repo,
      title: `[Primordia Evolve] ${body.request.slice(0, 80)}`,
      body: issueBody,
    });

    return Response.json({
      issueNumber: result.number,
      issueUrl: result.html_url,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to create GitHub issue";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildIssueBody(userRequest: string): string {
  const timestamp = new Date().toISOString();

  return `@claude

## User Request

${userRequest}

---

## Metadata

- **Submitted at**: ${timestamp}
- **Source**: Primordia evolve mode (chat interface)

---

## Instructions for Claude Code

> This issue was automatically created by Primordia's evolve pipeline.
> Claude Code will read \`PRIMORDIA.md\` for architecture context, then implement
> the changes described in the "User Request" section above.
>
> After making changes:
> 1. Update the **Changelog** section of \`PRIMORDIA.md\` with a brief entry.
> 2. Commit all changes with a descriptive message.
> 3. The workflow will open a PR and link it back to this issue.
`;
}

function buildCommentBody(userRequest: string): string {
  const timestamp = new Date().toISOString();

  return `@claude

## Follow-up Request

${userRequest}

---

## Metadata

- **Submitted at**: ${timestamp}
- **Source**: Primordia evolve mode (chat interface)

---

## Instructions for Claude Code

> This comment was automatically added by Primordia's evolve pipeline as a follow-up request.
> Claude Code should implement the changes described in the "Follow-up Request" section above.
>
> After making changes:
> 1. Update the **Changelog** section of \`PRIMORDIA.md\` with a brief entry.
> 2. Commit all changes with a descriptive message.
`;
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

interface GitHubIssue {
  number: number;
  html_url: string;
}

interface OpenIssue {
  number: number;
  title: string;
  html_url: string;
}

interface GitHubPR {
  number: number;
  html_url: string;
  head: { ref: string };
}

interface GitHubComment {
  html_url: string;
}

async function findOpenPrForIssue({
  token,
  repo,
  issueNumber,
}: {
  token: string;
  repo: string;
  issueNumber: number;
}): Promise<GitHubPR | null> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) return null;

  const prs = (await response.json()) as GitHubPR[];
  return prs.find((p) => p.head.ref.includes(`issue-${issueNumber}-`)) ?? null;
}

// Extract meaningful keywords from a freeform request string.
// Filters out short words (≤ 3 chars) and limits to the first 6 keywords so
// the GitHub Search query stays concise.
function extractKeywords(request: string): string {
  return request
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
    .join(" ");
}

async function searchOpenEvolveIssues({
  token,
  repo,
  request,
}: {
  token: string;
  repo: string;
  request: string;
}): Promise<OpenIssue[]> {
  // Build a query that requires the evolve prefix in the title AND matches
  // keywords extracted from the user's request anywhere in the issue.
  // This narrows results to issues that are actually related to the request.
  const keywords = extractKeywords(request);
  const queryText = keywords
    ? `repo:${repo} is:issue state:open "[Primordia Evolve]" in:title ${keywords}`
    : `repo:${repo} is:issue state:open "[Primordia Evolve]" in:title`;
  const q = encodeURIComponent(queryText);
  const url = `https://api.github.com/search/issues?q=${q}&sort=created&order=desc&per_page=5`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { items: OpenIssue[] };
  return data.items;
}

async function addIssueComment({
  token,
  repo,
  issueNumber,
  body,
}: {
  token: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<GitHubComment> {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<GitHubComment>;
}

async function createGitHubIssue({
  token,
  repo,
  title,
  body,
}: {
  token: string;
  repo: string;
  title: string;
  body: string;
}): Promise<GitHubIssue> {
  const url = `https://api.github.com/repos/${repo}/issues`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ title, body }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${text}`
    );
  }

  return response.json() as Promise<GitHubIssue>;
}
