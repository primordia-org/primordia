// lib/evolve-create.ts
// Shared evolve thread creation logic used by API routes and CLI commands.

import * as path from 'path';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { complete, type UserMessage } from '@earendil-works/pi-ai';
import { decryptStoredSecretForUser, getEncryptedSecretForUser } from '@/lib/server-secrets';
import { startLocalEvolve, runGit, getRepoRoot, getWorktreesDir, type LocalSession } from '@/lib/evolve-sessions';
import { getDb } from '@/lib/db';
import { PREF_HARNESS, PREF_MODEL, PREF_CAVEMAN, PREF_CAVEMAN_INTENSITY, DEFAULT_CAVEMAN_INTENSITY, type CavemanIntensity } from '@/lib/user-prefs';
import { PREF_PRESET, type PresetAuthSource, type SecretAuthSource } from '@/lib/presets';
import { appendSessionEvent, getSessionNdjsonPath } from '@/lib/session-events';
import { DEFAULT_HARNESS, DEFAULT_MODEL } from '@/lib/agent-config';
import { writeBranchMarker } from '@/lib/branch-parent';
import { ensurePrimordiaPiModelsJson } from '@/lib/pi-custom-models';

const ANTHROPIC_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/anthropic';
const OPENAI_GATEWAY_BASE_URL = 'http://169.254.169.254/gateway/llm/openai';

type SlugModelProvider = 'anthropic' | 'openai' | 'openai-codex' | 'openrouter' | 'google';

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
  /** When false, await setup/agent work before returning. CLI callers use this so the process stays alive. */
  runInBackground?: boolean;
}

export type CreateEvolveSessionResult =
  | { ok: true; status: 200; sessionId: string }
  | { ok: false; status: 400 | 500; error: string };

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

/** Ask the selected evolve model to choose a short, descriptive kebab-case slug for the request. */
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

/** Return a branch name that doesn't already exist in the repo. */
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
  return `${base}-${Date.now()}`;
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
  runInBackground = true,
}: CreateEvolveSessionFromTextOptions): Promise<CreateEvolveSessionResult> {
  const needsStoredSecret = authSource !== null && authSource !== 'exe-dev-gateway';
  if (needsStoredSecret && !primordiaAesKey) {
    return { ok: false, status: 400, error: 'Selected billing source requires this device’s Primordia AES key. Reconnect the billing source in Settings, then try again.' };
  }

  const encryptedSecret = await getEncryptedSecretForUser(userId, authSource);
  if (needsStoredSecret && !encryptedSecret) {
    return { ok: false, status: 400, error: 'Selected billing source has no stored secret. Reconnect it in Settings, then try again.' };
  }

  let decryptedApiKeyForSlug: string | undefined;
  let decryptedChatGptOAuthForSlug: string | undefined;
  if (encryptedSecret && primordiaAesKey) {
    try {
      const decrypted = await decryptStoredSecretForUser(userId, authSource as SecretAuthSource, primordiaAesKey);
      if (authSource === 'chatgpt-subscription') decryptedChatGptOAuthForSlug = decrypted ?? undefined;
      else if (authSource !== 'claude-subscription') decryptedApiKeyForSlug = decrypted ?? undefined;
    } catch {
      return { ok: false, status: 400, error: 'Could not decrypt the selected billing source. Reconnect it in Settings, then try again.' };
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
  // this server is itself running inside a git worktree.
  const repoGitRoot = getRepoRoot(repoRoot);
  const worktreePath = path.join(getWorktreesDir(repoGitRoot), branch);

  const parentBranchResult = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const parentBranch = parentBranchResult.stdout.trim() || 'main';
  const parentShaResult = await runGit(['rev-parse', parentBranch], repoRoot);
  if (parentShaResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to resolve parent branch ${parentBranch}: ${parentShaResult.stderr}` };
  }
  const parentSha = parentShaResult.stdout.trim();

  // Create the git worktree synchronously before returning so the session page
  // is immediately reachable when the client navigates to it after the redirect.
  const wtResult = await runGit(['worktree', 'add', worktreePath, '-b', branch], repoRoot);
  if (wtResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to create thread workspace: ${wtResult.stderr}` };
  }

  const parentConfigResult = await runGit(['config', `branch.${branch}.parent`, parentBranch], repoRoot);
  if (parentConfigResult.code !== 0) {
    return { ok: false, status: 500, error: `Failed to record parent branch metadata: ${parentConfigResult.stderr}` };
  }

  try {
    writeBranchMarker(worktreePath, parentBranch, parentSha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 500, error: msg };
  }

  // Write the initial_request event synchronously so getSessionFromFilesystem()
  // can find the session immediately (the ndjson file is the session existence marker).
  const ndjsonPath = getSessionNdjsonPath(worktreePath);
  appendSessionEvent(ndjsonPath, {
    type: 'initial_request',
    request: requestText,
    attachments: savedAttachmentPaths.map((p) => path.basename(p)),
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
    aesKey: primordiaAesKey ?? undefined,
    authSource,
    userId,
  };
  primordiaAesKey = null;

  const startPromise = startLocalEvolve(session, requestText, repoRoot, undefined, savedAttachmentPaths, {
    worktreeAlreadyCreated: true,
    initialEventAlreadyWritten: true,
  });

  if (runInBackground) {
    // Fire-and-forget — run async so POST returns immediately with the session ID.
    // startLocalEvolve handles all error states internally and writes them to the filesystem.
    void startPromise;
  } else {
    // CLI callers must keep the process alive until the worker exits.
    await startPromise;
  }

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

  return { ok: true, status: 200, sessionId };
}
