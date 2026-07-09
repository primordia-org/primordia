// app/api/evolve/followup/route.ts
// Accepts a follow-up request for an existing local evolve session.
// POST — submit a follow-up request for a session that is in "ready" state.
//   Body: multipart/form-data or JSON { sessionId: string; request: string; attachments?: File[] }
//   Returns: { ok: true }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser } from '@/lib/auth';
import { resolveStoredSecretForWorker } from '@/lib/evolve-secret-resolution';
import {
  runFollowupInWorktree,
  type LocalSession,
} from '@/lib/evolve-sessions';
import {
  getSessionFromFilesystem,
} from '@/lib/session-events';
import { normalizeAuthSource, type PresetAuthSource } from '@/lib/presets';

/** Multipart form-data body for POST /evolve/followup */
export interface EvolveFollowupFormData {
  sessionId: string; // The session ID (git branch name) of the ready session to continue.
  request: string; // The follow-up change request text for Claude Code.
  harness?: string; // Agent harness override for this follow-up run.
  model?: string; // AI model override for this follow-up run.
  credentialProof?: string; // Signed credential proof used by the server to derive PRIMORDIA_DECRYPTION_KEY.
  attachments?: string; // Optional additional file attachments to include in this follow-up run.
}

/**
 * Submit a follow-up evolve request
 * @description Send an additional change request to an already-ready evolve session. Accepts multipart/form-data (supports file attachments) or JSON `{ sessionId, request, encryptedApiKey? }`.
 * @tag Evolve
 * @contentType multipart/form-data
 * @body EvolveFollowupFormData
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Parse request body — supports both JSON (legacy) and multipart/form-data (with file attachments).
  let sessionId: string;
  let requestText: string;
  let harness: string | undefined;
  let model: string | undefined;
  let authSource: PresetAuthSource | null = null;
  let presetId: string | undefined;
  let credentialProof: string | null = null;
  const savedAttachmentPaths: string[] = [];

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const sidField = formData.get('sessionId');
    const reqField = formData.get('request');
    if (!sidField || typeof sidField !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!reqField || typeof reqField !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = sidField;
    requestText = reqField;
    const harnessField = formData.get('harness');
    const modelField = formData.get('model');
    if (typeof harnessField === 'string' && harnessField) harness = harnessField;
    if (typeof modelField === 'string' && modelField) model = modelField;
    const presetField = formData.get('presetId');
    if (typeof presetField === 'string' && presetField) presetId = presetField;
    const authSourceField = formData.get('authSource');
    if (typeof authSourceField === 'string') authSource = normalizeAuthSource(authSourceField);
    const credentialProofField = formData.get('credentialProof');
    if (typeof credentialProofField === 'string' && credentialProofField) credentialProof = credentialProofField;

    const files = formData.getAll('attachments');
    if (files.length > 0) {
      const uploadDir = path.join('/tmp', `primordia-upload-${crypto.randomUUID()}`);
      fs.mkdirSync(uploadDir, { recursive: true });
      const usedNames = new Set<string>();
      for (const file of files) {
        if (!(file instanceof File) || file.size === 0) continue;
        const buffer = Buffer.from(await file.arrayBuffer());
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
    const body = (await request.json()) as { sessionId?: string; request?: string; harness?: string; model?: string; presetId?: string; authSource?: string; credentialProof?: string };
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = body.sessionId;
    requestText = body.request;
    if (body.harness) harness = body.harness;
    if (body.model) model = body.model;
    if (body.presetId) presetId = body.presetId;
    if (body.authSource) authSource = normalizeAuthSource(body.authSource);
    if (body.credentialProof) credentialProof = body.credentialProof;
  }

  let decryptionKey: string | undefined;
  let hasStoredSecret = false;
  try {
    const resolvedSecret = await resolveStoredSecretForWorker(user.id, authSource, credentialProof);
    decryptionKey = resolvedSecret.decryptionKey;
    hasStoredSecret = resolvedSecret.hasStoredSecret;
  } catch {
    return Response.json({ error: 'Could not derive the decryption key for your selected billing source. Please reconnect it in Settings → Billing sources, then try again.' }, { status: 400 });
  }

  if (authSource && authSource !== 'exe-dev-gateway' && (!hasStoredSecret || !decryptionKey)) {
    return Response.json(
      { error: 'Selected billing source has no decryptable stored secret on this device. Reconnect it in Settings → Billing sources, then try again.' },
      { status: 400 },
    );
  }

  const repoRoot = process.cwd();
  const record = getSessionFromFilesystem(sessionId, repoRoot);
  if (!record) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  if (record.status !== 'ready') {
    return Response.json(
      { error: `Session is not in a state that accepts follow-up requests (current status: ${record.status})` },
      { status: 400 },
    );
  }

  // Build the LocalSession object from the filesystem record.
  const session: LocalSession = {
    id: record.id,
    branch: record.branch,
    worktreePath: record.worktreePath,
    status: record.status as LocalSession['status'],
    devServerStatus: 'running',
    port: record.port,
    previewUrl: record.previewUrl,
    request: record.request,
    createdAt: record.createdAt,
    harness,
    model,
    decryptionKey,
    authSource,
    userId: user.id,
  };

  // Fire-and-forget — runFollowupInWorktree handles all state transitions and
  // error cases internally, writing events to the NDJSON log.
  void runFollowupInWorktree(session, requestText, repoRoot, 'running-claude', undefined, undefined, savedAttachmentPaths, {
    ...(presetId ? { presetId } : {}),
    ...(authSource ? { authSource } : {}),
    ...(harness ? { harness } : {}),
    ...(model ? { model } : {}),
  });

  return Response.json({ ok: true });
}
