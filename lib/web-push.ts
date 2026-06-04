// lib/web-push.ts
// Minimal Web Push infrastructure without external dependencies.
// Uses VAPID for authentication and sends no-payload push events.

import { getDb } from "./db/index";
import type { WebPushSubscription, WebPushVapidKeys } from "./db/types";

interface PushSubscriptionJson {
  endpoint: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

export interface SendWebPushOptions {
  title: string;
  body: string;
  url?: string;
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeBase64Url(value: string): string {
  return value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function generateVapidKeys(): Promise<WebPushVapidKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const privatePkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicKey: base64UrlEncode(publicRaw),
    privateKey: base64UrlEncode(privatePkcs8),
    createdAt: Date.now(),
  };
}

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    decodeBase64Url(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

export async function getOrCreateVapidKeys(): Promise<WebPushVapidKeys> {
  const db = await getDb();
  const existing = await db.getWebPushVapidKeys();
  if (existing) return existing;
  const keys = await generateVapidKeys();
  await db.setWebPushVapidKeys(keys);
  return keys;
}

export function parsePushSubscription(value: unknown): PushSubscriptionJson | null {
  if (!value || typeof value !== "object") return null;
  const sub = value as PushSubscriptionJson;
  if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return null;
  if (!sub.keys || typeof sub.keys.p256dh !== "string" || typeof sub.keys.auth !== "string") return null;
  return sub;
}

export async function saveWebPushSubscription(userId: string, value: PushSubscriptionJson): Promise<WebPushSubscription> {
  const db = await getDb();
  const now = Date.now();
  const subscription: WebPushSubscription = {
    id: crypto.randomUUID(),
    userId,
    endpoint: value.endpoint,
    p256dh: value.keys?.p256dh ?? "",
    auth: value.keys?.auth ?? "",
    createdAt: now,
    updatedAt: now,
  };
  await db.upsertWebPushSubscription(subscription);
  return subscription;
}

async function createVapidJwt(audience: string, subject: string, keys: WebPushVapidKeys): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlEncode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject }));
  const signingInput = `${header}.${payload}`;
  const privateKey = await importPrivateKey(keys.privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function sendWebPush(subscription: WebPushSubscription, options: SendWebPushOptions): Promise<{ ok: boolean; status: number; error?: string }> {
  void options;
  const keys = await getOrCreateVapidKeys();
  const endpoint = subscription.endpoint;
  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:primordia@example.invalid";
  const token = await createVapidJwt(audience, subject, keys);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${normalizeBase64Url(keys.publicKey)}`,
      "Crypto-Key": `p256ecdsa=${normalizeBase64Url(keys.publicKey)}`,
      TTL: "60",
      Urgency: "normal",
    },
  });

  if (!res.ok) {
    const error = await res.text().catch(() => "");
    return { ok: false, status: res.status, error };
  }
  return { ok: true, status: res.status };
}
