// app/api/evolve/followup/route.ts
// Accepts a follow-up request for an existing local evolve session.
// POST — submit a follow-up request for a session that is in "ready" state.
//   Body: multipart/form-data or JSON { sessionId: string; request: string; attachments?: File[] }
//   Returns: { ok: true }

import * as path from 'path';
import * as fs from 'fs';
import { getSessionUser } from '../../../../lib/auth';
import { decryptApiKey, decryptHybridCredentials } from '../../../../lib/llm-encryption';
import {
  runFollowupInWorktree,
  type LocalSession,
} from '../../../../lib/evolve-sessions';
import {
  getSessionFromFilesystem,
} from '../../../../lib/session-events';

/** Multipart form-data body for POST /evolve/followup */
export interface EvolveFollowupFormData {
  sessionId: string; // The session ID (git branch name) of the ready session to continue.
  request: string; // The follow-up change request text for Claude Code.
  harness?: string; // Agent harness override for this follow-up run.
  model?: string; // AI model override for this follow-up run.
  encryptedApiKey?: string; // Optional RSA-OAEP encrypted Anthropic API key.
  encryptedCredentials?: string; // Optional hybrid-encrypted Claude Code credentials.json (JSON: { wrappedKey, iv, ciphertext }).
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
  let encryptedApiKey: string | null = null;
  let encryptedCredentials: string | null = null;
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
    const encKeyField = formData.get('encryptedApiKey');
    if (typeof encKeyField === 'string' && encKeyField) encryptedApiKey = encKeyField;
    const encCredsField = formData.get('encryptedCredentials');
    if (typeof encCredsField === 'string' && encCredsField) encryptedCredentials = encCredsField;

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
    const body = (await request.json()) as { sessionId?: string; request?: string; encryptedApiKey?: string; encryptedCredentials?: string };
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return Response.json({ error: 'sessionId string required' }, { status: 400 });
    }
    if (!body.request || typeof body.request !== 'string') {
      return Response.json({ error: 'request string required' }, { status: 400 });
    }
    sessionId = body.sessionId;
    requestText = body.request;
    if (body.encryptedApiKey) encryptedApiKey = body.encryptedApiKey;
    if (body.encryptedCredentials) encryptedCredentials = body.encryptedCredentials;
  }

  // Decrypt the user's API key right before use.
  let decryptedApiKey: string | undefined;
  if (encryptedApiKey) {
    try {
      decryptedApiKey = await decryptApiKey(encryptedApiKey);
    } catch {
      return Response.json({ error: 'Could not decrypt API key. Please try submitting again.' }, { status: 400 });
    }
    encryptedApiKey = null;
  }

  // Decrypt the user's Claude Code credentials (if provided).
  let decryptedCredentials: string | undefined;
  if (encryptedCredentials) {
    try {
      const payload = JSON.parse(encryptedCredentials) as { wrappedKey: string; iv: string; ciphertext: string };
      decryptedCredentials = await decryptHybridCredentials(payload);
    } catch {
      return Response.json({ error: 'Could not decrypt credentials. Please try submitting again.' }, { status: 400 });
    }
    encryptedCredentials = null;
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
    apiKey: decryptedApiKey,
    credentials: decryptedCredentials,
    userId: user.id,
  };
  decryptedApiKey = undefined;
  decryptedCredentials = undefined;

  // Fire-and-forget — runFollowupInWorktree handles all state transitions and
  // error cases internally, writing events to the NDJSON log.
  void runFollowupInWorktree(session, requestText, repoRoot, 'running-claude', undefined, undefined, savedAttachmentPaths);

  return Response.json({ ok: true });
}
