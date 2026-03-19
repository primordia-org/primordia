// app/api/check-keys/route.ts
// Returns a list of missing required environment variables.
// Called on page load by ChatInterface so users get an immediate warning
// if the app is misconfigured.

export async function GET() {
  const isLocalDev = process.env.NODE_ENV === "development";

  // In local development the evolve pipeline runs via git worktrees + Claude Agent SDK,
  // so GITHUB_TOKEN / GITHUB_REPO are not required and should not trigger a warning.
  const checks: Array<{ key: string; description: string }> = [
    { key: "ANTHROPIC_API_KEY", description: "Chat (Anthropic API)" },
    ...(isLocalDev
      ? []
      : [
          { key: "GITHUB_TOKEN", description: "Evolve mode (GitHub API)" },
          { key: "GITHUB_REPO", description: "Evolve mode (GitHub repo)" },
        ]),
  ];

  const missing = checks
    .filter((c) => !process.env[c.key])
    .map((c) => ({ key: c.key, description: c.description }));

  return Response.json({ missing });
}
