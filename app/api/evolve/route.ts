// app/api/evolve/route.ts
// Local development evolve flow — bypasses GitHub entirely.
//
// POST — start a new local evolve session.
//   Body: { request: string }
//   Returns: { sessionId: string }
//
// GET — poll session status.
//   Query: ?sessionId=<id>
//   Returns: { status, port, previewUrl, branch }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser, hasEvolvePermission } from '@/lib/auth';
import { CAVEMAN_INTENSITIES, DEFAULT_CAVEMAN_INTENSITY, type CavemanIntensity } from '@/lib/user-prefs';
import { normalizeAuthSource, type PresetAuthSource } from '@/lib/presets';
import { getSessionFromFilesystem } from '@/lib/session-events';
import { DEFAULT_HARNESS, DEFAULT_MODEL } from '@/lib/agent-config';
import { createEvolveSessionFromText } from '@/lib/evolve-create';

/** Multipart form-data body for POST /evolve */
export interface EvolvePostFormData {
  request: string; // The natural-language change request for Claude Code to implement.
  harness?: string; // Agent harness to use (e.g. 'claude-code'). Defaults to the server default.
  model?: string; // AI model identifier to pass to the agent harness.
  cavemanMode?: string; // Enable caveman communication mode. Pass the string 'true' to enable.
  cavemanIntensity?: string; // Caveman intensity: lite, full, ultra, wenyan-lite, wenyan-full, wenyan-ultra.
  primordiaAesKey?: string; // Optional localStorage primordia_aes_key JWK used server-side to decrypt the selected stored secret.
  attachments?: string; // Optional file attachments copied into the worktree's attachments/ directory.
}

/**
 * Start a new thread
 * @description Start a new AI-powered code-change thread. Accepts multipart/form-data (supports file attachments) or JSON `{ request, primordiaAesKey? }`. Requires `can_evolve` or `admin` role.
 * @tag Evolve
 * @contentType multipart/form-data
 * @body EvolvePostFormData
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

  if (!(await hasEvolvePermission(user.id))) {
    return Response.json({ error: 'You do not have permission to use the evolve flow' }, { status: 403 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let requestText: string;
  let harness: string = DEFAULT_HARNESS;
  let model: string = DEFAULT_MODEL;
  let cavemanMode = false;
  let cavemanIntensity: CavemanIntensity = DEFAULT_CAVEMAN_INTENSITY;
  let presetId: string | null = null;
  let authSource: PresetAuthSource | null = null;
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
    const harnessField = formData.get('harness');
    if (typeof harnessField === 'string' && harnessField) harness = harnessField;
    const modelField = formData.get('model');
    if (typeof modelField === 'string' && modelField) model = modelField;
    const presetField = formData.get('presetId');
    if (typeof presetField === 'string' && presetField) presetId = presetField;
    const authSourceField = formData.get('authSource');
    if (typeof authSourceField === 'string') authSource = normalizeAuthSource(authSourceField);
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
    const body = (await request.json()) as { request?: string; authSource?: string; primordiaAesKey?: string };
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    requestText = body.request;
    if (body.authSource) authSource = normalizeAuthSource(body.authSource);
    if (body.primordiaAesKey) primordiaAesKey = body.primordiaAesKey;
  }

  const result = await createEvolveSessionFromText({
    userId: user.id,
    requestText,
    harness,
    model,
    cavemanMode,
    cavemanIntensity,
    presetId,
    authSource,
    primordiaAesKey,
    savedAttachmentPaths,
  });

  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ sessionId: result.sessionId });
}

/**
 * Poll thread status
 * @description Returns the current status, port, preview URL, thread id, and original request for a thread. Pass `sessionId` as the thread id query parameter.
 * @tag Evolve
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

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId) {
    return Response.json({ error: 'thread id query param required' }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const session = getSessionFromFilesystem(sessionId, repoRoot);
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
