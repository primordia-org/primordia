"use client";

import { useMemo, useState } from "react";
import { Bell, BellRing, CheckCircle2, Loader2, Trash2, XCircle } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

type SupportStatus = "checking" | "supported" | "unsupported";
type PermissionStateText = NotificationPermission | "unknown";

interface StoredSubscription {
  id: string;
  endpoint: string;
  createdAt: number;
  updatedAt: number;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray as Uint8Array<ArrayBuffer>;
}

function shortEndpoint(endpoint: string): string {
  if (endpoint.length <= 56) return endpoint;
  return `${endpoint.slice(0, 32)}…${endpoint.slice(-18)}`;
}

export default function WebPushTestClient({
  isSignedIn,
  initialSubscriptions,
}: {
  isSignedIn: boolean;
  initialSubscriptions: StoredSubscription[];
}) {
  const [support] = useState<SupportStatus>(() => {
    if (typeof window === "undefined") return "checking";
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
      ? "supported"
      : "unsupported";
  });
  const [permission, setPermission] = useState<PermissionStateText>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unknown";
    return Notification.permission;
  });
  const [subscriptions, setSubscriptions] = useState<StoredSubscription[]>(initialSubscriptions);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const canSubscribe = useMemo(
    () => isSignedIn && support === "supported" && permission !== "denied" && !busy,
    [busy, isSignedIn, permission, support]
  );

  async function refreshSubscriptions() {
    if (!isSignedIn) return;
    const res = await fetch(withBasePath("/api/web-push/subscriptions"));
    if (!res.ok) return;
    const data = await res.json() as { subscriptions?: StoredSubscription[] };
    setSubscriptions(data.subscriptions ?? []);
  }

  async function subscribe() {
    setBusy(true);
    setError("");
    setStatus("Registering service worker…");
    try {
      const requestedPermission = await Notification.requestPermission();
      setPermission(requestedPermission);
      if (requestedPermission !== "granted") {
        setStatus("Notification permission was not granted.");
        return;
      }

      const keyRes = await fetch(withBasePath("/api/web-push/public-key"));
      if (!keyRes.ok) throw new Error("Could not load VAPID public key");
      const { publicKey } = await keyRes.json() as { publicKey: string };

      const registration = await navigator.serviceWorker.register(withBasePath("/primordia-sw.js"), {
        scope: withBasePath("/"),
      });
      await navigator.serviceWorker.ready;

      setStatus("Creating browser push subscription…");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setStatus("Saving subscription on the server…");
      const saveRes = await fetch(withBasePath("/api/web-push/subscriptions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Could not save subscription");
      }

      await refreshSubscriptions();
      setStatus("Web Push subscription is ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError("");
    setStatus("Sending test push…");
    try {
      const res = await fetch(withBasePath("/api/web-push/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Primordia test notification",
          body: "Web Push infrastructure is connected.",
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; results?: Array<{ ok: boolean; status: number }> };
      if (!res.ok) throw new Error(data.error || "Could not send test push");
      const delivered = data.results?.filter((result) => result.ok).length ?? 0;
      setStatus(`Sent test push to ${delivered} subscription${delivered === 1 ? "" : "s"}.`);
      await refreshSubscriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe(endpoint: string) {
    setBusy(true);
    setError("");
    setStatus("Removing subscription…");
    try {
      const registration = await navigator.serviceWorker.getRegistration(withBasePath("/"));
      const current = await registration?.pushManager.getSubscription();
      if (current?.endpoint === endpoint) await current.unsubscribe();

      const res = await fetch(withBasePath("/api/web-push/subscriptions"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!res.ok) throw new Error("Could not remove subscription");
      await refreshSubscriptions();
      setStatus("Subscription removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-violet-500/10 p-3 text-violet-300">
            <BellRing className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">Web Push test bench</h2>
            <p className="mt-1 text-sm leading-6 text-gray-400">
              Registers a browser PushSubscription, stores it in SQLite, and asks the server to send a VAPID-authenticated test push.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
            <dt className="text-xs text-gray-500">Browser support</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-100">{support}</dd>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
            <dt className="text-xs text-gray-500">Permission</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-100">{permission}</dd>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
            <dt className="text-xs text-gray-500">Saved subscriptions</dt>
            <dd className="mt-1 text-sm font-semibold text-gray-100">{subscriptions.length}</dd>
          </div>
        </dl>

        {!isSignedIn && (
          <p className="mt-4 rounded-xl border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            Sign in first. Web Push subscriptions are stored per user.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={subscribe}
            disabled={!canSubscribe}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Enable push
          </button>
          <button
            type="button"
            onClick={sendTest}
            disabled={!isSignedIn || subscriptions.length === 0 || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            Send test notification
          </button>
        </div>

        {status && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-green-700/50 bg-green-950/40 px-4 py-3 text-sm text-green-200">
            <CheckCircle2 className="h-4 w-4" /> {status}
          </p>
        )}
        {error && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            <XCircle className="h-4 w-4" /> {error}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Stored subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No subscriptions saved yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {subscriptions.map((subscription) => (
              <li key={subscription.endpoint} className="rounded-xl border border-gray-800 bg-gray-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs text-gray-300">{shortEndpoint(subscription.endpoint)}</p>
                    <p className="mt-2 text-xs text-gray-600">Updated {new Date(subscription.updatedAt).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => unsubscribe(subscription.endpoint)}
                    disabled={busy}
                    className="rounded-lg border border-gray-700 p-2 text-gray-400 hover:border-red-600 hover:text-red-300 disabled:opacity-50"
                    aria-label="Remove subscription"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
