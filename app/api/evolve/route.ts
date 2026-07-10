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
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { complete, type UserMessage } from '@earendil-works/pi-ai';
import { decryptStoredSecretForUser, getEncryptedSecretForUser } from '@/lib/server-secrets';
import {
  startLocalEvolve,
  runGit,
  getRepoRoot,
  getWorktreesDir,
  type LocalSession,
} from '@/lib/evolve-sessions';
import { getSessionUser, hasEvolvePermission } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { PREF_HARNESS, PREF_MODEL, PREF_CAVEMAN, PREF_CAVEMAN_INTENSITY, CAVEMAN_INTENSITIES, DEFAULT_CAVEMAN_INTENSITY, type CavemanIntensity } from '@/lib/user-prefs';
import { normalizeAuthSource, PREF_PRESET, type PresetAuthSource, type SecretAuthSource } from '@/lib/presets';
import {
  getSessionFromFilesystem,
  appendSessionEvent,
  getSessionNdjsonPath,
} from '@/lib/session-events';
import { DEFAULT_HARNESS, DEFAULT_MODEL } from '@/lib/agent-config';
import { writeBranchMarker } from '@/lib/branch-parent';
import { ensurePrimordiaPiModelsJson } from '@/lib/pi-custom-models';


const ANTHROPIC_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';
const OPENAI_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/openai';

type SlugModelProvider = 'anthropic' | 'openai' | 'openai-codex' | 'openrouter' | 'google';

/** Infer the pi provider and strip any Primordia-only model ID namespace. */
function normalizeSlugModelSelection(modelId: string): { provider: SlugModelProvider; modelId: string } {
  if (modelId.startsWith('openai-codex:')) {
    return { provider: 'openai-codex', modelId: modelId.slice('openai-codex:'.length) };
  }
  if (modelId.startsWith('gpt-') || /^o\d/.test(modelId) || modelId.startsWith('codex-')) {
    return { provider: 'openai', modelId };
  }
  if (modelId.startsWith('gemini-')) return { provider: 'google', modelId };
  if (modelId.includes('/')) return { provider: 'openrouter', modelId };
  return { provider: 'anthropic', modelId };
}

function cleanGeneratedSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function fallbackSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-') || 'evolve-session';
}

/** Ask the selected evolve model to choose a short, descriptive kebab-case slug for the request.
 *  Uses the same auth source class selected for the evolve run when possible, and falls back
 *  to a deterministic first-4-words slug if the model call fails. */
async function generateSlug(
  text: string,
  model: string,
  authSource: PresetAuthSource | null,
  apiKey?: string,
  chatGptOAuth?: string,
): Promise<string> {
  try {
    const { provider, modelId } = normalizeSlugModelSelection(model);
    const authStorage = AuthStorage.inMemory();

    if (authSource === 'chatgpt-subscription' && provider === 'openai-codex' && chatGptOAuth) {
      const stored = JSON.parse(chatGptOAuth) as {
        tokens?: {
          accessToken?: string;
          refreshToken?: string;
          accountId?: string | null;
          accessTokenExpiresAt?: number | null;
        };
      };
      const access = stored.tokens?.accessToken;
      const refresh = stored.tokens?.refreshToken;
      if (access && refresh) {
        authStorage.set('openai-codex', {
          type: 'oauth',
          access,
          refresh,
          expires: stored.tokens?.accessTokenExpiresAt ?? 0,
          accountId: stored.tokens?.accountId ?? undefined,
        });
      }
    } else if (apiKey) {
      authStorage.setRuntimeApiKey(provider, apiKey);
    } else if (authSource === 'exe-dev-gateway' || authSource === 'claude-subscription' || authSource === null) {
      // The exe.dev gateway handles Anthropic/OpenAI auth with any non-empty key.
      authStorage.setRuntimeApiKey('anthropic', 'gateway');
      authStorage.setRuntimeApiKey('openai', 'gateway');
    }

    const modelRegistry = ModelRegistry.create(authStorage, ensurePrimordiaPiModelsJson());
    if (!apiKey && (authSource === 'exe-dev-gateway' || authSource === 'claude-subscription' || authSource === null)) {
      modelRegistry.registerProvider('anthropic', { baseUrl: ANTHROPIC_GATEWAY_BASE_URL });
      modelRegistry.registerProvider('openai', { baseUrl: OPENAI_GATEWAY_BASE_URL });
    }

    const selectedModel = modelRegistry.find(provider, modelId);
    if (!selectedModel) throw new Error(`Model '${modelId}' not found for provider '${provider}'`);

    const auth = await modelRegistry.getApiKeyAndHeaders(selectedModel);
    if (!auth.ok) throw new Error(auth.error);

    const userMessage: UserMessage = {
      role: 'user',
      content:
        `Generate a short kebab-case slug (2–4 words, lowercase, hyphens only) that ` +
        `captures the essence of this feature request. Reply with only the slug, nothing else.\n\n` +
        `Request: ${text}`,
      timestamp: Date.now(),
    };

    const response = await complete(
      selectedModel,
      { messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 32 },
    );
    const generatedText = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const cleaned = cleanGeneratedSlug(generatedText);
    if (cleaned.length > 0) return cleaned;
  } catch {
    // Fall through to simple fallback.
  }
  return fallbackSlug(text);
}

/** Return a branch name that doesn't already exist in the repo.
 *  Tries `{slug}` first, then `{slug}-2`, `-3`, … up to -99. */
