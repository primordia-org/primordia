// app/api/admin/dependencies-security/route.ts
// Runs `bun audit` for admins and creates evolve sessions to update vulnerable packages.

import { createThread } from "@/lib/threads";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { runBunAudit, writeDependencyAuditNotification, type BunAuditResult } from "@/lib/dependency-audit";

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: Response.json({ error: "Authentication required" }, { status: 401 }) };
  if (!(await isAdmin(user.id))) return { user: null, error: Response.json({ error: "Admin required" }, { status: 403 }) };
  return { user, error: null };
}

function responseForAudit(result: BunAuditResult) {
  return {
    audit: {
      ok: result.ok,
      rawOutput: result.rawOutput,
      jsonText: result.jsonText,
      findings: result.findings,
      severeFindings: result.severeFindings,
      error: result.error,
      checkedAt: result.checkedAt,
    },
  };
}

function errorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message || "Dependency security request failed" }, { status: 500 });
}

export async function GET() {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const result = runBunAudit();
    writeDependencyAuditNotification(process.cwd(), result);
    return Response.json(responseForAudit(result));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (err) {
    return errorResponse(err);
  }
}

async function handlePost(request: Request) {
  const { user, error } = await requireAdmin();
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "refresh") {
    const result = runBunAudit();
    writeDependencyAuditNotification(process.cwd(), result);
    return Response.json(responseForAudit(result));
  }

  if (action === "create-session") {
    const result = runBunAudit();
    writeDependencyAuditNotification(process.cwd(), result);
    const issueList = result.findings.length > 0
      ? result.findings.map((f) => `- ${f.packageName}: ${f.severity} — ${f.title} (${f.id})`).join("\n")
      : "- No structured findings were returned by the initial audit run. Run `bun audit` to inspect the current dependency report.";

    const evolveRequestText =
      `Update vulnerable dependencies reported by bun audit.\n\n` +
      `Goals:\n` +
      `1. Upgrade or patch the vulnerable packages with the smallest safe dependency changes.\n` +
      `2. Preserve existing functionality and avoid unrelated dependency churn.\n` +
      `3. Run \`bun install\`, \`bun audit\`, \`bun run typecheck\`, and \`bun run build\`.\n` +
      `4. If a vulnerable transitive package cannot be updated directly, update the parent dependency or document why it remains.\n\n` +
      `Initial structured findings:\n${issueList}\n\n` +
      `Do not rely on this summary alone; run \`bun audit\` in the worktree for the full current report before editing dependencies.`;

    // Call the evolve session creation helper directly instead of wrapping the
    // prompt in a synthetic Request for the evolve route to parse again. This
    // avoids loopback networking issues and preserves the generated prompt
    // exactly as constructed, including the beginning of long audit prompts.
    const evolveResult = await createThread({
      userId: user!.id,
      requestText: evolveRequestText,
    });

    if (!evolveResult.ok) {
      return Response.json({ error: evolveResult.error ?? "Failed to create thread" }, { status: evolveResult.status });
    }
    return Response.json({ threadId: evolveResult.sessionId });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
