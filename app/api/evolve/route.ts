// app/api/evolve/route.ts
// Receives an "evolve" request from the chat interface and creates a labeled
// GitHub Issue. The GitHub Actions workflow `evolve.yml` watches for this label
// and runs Claude Code CLI to generate a PR.
//
// Request body:
//   { request: string }   — the user's natural-language change description
//
// Response (JSON):
//   { issueNumber: number, issueUrl: string }
//
// Required environment variables:
//   GITHUB_TOKEN  — personal access token with repo + issues write access
//   GITHUB_REPO   — "owner/repo" string, e.g. "alice/primordia"
//   EVOLVE_LABEL  — label name to apply (default: "primordia-evolve")

export async function POST(request: Request) {
  const body = (await request.json()) as { request?: string };

  if (!body.request || typeof body.request !== "string") {
    return Response.json({ error: "request string required" }, { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const label = process.env.EVOLVE_LABEL ?? "primordia-evolve";

  if (!token || !repo) {
    return Response.json(
      {
        error:
          "GITHUB_TOKEN and GITHUB_REPO environment variables are required. See .env.example.",
      },
      { status: 500 }
    );
  }

  // Build a rich issue body so Claude Code has full context when it runs in CI
  const issueBody = buildIssueBody(body.request);

  try {
    const result = await createGitHubIssue({
      token,
      repo,
      title: `[Primordia Evolve] ${body.request.slice(0, 80)}`,
      body: issueBody,
      labels: [label],
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

interface GitHubIssue {
  number: number;
  html_url: string;
}

async function createGitHubIssue({
  token,
  repo,
  title,
  body,
  labels,
}: {
  token: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
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
    body: JSON.stringify({ title, body, labels }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API error ${response.status}: ${text}`
    );
  }

  return response.json() as Promise<GitHubIssue>;
}
