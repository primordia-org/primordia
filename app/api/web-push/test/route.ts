import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { isWebPushCategory, sendWebPush, WEB_PUSH_CATEGORY_LABELS, WEB_PUSH_CATEGORY_TAGS } from "@/lib/web-push";

/**
 * Send a no-payload test push to the current user's stored subscriptions.
 * @description Requires an authenticated session and at least one saved Web Push subscription.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { category?: unknown; title?: unknown; body?: unknown };
  const category = isWebPushCategory(body.category) ? body.category : null;
  const defaultTitle = category ? WEB_PUSH_CATEGORY_LABELS[category] : "Primordia test notification";
  const defaultBody = category === "security-vulnerabilities"
    ? "1 critical, 2 high dependency issues found. Affected: next, protobufjs, ws. Open Dependency Security to review the audit and start a fix thread."
    : category === "primordia-updates"
      ? "5 upstream commits available from Primordia Official. Changelog: Improve thread logs; Fix install health checks +1 more. Open Updates to review and create a merge thread."
      : category === "server-health-alerts"
        ? "Primordia captured diagnostics for possible CPU or memory leakage. Open Server Health to start an investigation thread."
        : "Web Push infrastructure is connected.";
  const title = typeof body?.title === "string" && body.title.trim()
    ? body.title.trim()
    : defaultTitle;
  const message = typeof body?.body === "string" && body.body.trim()
    ? body.body.trim()
    : defaultBody;
  const url = category === "security-vulnerabilities"
    ? "/admin/dependencies-security"
    : category === "primordia-updates"
      ? "/admin/updates"
      : category === "server-health-alerts"
        ? "/admin/server-health"
        : "/test-pages/web-push-test";
  const tag = category ? WEB_PUSH_CATEGORY_TAGS[category] : `primordia-web-push-test-${Date.now()}`;

  const db = await getDb();
  const subscriptions = await db.getWebPushSubscriptionsByUser(user.id);
  if (subscriptions.length === 0) {
    return NextResponse.json({ error: "No subscriptions for this user" }, { status: 404 });
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const result = await sendWebPush(subscription, { title, body: message, url, tag });
      if (!result.ok && (result.status === 404 || result.status === 410)) {
        await db.deleteWebPushSubscription(user.id, subscription.endpoint);
      }
      return { endpoint: subscription.endpoint, tag, ...result };
    })
  );

  return NextResponse.json({ ok: results.some((result) => result.ok), results });
}
