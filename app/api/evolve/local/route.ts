// app/api/evolve/local/route.ts
// Local development evolve flow — bypasses GitHub entirely.
// Only available when NODE_ENV=development.
//
// POST — start a new local evolve session.
//   Body: { request: string }
//   Returns: { sessionId: string }
//
// GET — poll session status.
//   Query: ?sessionId=<id>
//   Returns: { status, progressText, port, previewUrl, branch }

import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  sessions,
  startLocalEvolve,
  appendProgress,
  runGit,
  type LocalSession,
} from '../../../../lib/local-evolve-sessions';

/** Ask Claude to choose a short, descriptive kebab-case slug for the request.
 *  Falls back to the first-4-words approach if the API call fails. */
async function generateSlug(text: string): Promise<string> {
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content:
            `Generate a short kebab-case slug (2–4 words, lowercase, hyphens only) that ` +
            `captures the essence of this feature request. Reply with only the slug, nothing else.\n\n` +
            `Request: ${text}`,
        },
      ],
    });
    const block = response.content[0];
    if (block.type === 'text') {
      const cleaned = block.text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (cleaned.length > 0) return cleaned;
    }
  } catch {
    // Fall through to simple fallback
  }
  // Fallback: first 4 words
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
}

/** Return an `evolve/…` branch name that doesn't already exist in the repo.
 *  Tries `evolve/{slug}` first, then `evolve/{slug}-2`, `-3`, … up to -99. */
async function findUniqueBranch(slug: string, repoRoot: string): Promise<string> {
  const base = `evolve/${slug}`;
  const taken = async (name: string): Promise<boolean> => {
    const r = await runGit(['branch', '--list', name], repoRoot);
    return r.stdout.trim().length > 0;
  };
  if (!(await taken(base))) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  // Last-resort fallback: append a short timestamp
  return `${base}-${Date.now()}`;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const body = (await request.json()) as { request?: string };
  if (!body.request || typeof body.request !== 'string') {
    return Response.json({ error: 'request string required' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const slug = await generateSlug(body.request);
  const branch = await findUniqueBranch(slug, repoRoot);
  const sessionId = branch.replace(/^evolve\//, '');
  const worktreePath = path.join(repoRoot, '..', 'primordia-worktrees', sessionId);

  const session: LocalSession = {
    id: sessionId,
    branch,
    worktreePath,
    status: 'starting',
    progressText: '',
    port: null,
    previewUrl: null,
    devServerProcess: null,
  };

  sessions.set(sessionId, session);

  // Fire-and-forget — run async so POST returns immediately with the session ID.
  startLocalEvolve(session, body.request, repoRoot).catch((err) => {
    session.status = 'error';
    const msg = err instanceof Error ? err.message : String(err);
    // Include the cause chain if present (e.g. the original SDK process-exit error
    // when we've wrapped it with additional stderr context).
    const causeMsg =
      err instanceof Error && err.cause instanceof Error
        ? `\n\n*Caused by*: ${err.cause.message}`
        : '';
    appendProgress(
      session,
      `\n\n❌ **Error**: ${msg}${causeMsg}\n`,
    );
  });

  return Response.json({ sessionId });
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return Response.json(
      { error: 'Local evolve is only available in development mode' },
      { status: 403 },
    );
  }

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId query param required' }, { status: 400 });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  return Response.json({
    status: session.status,
    progressText: session.progressText,
    port: session.port,
    previewUrl: session.previewUrl,
    branch: session.branch,
  });
}
