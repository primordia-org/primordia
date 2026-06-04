// lib/web-push.ts
// Minimal Web Push infrastructure without external dependencies.
// Uses VAPID for authentication and RFC 8291 aes128gcm payload encryption.

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

function toUint8Array(value: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

function concatBytes(...parts: Array<ArrayBuffer | Uint8Array | string>): Uint8Array {
  const arrays = parts.map(toUint8Array);
  const totalLength = arrays.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of arrays) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function sliceArrayBuffer(bytes: Uint8Array, start = 0, end = bytes.byteLength): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + end) as ArrayBuffer;
}

async function hmacSha256(keyBytes: ArrayBuffer | Uint8Array, data: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes instanceof Uint8Array ? sliceArrayBuffer(keyBytes) : keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dataBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    dataBytes instanceof Uint8Array ? sliceArrayBuffer(dataBytes) : dataBytes
  );
  return new Uint8Array(signature);
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

async function encryptWebPushPayload(subscription: WebPushSubscription, options: SendWebPushOptions): Promise<Uint8Array> {
  const userAgentPublicKey = decodeBase64Url(subscription.p256dh);
  const authSecret = decodeBase64Url(subscription.auth);
  const serverKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const serverPublicKey = await crypto.subtle.exportKey("raw", serverKeys.publicKey);
  const userAgentKey = await crypto.subtle.importKey(
    "raw",
    userAgentPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: userAgentKey },
    serverKeys.privateKey,
    256
  );

  // RFC 8291: authenticate the ECDH secret with the subscription auth secret,
  // then mix both public keys into the input keying material.
  const keyInfo = concatBytes("WebPush: info", new Uint8Array([0]), userAgentPublicKey, serverPublicKey);
  const authPrk = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hmacSha256(authPrk, keyInfo);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concatBytes("Content-Encoding: aes128gcm", new Uint8Array([0, 1]));
  const nonceInfo = concatBytes("Content-Encoding: nonce", new Uint8Array([0, 1]));
  const cek = (await hmacSha256(prk, cekInfo)).slice(0, 16);
  const nonce = (await hmacSha256(prk, nonceInfo)).slice(0, 12);

  const plaintext = concatBytes(JSON.stringify({
    title: options.title,
    body: options.body,
    url: options.url,
    tag: "primordia-web-push-test",
  }), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", sliceArrayBuffer(cek), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: sliceArrayBuffer(nonce), tagLength: 128 },
    aesKey,
    sliceArrayBuffer(plaintext)
  ));

  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096-byte records.
  return concatBytes(salt, recordSize, new Uint8Array([serverPublicKey.byteLength]), serverPublicKey, ciphertext);
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

export async function sendWebPush(subscription: WebPushSubscription, options: SendWebPushOptions): Promise<{ ok: boolean; status: number; contentEncoding: string; payloadBytes: number; error?: string }> {
  const keys = await getOrCreateVapidKeys();
  const endpoint = subscription.endpoint;
  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const subject = process.env.WEB_PUSH_SUBJECT || "mailto:primordia@example.invalid";
  const token = await createVapidJwt(audience, subject, keys);
  const payload = await encryptWebPushPayload(subscription, options);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${normalizeBase64Url(keys.publicKey)}`,
      "Crypto-Key": `p256ecdsa=${normalizeBase64Url(keys.publicKey)}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "60",
      Urgency: "normal",
    },
    body: sliceArrayBuffer(payload),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => "");
    return { ok: false, status: res.status, contentEncoding: "aes128gcm", payloadBytes: payload.byteLength, error };
  }
  return { ok: true, status: res.status, contentEncoding: "aes128gcm", payloadBytes: payload.byteLength };
}
