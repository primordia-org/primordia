import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { parsePushSubscription, saveWebPushSubscription } from "@/lib/web-push";

/**
 * List the current user's stored Web Push subscriptions.
 * @description Requires an authenticated session.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = await getDb();
  const subscriptions = await db.getWebPushSubscriptionsByUser(user.id);
  return NextResponse.json({
    subscriptions: subscriptions.map((subscription) => ({
      id: subscription.id,
      endpoint: subscription.endpoint,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    })),
  });
}

/**
 * Store or refresh a Web Push subscription for the current user.
 * @description Accepts a browser PushSubscription JSON object and persists it for future notifications.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = parsePushSubscription(body?.subscription ?? body);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  const subscription = await saveWebPushSubscription(user.id, parsed);
  return NextResponse.json({ ok: true, subscriptionId: subscription.id });
}

/**
 * Delete a Web Push subscription for the current user.
 * @description Accepts { endpoint } and removes the matching stored subscription.
 */
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.endpoint !== "string") {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const db = await getDb();
  await db.deleteWebPushSubscription(user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
