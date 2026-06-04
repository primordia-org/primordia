"use client";

import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { WebPushCategory } from "@/lib/db/types";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray as Uint8Array<ArrayBuffer>;
}

async function ensureBrowserPushSubscription(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("This browser does not support Web Push notifications.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const keyRes = await fetch(withBasePath("/api/web-push/public-key"));
  if (!keyRes.ok) throw new Error("Could not load VAPID public key.");
  const { publicKey } = await keyRes.json() as { publicKey: string };

  const registration = await navigator.serviceWorker.register(withBasePath("/primordia-sw.js"), {
    scope: withBasePath("/"),
  });
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const saveRes = await fetch(withBasePath("/api/web-push/subscriptions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!saveRes.ok) {
    const data = await saveRes.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || "Could not save push subscription.");
  }
}

export default function WebPushCategoryButton({
  category,
  initialSubscribed,
  className = "",
}: {
  category: WebPushCategory;
  initialSubscribed: boolean;
  className?: string;
}) {
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        const res = await fetch(withBasePath("/api/web-push/categories"), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category }),
        });
        if (!res.ok) throw new Error("Could not unsubscribe from push notifications.");
        setSubscribed(false);
      } else {
        await ensureBrowserPushSubscription();
        const res = await fetch(withBasePath("/api/web-push/categories"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category }),
        });
        if (!res.ok) throw new Error("Could not subscribe to push notifications.");
        setSubscribed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          subscribed
            ? "border border-gray-700 bg-gray-800 text-gray-100 hover:bg-gray-700"
            : "bg-violet-600 text-white hover:bg-violet-500"
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {subscribed ? "Unsubscribe from Push Notifications" : "Subscribe to Push Notifications"}
      </button>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
