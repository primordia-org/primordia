"use client";

import { withBasePath } from "./base-path";

const AES_KEY_STORAGE = "primordia_aes_key";
const CORE_WEB_API_KEY_STORAGE = "primordia_core_web_api_key";

type StoredCoreWebApiKey = {
  shortId: string;
  secret: string;
  createdAt: number;
};

type ApiKeyRecord = {
  shortId: string;
  version: string;
  client: "web";
};

type SessionResponse = {
  user: {
    canStartThreads?: boolean;
  } | null;
};

function parseStoredCoreWebApiKey(value: string | null): StoredCoreWebApiKey | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredCoreWebApiKey>;
    if (typeof parsed.shortId === "string" && typeof parsed.secret === "string") {
      return { shortId: parsed.shortId, secret: parsed.secret, createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now() };
    }
  } catch {
    // Legacy/plain secret values were never shipped, but tolerate them so users
    // can recover by removing the bad value and creating a fresh key.
  }
  return null;
}

function parseBrowserName(ua: string): string {
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Browser";
}

function parseOsName(ua: string): string {
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return "OS";
}

export function browserApiKeyNote(): string {
  if (typeof navigator === "undefined") return "Browser / OS";
  const ua = navigator.userAgent;
  return `${parseBrowserName(ua)} / ${parseOsName(ua)}`;
}

async function getOrCreateStoredAesKeyJson(): Promise<string> {
  const existing = localStorage.getItem(AES_KEY_STORAGE);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as JsonWebKey;
      if (parsed.kty === "oct" && typeof parsed.k === "string" && parsed.k.length > 0) return existing;
    } catch {
      // Replace malformed values below.
    }
  }

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const json = JSON.stringify(jwk);
  localStorage.setItem(AES_KEY_STORAGE, json);
  return json;
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(bytes).toBase64({ alphabet: "base64url", omitPadding: true });
}

async function createApiKeyPayload(existingAesKeyJson: string, note: string, expiresAt: number) {
  const wrapperKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrapperJwk = await crypto.subtle.exportKey("jwk", wrapperKey);
  wrapperJwk.alg = wrapperJwk.alg ?? "A256GCM";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapperKey, new TextEncoder().encode(existingAesKeyJson));
  const encryptedAesKey = JSON.stringify({ iv: iv.toBase64(), ciphertext: new Uint8Array(ciphertext).toBase64() });
  const signature = await sha256Base64Url(JSON.stringify({ client: "web", scopes: "", note, encryptedAesKey, expiresAt }));
  return { encryptedAesKey, signature, alg: wrapperJwk.alg, k: wrapperJwk.k };
}

export function getStoredCoreWebApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return parseStoredCoreWebApiKey(localStorage.getItem(CORE_WEB_API_KEY_STORAGE))?.secret ?? null;
}

async function currentSessionCanStartThreads(): Promise<boolean> {
  const res = await fetch(withBasePath("/api/auth/session"));
  if (!res.ok) return false;
  const data = (await res.json()) as SessionResponse;
  return data.user?.canStartThreads === true;
}

export async function ensureCoreWebApiKey(options: { canStartThreads?: boolean; checkPermission?: boolean } = {}): Promise<string> {
  if (typeof window === "undefined") throw new Error("Browser API keys can only be created in a browser.");
  const stored = parseStoredCoreWebApiKey(localStorage.getItem(CORE_WEB_API_KEY_STORAGE));
  if (stored?.secret) return stored.secret;

  const allowed = options.canStartThreads === true || (options.checkPermission === false ? false : await currentSessionCanStartThreads());
  if (!allowed) throw new Error("Evolve permission is required to create a browser Core API key.");

  const aesKeyJson = await getOrCreateStoredAesKeyJson();
  const note = browserApiKeyNote();
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = await createApiKeyPayload(aesKeyJson, note, expiresAt);
  const res = await fetch(withBasePath("/api/settings/api-keys"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: "web", note, expiresAt, encryptedAesKey: payload.encryptedAesKey, signature: payload.signature }),
  });
  const data = (await res.json()) as { key?: ApiKeyRecord; error?: string };
  if (!res.ok || !data.key) throw new Error(data.error ?? "Failed to create browser Core API key.");
  const secret = `${data.key.version}.${data.key.shortId}.${payload.alg}.${payload.k}`;
  localStorage.setItem(CORE_WEB_API_KEY_STORAGE, JSON.stringify({ shortId: data.key.shortId, secret, createdAt: Date.now() } satisfies StoredCoreWebApiKey));
  return secret;
}

export async function revokeStoredCoreWebApiKey(): Promise<void> {
  if (typeof window === "undefined") return;
  const stored = parseStoredCoreWebApiKey(localStorage.getItem(CORE_WEB_API_KEY_STORAGE));
  localStorage.removeItem(CORE_WEB_API_KEY_STORAGE);
  if (!stored?.shortId) return;
  await fetch(withBasePath("/api/settings/api-keys"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shortId: stored.shortId }),
  });
}

export async function logoutAndRevokeCoreWebApiKey(): Promise<void> {
  const stored = typeof window === "undefined" ? null : parseStoredCoreWebApiKey(localStorage.getItem(CORE_WEB_API_KEY_STORAGE));
  if (typeof window !== "undefined") localStorage.removeItem(CORE_WEB_API_KEY_STORAGE);
  await fetch(withBasePath("/api/auth/logout"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coreWebApiKeyShortId: stored?.shortId ?? null }),
  });
}

export async function coreApiAuthorizationHeaders(): Promise<HeadersInit> {
  const key = await ensureCoreWebApiKey();
  return { Authorization: `Bearer ${key}` };
}
