// app/api/thread/route.ts
// Local development thread flow — bypasses GitHub entirely.
//
// POST — start a new thread.
//   Body: { request: string }
//   Returns: { threadId: string }
//
// GET — poll thread status.
//   Query: ?threadId=<id>
//   Returns: { status, port, previewUrl, branch }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser } from '@/lib/auth';
import { CAVEMAN_INTENSITIES, DEFAULT_CAVEMAN_INTENSITY, type CavemanIntensity } from '@/lib/user-prefs';
import { getSessionFromFilesystem } from '@/lib/session-events';
import { createThread } from '@/lib/threads';

/** Multipart form-data body for POST /thread */
export interface ThreadPostFormData {
  request: string; // The natural-language change request for Claude Code to implement.
  presetId?: string; // Preset ID; billing source, harness, and model are resolved from this preset.
  cavemanMode?: string; // Enable caveman communication mode. Pass the string 'true' to enable.
  cavemanIntensity?: string; // Caveman intensity: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra.
  primordiaAesKey?: string; // Optional localStorage primordia_aes_key JWK used server-side to decrypt the selected stored secret.
  attachments?: string; // Optional file attachments copied into the worktree's attachments/ directory.
}

/**
 * Start a new thread
 * @description Start a new AI-powered code-change thread. Accepts multipart/form-data (supports file attachments) or JSON `{ request, primordiaAesKey? }`. Requires `can_evolve` or `admin` role.
 * @tag Thread
 * @contentType multipart/form-data
 * @body ThreadPostFormData
 */
export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

async function handlePost(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let requestText: string;
  let cavemanMode = false;
  let cavemanIntensity: CavemanIntensity = DEFAULT_CAVEMAN_INTENSITY;
  let presetId: string | null = null;
  let primordiaAesKey: string | null = null;
  const savedAttachmentPaths: string[] = [];

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const reqField = formData.get('request');
    if (!reqField || typeof reqField !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    requestText = reqField;
    const presetField = formData.get('presetId');
    if (typeof presetField === 'string' && presetField) presetId = presetField;
    const cavemanModeField = formData.get('cavemanMode');
    if (cavemanModeField === 'true') cavemanMode = true;
    const cavemanIntensityField = formData.get('cavemanIntensity');
    if (typeof cavemanIntensityField === 'string' && (CAVEMAN_INTENSITIES as readonly string[]).includes(cavemanIntensityField)) {
      cavemanIntensity = cavemanIntensityField as CavemanIntensity;
    }
    const aesKeyField = formData.get('primordiaAesKey');
    if (typeof aesKeyField === 'string' && aesKeyField) primordiaAesKey = aesKeyField;

    const files = formData.getAll('attachments');
    if (files.length > 0) {
      const uploadDir = path.join('/tmp', `primordia-upload-${crypto.randomUUID()}`);
      fs.mkdirSync(uploadDir, { recursive: true });
      const usedNames = new Set<string>();
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
        // Sanitize filename to prevent path traversal
        let safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        // Deduplicate: append _1, _2, etc. if the name was already used
        if (usedNames.has(safeName)) {
          const ext = path.extname(safeName);
          const stem = safeName.slice(0, safeName.length - ext.length);
          let counter = 1;
          while (usedNames.has(`${stem}_${counter}${ext}`)) counter++;
          safeName = `${stem}_${counter}${ext}`;
        }
        usedNames.add(safeName);
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, buffer);
        savedAttachmentPaths.push(filePath);
      }
    }
  } else {
    const body = (await request.json()) as { request?: string; presetId?: string; primordiaAesKey?: string };
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    requestText = body.request;
    if (body.presetId) presetId = body.presetId;
    if (body.primordiaAesKey) primordiaAesKey = body.primordiaAesKey;
  }

  const result = await createThread({
    userId: user.id,
    requestText,
    cavemanMode,
    cavemanIntensity,
    presetId,
    primordiaAesKey,
    savedAttachmentPaths,
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ threadId: result.sessionId });
}

/**
 * Poll thread status
 * @description Returns the current status, port, preview URL, thread id, and original request for a thread. Pass `threadId` as the thread id query parameter.
 * @tag Thread
 */
export async function GET(request: Request) {
  try {
    return await handleGet(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

async function handleGet(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  const threadId = new URL(request.url).searchParams.get('threadId');
  if (!threadId) {
    return Response.json({ error: 'threadId query param required' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(threadId, repoRoot);
  if (!session) {
    return Response.json({ error: 'Thread not found' }, { status: 404 });
  }

  return Response.json({
    status: session.status,
    port: session.port,
    previewUrl: session.previewUrl,
    branch: session.branch,
    request: session.request,
  });
}
