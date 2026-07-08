import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hasEvolvePermission } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import { isWebPushCategory, WEB_PUSH_CATEGORIES } from "@/lib/web-push";

async function requireEvolver() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await hasEvolvePermission(user.id))) {
    return { error: NextResponse.json({ error: "Push notification categories require evolve access" }, { status: 403 }) };
  }
  return { user };
}

/**
 * List the current user's Web Push category subscriptions.
 * @description Requires evolve access.
 */
export async function GET() {
  const auth = await requireEvolver();
  if (auth.error) return auth.error;

  const db = await getDb();
  const rows = await db.getWebPushCategorySubscriptions(auth.user.id);
  return NextResponse.json({
    categories: WEB_PUSH_CATEGORIES.map((category) => ({
      category,
      subscribed: rows.some((row) => row.category === category),
    })),
  });
}

/**
 * Subscribe the current user to a Web Push category.
 * @description Body: { category } where category is security-vulnerabilities, primordia-updates, or server-health-alerts.
 */
export async function POST(req: NextRequest) {
  const auth = await requireEvolver();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null) as { category?: unknown } | null;
  if (!isWebPushCategory(body?.category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const db = await getDb();
  await db.subscribeWebPushCategory(auth.user.id, body.category);
  return NextResponse.json({ ok: true });
}

/**
 * Unsubscribe the current user from a Web Push category.
 * @description Body: { category } where category is security-vulnerabilities, primordia-updates, or server-health-alerts.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireEvolver();
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null) as { category?: unknown } | null;
  if (!isWebPushCategory(body?.category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const db = await getDb();
  await db.unsubscribeWebPushCategory(auth.user.id, body.category);
  return NextResponse.json({ ok: true });
}
