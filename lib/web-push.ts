// lib/web-push.ts
// Web Push infrastructure backed by the well-established `web-push` npm package.

import * as webpush from "web-push";
import { getDb } from "./db/index";
import type { WebPushCategory, WebPushSubscription, WebPushVapidKeys } from "./db/types";

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
  /** Stable notification tag. Notifications with the same tag supersede each other. */
  tag?: string;
}

export const WEB_PUSH_CATEGORIES = ["security-vulnerabilities", "primordia-updates", "server-health-alerts"] as const satisfies readonly WebPushCategory[];

export const WEB_PUSH_CATEGORY_LABELS: Record<WebPushCategory, string> = {
  "security-vulnerabilities": "Security Vulnerabilities",
  "primordia-updates": "Primordia Updates",
  "server-health-alerts": "Server Health Alerts",
};

export const WEB_PUSH_CATEGORY_TAGS: Record<WebPushCategory, string> = {
  "security-vulnerabilities": "primordia-security-vulnerabilities",
  "primordia-updates": "primordia-updates",
  "server-health-alerts": "primordia-server-health-alerts",
};

export function isWebPushCategory(value: unknown): value is WebPushCategory {
  return typeof value === "string" && (WEB_PUSH_CATEGORIES as readonly string[]).includes(value);
}

function generateVapidKeys(): WebPushVapidKeys {
  const keys = webpush.generateVAPIDKeys();
  return {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    createdAt: Date.now(),
  };
}

export async function getOrCreateVapidKeys(): Promise<WebPushVapidKeys> {
  const db = await getDb();
  const existing = await db.getWebPushVapidKeys();
  if (existing) return existing;
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
    tag: options.tag ?? "primordia-web-push-test",
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

export async function sendWebPushToCategory(
  category: WebPushCategory,
  options: SendWebPushOptions
): Promise<{ attempted: number; delivered: number }> {
  const db = await getDb();
  const userIds = await db.getUserIdsSubscribedToWebPushCategory(category);
  let attempted = 0;
  let delivered = 0;

  for (const userId of userIds) {
    const subscriptions = await db.getWebPushSubscriptionsByUser(userId);
    for (const subscription of subscriptions) {
      attempted += 1;
      const result = await sendWebPush(subscription, {
        ...options,
        tag: options.tag ?? WEB_PUSH_CATEGORY_TAGS[category],
      });
      if (result.ok) delivered += 1;
      if (!result.ok && (result.status === 404 || result.status === 410)) {
        await db.deleteWebPushSubscription(userId, subscription.endpoint);
      }
    }
  }

  return { attempted, delivered };
}
