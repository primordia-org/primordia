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
import { createNameId } from 'mnemonic-id';
import Anthropic from '@anthropic-ai/sdk';
import {
  sessions,
  startLocalEvolve,
  appendProgress,
  type LocalSession,
} from '../../../../lib/local-evolve-sessions';

/** Ask Claude to choose a short, descriptive kebab-case slug for the request.
 *  Falls back to the first-5-words approach if the API call fails. */
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
            `Generate a short kebab-case slug (3–5 words, lowercase, hyphens only) that ` +
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
  // Fallback: first 5 words
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-');
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

  const slug = await generateSlug(body.request);
  const mnemonicId = createNameId();
  const sessionId = slug ? `${slug}-${mnemonicId}` : mnemonicId;
  const branch = `evolve/${sessionId}`;
  const repoRoot = process.cwd();
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
    appendProgress(
      session,
      `\n\n❌ **Error**: ${err instanceof Error ? err.message : String(err)}\n`,
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
