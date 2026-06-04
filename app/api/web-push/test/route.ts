import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { sendWebPush } from "@/lib/web-push";

/**
 * Send a no-payload test push to the current user's stored subscriptions.
 * @description Requires an authenticated session and at least one saved Web Push subscription.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" && body.title.trim()
    ? body.title.trim()
    : "Primordia test notification";
  const message = typeof body?.body === "string" && body.body.trim()
    ? body.body.trim()
    : "Web Push infrastructure is connected.";

  const db = await getDb();
  const subscriptions = await db.getWebPushSubscriptionsByUser(user.id);
  if (subscriptions.length === 0) {
    return NextResponse.json({ error: "No subscriptions for this user" }, { status: 404 });
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      const result = await sendWebPush(subscription, { title, body: message, url: "/test-pages/web-push-test" });
      if (!result.ok && (result.status === 404 || result.status === 410)) {
        await db.deleteWebPushSubscription(user.id, subscription.endpoint);
      }
      return { endpoint: subscription.endpoint, ...result };
    })
  );

  return NextResponse.json({ ok: results.some((result) => result.ok), results });
}
