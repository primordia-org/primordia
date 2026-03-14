// app/api/evolve/route.ts
// Handles three actions for the evolve pipeline:
//
//   action: "create"  — create a new labeled GitHub Issue (default)
//   action: "search"  — search for existing open evolve issues
//   action: "comment" — add a @claude follow-up comment to an existing issue
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

  // ── action: "search" ─────────────────────────────────────────────────────
  if (action === "search") {
    try {
      const issues = await searchOpenEvolveIssues({ token, repo });
      return Response.json({ issues });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ── action: "comment" ────────────────────────────────────────────────────
  if (action === "comment") {
    if (!body.issueNumber || !body.request) {
      return Response.json(
        { error: "issueNumber and request are required for comment action" },
        { status: 400 }
      );
    }

    const commentBody = buildFollowUpComment(body.request);

    try {
      const result = await postIssueComment({
        token,
        repo,
        issueNumber: body.issueNumber,
        body: commentBody,
      });
      return Response.json({
        outcome: "commented",
        issueNumber: body.issueNumber,
        commentUrl: result.html_url,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to post comment";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // ── action: "create" (default) ───────────────────────────────────────────
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
      outcome: "created",
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

function buildFollowUpComment(userRequest: string): string {
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

interface GitHubIssue {
  number: number;
  html_url: string;
}

interface GitHubComment {
  html_url: string;
}

interface SearchResult {
  number: number;
  title: string;
  html_url: string;
}

async function searchOpenEvolveIssues({
  token,
  repo,
}: {
  token: string;
  repo: string;
}): Promise<SearchResult[]> {
  // Search for open issues with the [Primordia Evolve] title prefix
  const q = encodeURIComponent(
    `[Primordia Evolve] repo:${repo} is:issue is:open`
  );
  const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=5`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub Search API error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    items: Array<{ number: number; title: string; html_url: string }>;
  };

  return data.items.map((item) => ({
    number: item.number,
    title: item.title,
    html_url: item.html_url,
  }));
}

async function postIssueComment({
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
