import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { isWebPushCategory, sendWebPush, WEB_PUSH_CATEGORY_LABELS } from "@/lib/web-push";

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
    ? "High or critical dependency vulnerabilities were found. Open Dependency Security to review the audit and start a fix session."
    : category === "primordia-updates"
      ? "New upstream Primordia updates are available. Open Updates to review the changelog and create a merge session."
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
      : "/test-pages/web-push-test";

  const db = await getDb();
  const subscriptions = await db.getWebPushSubscriptionsByUser(user.id);
  if (subscriptions.length === 0) {
    return NextResponse.json({ error: "No subscriptions for this user" }, { status: 404 });
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const result = await sendWebPush(subscription, { title, body: message, url });
      if (!result.ok && (result.status === 404 || result.status === 410)) {
        await db.deleteWebPushSubscription(user.id, subscription.endpoint);
      }
      return { endpoint: subscription.endpoint, ...result };
    })
  );

  return NextResponse.json({ ok: results.some((result) => result.ok), results });
}
