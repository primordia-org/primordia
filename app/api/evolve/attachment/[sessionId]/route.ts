// app/api/evolve/attachment/[sessionId]/route.ts
// Serves user-uploaded attachment files from a session's worktree.
//
// GET /api/evolve/attachment/{sessionId}?file={filename}
//
// Reads the file from {worktreePath}/attachments/{filename} and streams it
// back with the appropriate Content-Type header.

import * as fs from 'fs';
import * as path from 'path';
import { type NextRequest } from 'next/server';
import { getSessionUser } from '../../../../../lib/auth';
import { getSessionFromFilesystem } from '../../../../../lib/session-events';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico']);
const INLINE_TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.csv']);

function mimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    // .md served as text/plain so browsers render it inline rather than downloading
    '.md': 'text/plain; charset=utf-8',
    '.json': 'application/json',
    '.csv': 'text/plain; charset=utf-8',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { sessionId } = await params;
  const filename = request.nextUrl.searchParams.get('file');

  if (!filename) {
    return new Response('Missing file parameter', { status: 400 });
  }

  // Prevent path traversal
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename) {
    return new Response('Invalid filename', { status: 400 });
  }

  const session = getSessionFromFilesystem(sessionId, process.cwd());
  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  const filePath = path.join(session.worktreePath, 'attachments', safeName);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response('File not found', { status: 404 });
  }

  if (!stat.isFile()) {
    return new Response('Not a file', { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  const ext = path.extname(safeName).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isInlineText = INLINE_TEXT_EXTENSIONS.has(ext);

  return new Response(data, {
    headers: {
      'Content-Type': mimeType(safeName),
      'Content-Length': String(stat.size),
      // Inline for images and plain-text formats so the browser displays them; attachment for other files
      'Content-Disposition': (isImage || isInlineText)
        ? `inline; filename="${safeName}"`
        : `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
