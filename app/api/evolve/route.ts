// app/api/evolve/route.ts
// Local development evolve flow — bypasses GitHub entirely.
//
// POST — start a new local evolve session.
//   Body: { request: string }
//   Returns: { sessionId: string }
//
// GET — poll session status.
//   Query: ?sessionId=<id>
//   Returns: { status, progressText, port, previewUrl, branch }

import * as path from 'path';
import * as fs from 'fs';
import { getLlmClient } from '../../../lib/llm-client';
import {
  startLocalEvolve,
  runGit,
  type LocalSession,
} from '../../../lib/evolve-sessions';
import { getSessionUser, hasEvolvePermission } from '../../../lib/auth';
import { getDb } from '../../../lib/db';
import { getPublicOrigin } from '../../../lib/public-origin';

/** Ask Claude to choose a short, descriptive kebab-case slug for the request.
 *  Falls back to the first-4-words approach if the API call fails. */
async function generateSlug(text: string): Promise<string> {
  try {
    const { client } = await getLlmClient();
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

/** Return a branch name that doesn't already exist in the repo or the DB.
 *  Tries `{slug}` first, then `{slug}-2`, `-3`, … up to -99.
 *  Since sessionId === branch, we check both git and the evolve_sessions table
 *  to avoid UNIQUE constraint failures when a slug is reused after rejection. */
async function findUniqueBranch(
  slug: string,
  repoRoot: string,
  sessionExists: (id: string) => Promise<boolean>,
): Promise<string> {
  const base = slug;
  const taken = async (name: string): Promise<boolean> => {
    const r = await runGit(['branch', '--list', name], repoRoot);
    if (r.stdout.trim().length > 0) return true;
    return sessionExists(name);
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
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  if (!(await hasEvolvePermission(user.id))) {
    return Response.json({ error: 'You do not have permission to use the evolve flow' }, { status: 403 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let requestText: string;
  const savedAttachmentPaths: string[] = [];

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const reqField = formData.get('request');
    if (!reqField || typeof reqField !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    requestText = reqField;

    const files = formData.getAll('attachments');
    if (files.length > 0) {
      const uploadDir = path.join('/tmp', `primordia-upload-${crypto.randomUUID()}`);
      fs.mkdirSync(uploadDir, { recursive: true });
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
        // Sanitize filename to prevent path traversal
        const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, buffer);
        savedAttachmentPaths.push(filePath);
      }
    }
  } else {
    const body = (await request.json()) as { request?: string };
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    requestText = body.request;
  }

  const repoRoot = process.cwd();
  const slug = await generateSlug(requestText);
  const db = await getDb();
  const branch = await findUniqueBranch(slug, repoRoot, async (id) => {
    const existing = await db.getEvolveSession(id);
    return existing !== null;
  });
  const sessionId = branch;

  // Derive the worktree path from the git common dir so it is stable even when
  // this server is itself running inside a git worktree (which would otherwise
  // cause unbounded nesting like primordia-worktrees/primordia-worktrees/…).
  //
  // In the flat layout ($PRIMORDIA_DIR/main), the common dir resolves to
  // $PRIMORDIA_DIR/main/.git, so mainRepoRoot = $PRIMORDIA_DIR/main and
  // worktrees live at $PRIMORDIA_DIR/{branch} — siblings of "main", never nested.
  //
  // In the legacy layout (/home/exedev/primordia) we fall back to the classic
  // ../primordia-worktrees/{branch} path so existing installs keep working.
  const gitCommonDirResult = await runGit(['rev-parse', '--git-common-dir'], repoRoot);
  const gitCommonDir = path.resolve(repoRoot, gitCommonDirResult.stdout.trim());
  const mainRepoRoot = path.dirname(gitCommonDir); // strip trailing /.git
  const worktreePath =
    path.basename(mainRepoRoot) === 'main'
      ? path.join(path.dirname(mainRepoRoot), branch)           // flat layout
      : path.join(mainRepoRoot, '..', 'primordia-worktrees', branch); // legacy

  const session: LocalSession = {
    id: sessionId,
    branch,
    worktreePath,
    status: 'starting',
    devServerStatus: 'none',
    progressText: '',
    port: null,
    previewUrl: null,
    request: requestText,
    createdAt: Date.now(),
  };

  // Persist to DB so the session page is reachable immediately after redirect.
  await db.createEvolveSession({
    id: session.id,
    branch: session.branch,
    worktreePath: session.worktreePath,
    status: session.status,
    progressText: session.progressText,
    port: session.port,
    previewUrl: session.previewUrl,
    request: session.request,
    createdAt: session.createdAt,
  });

  // Determine the public origin for preview URLs using x-forwarded-* headers
  // so the URL is correct when running behind a reverse proxy (e.g. exe.dev).
  const publicOrigin = getPublicOrigin(request);

  // Fire-and-forget — run async so POST returns immediately with the session ID.
  // startLocalEvolve handles all error states internally and writes them to SQLite.
  void startLocalEvolve(session, requestText, repoRoot, publicOrigin, savedAttachmentPaths);

  return Response.json({ sessionId });
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'sessionId query param required' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const session = await db.getEvolveSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({
      status: session.status,
      progressText: session.progressText,
      port: session.port,
      previewUrl: session.previewUrl,
      branch: session.branch,
      request: session.request,
    });
  } catch {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }
}
