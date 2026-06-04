import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db/index";
import WebPushTestClient from "./WebPushTestClient";

export default async function WebPushTestPage() {
  const user = await getSessionUser();
  const db = user ? await getDb() : null;
  const initialSubscriptions = user && db
    ? (await db.getWebPushSubscriptionsByUser(user.id)).map((subscription) => ({
        id: subscription.id,
        endpoint: subscription.endpoint,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      }))
    : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-100">🔔 Web Push Test</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Browser subscription, SQLite persistence, VAPID send path, and service worker notification handling.
            </p>
          </div>
          <Link href="/test-pages" className="text-xs text-violet-300 hover:text-violet-200">
            ← Test pages
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <WebPushTestClient isSignedIn={Boolean(user)} initialSubscriptions={initialSubscriptions} />
      </main>
    </div>
  );
}
