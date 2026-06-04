// lib/web-push.ts
// Web Push infrastructure backed by the well-established `web-push` npm package.

import * as webpush from "web-push";
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

function decodeBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function convertPkcs8PrivateKeyToVapidD(privateKey: string): Promise<string | null> {
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      decodeBase64Url(privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"]
    );
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return typeof jwk.d === "string" ? jwk.d : null;
  } catch {
    return null;
  }
}

function generateVapidKeys(): WebPushVapidKeys {
  const keys = webpush.generateVAPIDKeys();
  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    createdAt: Date.now(),
  };
}

async function normalizeVapidKeys(keys: WebPushVapidKeys): Promise<WebPushVapidKeys> {
  // The first local implementation stored PKCS#8 private keys. The `web-push`
  // package correctly expects the raw P-256 private scalar (`d`). Convert in
  // place so existing browser subscriptions that used the same public key keep
  // working instead of forcing users to resubscribe.
  if (keys.privateKey.length > 80) {
    const convertedPrivateKey = await convertPkcs8PrivateKeyToVapidD(keys.privateKey);
    if (convertedPrivateKey) return { ...keys, privateKey: convertedPrivateKey };
  }
  return keys;
}

export async function getOrCreateVapidKeys(): Promise<WebPushVapidKeys> {
  const db = await getDb();
  const existing = await db.getWebPushVapidKeys();
  if (existing) {
    const normalized = await normalizeVapidKeys(existing);
    if (normalized.privateKey !== existing.privateKey) {
      await db.setWebPushVapidKeys(normalized);
    }
    return normalized;
  }
  const keys = generateVapidKeys();
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

export async function sendWebPush(subscription: WebPushSubscription, options: SendWebPushOptions): Promise<{ ok: boolean; status: number; contentEncoding: string; payloadBytes: number; error?: string }> {
  const keys = await getOrCreateVapidKeys();
  const payload = JSON.stringify({
    title: options.title,
    body: options.body,
    url: options.url,
    tag: "primordia-web-push-test",
  });

  try {
    const result = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      payload,
      {
        vapidDetails: {
          subject: process.env.WEB_PUSH_SUBJECT || "mailto:primordia@example.invalid",
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
        },
        TTL: 60,
        urgency: "normal",
        contentEncoding: "aes128gcm",
      }
    );

    return {
      ok: true,
      status: result.statusCode,
      contentEncoding: "aes128gcm via web-push",
      payloadBytes: Buffer.byteLength(payload),
    };
  } catch (err) {
    const webPushError = err as Partial<webpush.WebPushError> & { message?: string };
    return {
      ok: false,
      status: webPushError.statusCode ?? 0,
      contentEncoding: "aes128gcm via web-push",
      payloadBytes: Buffer.byteLength(payload),
      error: webPushError.body || webPushError.message || String(err),
    };
  }
}