async function findUniqueBranch(slug: string, repoRoot: string): Promise<string> {
  const base = slug;
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

  return createEvolveSessionFromText({
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
}

export interface CreateEvolveSessionFromTextOptions {
  userId: string;
  requestText: string;
  harness?: string;
  model?: string;
  cavemanMode?: boolean;
  cavemanIntensity?: CavemanIntensity;
  presetId?: string | null;
  authSource?: PresetAuthSource | null;
  primordiaAesKey?: string | null;
  savedAttachmentPaths?: string[];
}

export async function createEvolveSessionFromText({
  userId,
  requestText,
  harness = DEFAULT_HARNESS,
  model = DEFAULT_MODEL,
  cavemanMode = false,
  cavemanIntensity = DEFAULT_CAVEMAN_INTENSITY,
  presetId = null,
  authSource = null,
  primordiaAesKey = null,
  savedAttachmentPaths = [],
}: CreateEvolveSessionFromTextOptions): Promise<Response> {
  const needsStoredSecret = authSource !== null && authSource !== 'exe-dev-gateway';
  if (needsStoredSecret && !primordiaAesKey) {
    return Response.json({ error: 'Selected billing source requires this device’s Primordia AES key. Reconnect the billing source in Settings, then try again.' }, { status: 400 });
  }

  const encryptedSecret = await getEncryptedSecretForUser(userId, authSource);
  if (needsStoredSecret && !encryptedSecret) {
    return Response.json({ error: 'Selected billing source has no stored secret. Reconnect it in Settings, then try again.' }, { status: 400 });
  }

  let decryptedApiKeyForSlug: string | undefined;
  let decryptedChatGptOAuthForSlug: string | undefined;
  if (encryptedSecret && primordiaAesKey) {
    try {
      const decrypted = await decryptStoredSecretForUser(userId, authSource as SecretAuthSource, primordiaAesKey);
      if (authSource === 'chatgpt-subscription') decryptedChatGptOAuthForSlug = decrypted ?? undefined;
      else if (authSource !== 'claude-subscription') decryptedApiKeyForSlug = decrypted ?? undefined;
    } catch {
      return Response.json({ error: 'Could not decrypt the selected billing source. Reconnect it in Settings, then try again.' }, { status: 400 });
    }
  }

  const repoRoot = process.cwd();
  const slug = await generateSlug(
    requestText,
    model,
    authSource,
    decryptedApiKeyForSlug,
    decryptedChatGptOAuthForSlug,
  );
  const branch = await findUniqueBranch(slug, repoRoot);
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
  const repoGitRoot = getRepoRoot(repoRoot);
  const worktreePath = path.join(getWorktreesDir(repoGitRoot), branch);

  const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';
  const parentShaResult = await runGit(['rev-parse', parentBranch], repoRoot);
  if (parentShaResult.code !== 0) {
    return Response.json({ error: `Failed to resolve parent branch ${parentBranch}: ${parentShaResult.stderr}` }, { status: 500 });
  }
  const parentSha = parentShaResult.stdout.trim();

  // Create the git worktree synchronously before returning so the session page
  // is immediately reachable when the client navigates to it after the redirect.
  const wtResult = await runGit(['worktree', 'add', worktreePath, '-b', branch], repoRoot);
  if (wtResult.code !== 0) {
    return Response.json({ error: `Failed to create thread workspace: ${wtResult.stderr}` }, { status: 500 });
  }

  const parentConfigResult = await runGit(['config', `branch.${branch}.parent`, parentBranch], repoRoot);
  if (parentConfigResult.code !== 0) {
    return Response.json({ error: `Failed to record parent branch metadata: ${parentConfigResult.stderr}` }, { status: 500 });
  }

  try {
    writeBranchMarker(worktreePath, parentBranch, parentSha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }

  // Write the initial_request event synchronously so getSessionFromFilesystem()
  // can find the session immediately (the ndjson file is the session existence marker).
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  appendSessionEvent(ndjsonPath, {
    type: 'initial_request',
    request: requestText,
    attachments: savedAttachmentPaths.map(p => path.basename(p)),
    ...(presetId ? { presetId } : {}),
    ...(authSource ? { authSource } : {}),
    harness,
    model,
    ts: Date.now(),
  });

  const session: LocalSession = {
    id: sessionId,
    branch,
    worktreePath,
    status: 'starting',
    devServerStatus: 'none',
    port: null,
    previewUrl: null,
    request: requestText,
    createdAt: Date.now(),
    harness,
    model,
    encryptedSecret: encryptedSecret ?? undefined,
    aesKey: primordiaAesKey ?? undefined,
    authSource,
    userId: userId,
  };
  primordiaAesKey = null;

  // Fire-and-forget — run async so POST returns immediately with the session ID.
  // startLocalEvolve handles all error states internally and writes them to the filesystem.
  void startLocalEvolve(session, requestText, repoRoot, undefined, savedAttachmentPaths, {
    worktreeAlreadyCreated: true,
    initialEventAlreadyWritten: true,
  });

  // Persist the chosen harness/model/caveman as the user's sticky preference.
  // Fire-and-forget — a failure here must not break session creation.
  void (async () => {
    try {
      const db = await getDb();
      await db.setUserPreferences(userId, {
        [PREF_HARNESS]: harness,
        [PREF_MODEL]: model,
        ...(presetId ? { [PREF_PRESET]: presetId } : {}),
        [PREF_CAVEMAN]: String(cavemanMode),
        [PREF_CAVEMAN_INTENSITY]: cavemanIntensity,
      });
    } catch { /* ignore */ }
  })();

  return Response.json({ sessionId });
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
