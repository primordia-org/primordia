// lib/chatgpt-subscription.ts
// Helpers for converting Primordia's encrypted ChatGPT subscription credentials
// to/from the OAuth credential shapes used by pi and Codex.

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

export interface StoredChatGptSubscriptionCredentials {
  authMode: 'chatgpt';
  issuer?: string;
  clientId?: string;
  tokens?: {
    idToken?: string;
    accessToken?: string;
    refreshToken?: string;
    accountId?: string | null;
    accessTokenExpiresAt?: number | null;
  };
  lastRefresh?: string;
}

export interface PiChatGptOAuthCredential {
  [key: string]: unknown;
  type: 'oauth';
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getJwtExpiresAt(token: string | undefined): number | null {
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  return typeof claims?.exp === 'number' ? claims.exp * 1000 : null;
}

export function parseStoredChatGptSubscriptionCredentials(raw: string): StoredChatGptSubscriptionCredentials {
  const parsed = JSON.parse(raw) as StoredChatGptSubscriptionCredentials;
  if (parsed?.authMode !== 'chatgpt') throw new Error('Stored ChatGPT credentials have an invalid auth mode.');
  return parsed;
}

export function storedChatGptCredentialsToPiOAuth(raw: string): PiChatGptOAuthCredential {
  const stored = parseStoredChatGptSubscriptionCredentials(raw);
  const access = stored.tokens?.accessToken;
  const refresh = stored.tokens?.refreshToken;
  if (!access || !refresh) {
    throw new Error('Stored ChatGPT subscription credentials are missing access or refresh tokens. Reconnect ChatGPT in Settings → Billing sources.');
  }
  return {
    type: 'oauth',
    access,
    refresh,
    expires: stored.tokens?.accessTokenExpiresAt ?? getJwtExpiresAt(access) ?? 0,
    accountId: stored.tokens?.accountId ?? undefined,
  };
}

export function piOAuthToStoredChatGptCredentials(rawExisting: string, credential: PiChatGptOAuthCredential): string {
  const existing = parseStoredChatGptSubscriptionCredentials(rawExisting);
  const nextExpiresAt = credential.expires || getJwtExpiresAt(credential.access);
  if (
    existing.tokens?.accessToken === credential.access &&
    existing.tokens.refreshToken === credential.refresh &&
    (existing.tokens.accountId ?? undefined) === credential.accountId &&
    (existing.tokens.accessTokenExpiresAt ?? null) === (nextExpiresAt ?? null)
  ) {
    return rawExisting;
  }
  return JSON.stringify({
    ...existing,
    issuer: existing.issuer ?? CHATGPT_ISSUER,
    clientId: existing.clientId ?? CHATGPT_CLIENT_ID,
    tokens: {
      ...existing.tokens,
      accessToken: credential.access,
      refreshToken: credential.refresh,
      accountId: credential.accountId ?? existing.tokens?.accountId ?? null,
      accessTokenExpiresAt: nextExpiresAt,
    },
    lastRefresh: new Date().toISOString(),
  });
}

export function codexAuthJsonToStoredChatGptCredentials(rawExisting: string, rawCodexAuthJson: string): string | null {
  const existing = parseStoredChatGptSubscriptionCredentials(rawExisting);
  const parsed = JSON.parse(rawCodexAuthJson) as {
    auth_mode?: string;
    tokens?: {
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
      account_id?: string | null;
    };
    last_refresh?: string;
  };
  if (parsed.auth_mode !== 'chatgpt' || !parsed.tokens?.access_token || !parsed.tokens.refresh_token) return null;
  const nextExpiresAt = getJwtExpiresAt(parsed.tokens.access_token);
  if (
    existing.tokens?.idToken === (parsed.tokens.id_token ?? existing.tokens?.idToken) &&
    existing.tokens?.accessToken === parsed.tokens.access_token &&
    existing.tokens.refreshToken === parsed.tokens.refresh_token &&
    (existing.tokens.accountId ?? null) === (parsed.tokens.account_id ?? existing.tokens?.accountId ?? null) &&
    (existing.tokens.accessTokenExpiresAt ?? null) === (nextExpiresAt ?? null)
  ) {
    return rawExisting;
  }

  return JSON.stringify({
    ...existing,
    issuer: existing.issuer ?? CHATGPT_ISSUER,
    clientId: existing.clientId ?? CHATGPT_CLIENT_ID,
    tokens: {
      ...existing.tokens,
      idToken: parsed.tokens.id_token ?? existing.tokens?.idToken,
      accessToken: parsed.tokens.access_token,
      refreshToken: parsed.tokens.refresh_token,
      accountId: parsed.tokens.account_id ?? existing.tokens?.accountId ?? null,
      accessTokenExpiresAt: nextExpiresAt,
    },
    lastRefresh: parsed.last_refresh ?? new Date().toISOString(),
  });
}
