"use client";

import { useMemo, useState } from "react";
import { Bell, BellRing, CheckCircle2, Loader2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

type SupportStatus = "checking" | "supported" | "unsupported";
type PermissionStateText = NotificationPermission | "unknown";

interface StoredSubscription {
  id: string;
  endpoint: string;
  createdAt: number;
  updatedAt: number;
}

interface BrowserPushDiagnostics {
  pageUrl: string;
  isSecureContext: boolean;
  userAgent: string;
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  notificationSupported: boolean;
  permission: PermissionStateText;
  controllerUrl: string | null;
  readyScope: string | null;
  readyActiveScriptUrl: string | null;
  readyActiveState: ServiceWorkerState | null;
  registrationCount: number;
  registrations: Array<{
    scope: string;
    activeScriptUrl: string | null;
    activeState: ServiceWorkerState | null;
    waitingScriptUrl: string | null;
    installingScriptUrl: string | null;
    pushEndpoint: string | null;
    pushExpirationTime: number | null;
  }>;
  expectedServiceWorkerUrl: string;
  expectedScope: string;
  browserSubscriptionEndpoint: string | null;
  browserSubscriptionMatchesServer: boolean | null;
}

interface SendResult {
  endpoint: string;
  ok: boolean;
  status: number;
  contentEncoding?: string;
  payloadBytes?: number;
  error?: string;
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
  const [diagnostics, setDiagnostics] = useState<BrowserPushDiagnostics | null>(null);
  const [lastSendResults, setLastSendResults] = useState<SendResult[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const canSubscribe = useMemo(
    () => isSignedIn && support === "supported" && permission !== "denied" && !busy,
    [busy, isSignedIn, permission, support]
  );

  async function refreshSubscriptions(): Promise<StoredSubscription[]> {
    if (!isSignedIn) return subscriptions;
    const res = await fetch(withBasePath("/api/web-push/subscriptions"));
    if (!res.ok) return subscriptions;
    const data = await res.json() as { subscriptions?: StoredSubscription[] };
    const nextSubscriptions = data.subscriptions ?? [];
    setSubscriptions(nextSubscriptions);
    return nextSubscriptions;
  }

  async function collectDiagnostics(serverSubscriptions: StoredSubscription[] = subscriptions): Promise<BrowserPushDiagnostics> {
    const expectedServiceWorkerUrl = new URL(withBasePath("/primordia-sw.js"), window.location.origin).toString();
    const expectedScope = new URL(withBasePath("/"), window.location.origin).toString();
    const baseDiagnostics = {
      pageUrl: window.location.href,
      isSecureContext: window.isSecureContext,
      userAgent: navigator.userAgent,
      serviceWorkerSupported: "serviceWorker" in navigator,
      pushManagerSupported: "PushManager" in window,
      notificationSupported: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : "unknown",
      controllerUrl: navigator.serviceWorker?.controller?.scriptURL ?? null,
      readyScope: null,
      readyActiveScriptUrl: null,
      readyActiveState: null,
      registrationCount: 0,
      registrations: [],
      expectedServiceWorkerUrl,
      expectedScope,
      browserSubscriptionEndpoint: null,
      browserSubscriptionMatchesServer: null,
    } satisfies BrowserPushDiagnostics;

    if (!("serviceWorker" in navigator)) return baseDiagnostics;

    const registrations = await navigator.serviceWorker.getRegistrations();
    const registrationDetails = await Promise.all(
      registrations.map(async (registration) => {
        const pushSubscription = await registration.pushManager.getSubscription().catch(() => null);
        return {
          scope: registration.scope,
          activeScriptUrl: registration.active?.scriptURL ?? null,
          activeState: registration.active?.state ?? null,
          waitingScriptUrl: registration.waiting?.scriptURL ?? null,
          installingScriptUrl: registration.installing?.scriptURL ?? null,
          pushEndpoint: pushSubscription?.endpoint ?? null,
          pushExpirationTime: pushSubscription?.expirationTime ?? null,
        };
      })
    );
    const matchingRegistration = registrations.find((registration) => registration.scope === expectedScope) ?? null;
    const matchingPushSubscription = await matchingRegistration?.pushManager.getSubscription().catch(() => null) ?? null;
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);

    return {
      ...baseDiagnostics,
      permission: "Notification" in window ? Notification.permission : "unknown",
      controllerUrl: navigator.serviceWorker.controller?.scriptURL ?? null,
      readyScope: readyRegistration?.scope ?? null,
      readyActiveScriptUrl: readyRegistration?.active?.scriptURL ?? null,
      readyActiveState: readyRegistration?.active?.state ?? null,
      registrationCount: registrations.length,
      registrations: registrationDetails,
      browserSubscriptionEndpoint: matchingPushSubscription?.endpoint ?? null,
      browserSubscriptionMatchesServer: matchingPushSubscription
        ? serverSubscriptions.some((subscription) => subscription.endpoint === matchingPushSubscription.endpoint)
        : null,
    };
  }

  async function refreshDiagnostics() {
    setBusy(true);
    setError("");
    setStatus("Refreshing Web Push diagnostics…");
    try {
      const nextSubscriptions = await refreshSubscriptions();
      setDiagnostics(await collectDiagnostics(nextSubscriptions));
      setPermission("Notification" in window ? Notification.permission : "unknown");
      setStatus("Diagnostics refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
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

      const nextSubscriptions = await refreshSubscriptions();
      setDiagnostics(await collectDiagnostics(nextSubscriptions));
      setStatus("Web Push subscription is ready. Diagnostics refreshed below.");
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
      const data = await res.json().catch(() => ({})) as { error?: string; results?: SendResult[] };
      if (!res.ok) throw new Error(data.error || "Could not send test push");
      const results = data.results ?? [];
      setLastSendResults(results);
      const delivered = results.filter((result) => result.ok).length;
      setStatus(`Push service accepted ${delivered} subscription${delivered === 1 ? "" : "s"}. If no notification appeared, inspect the browser diagnostics below.`);
      const nextSubscriptions = await refreshSubscriptions();
      setDiagnostics(await collectDiagnostics(nextSubscriptions));
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
      const nextSubscriptions = await refreshSubscriptions();
      setDiagnostics(await collectDiagnostics(nextSubscriptions));
      setStatus("Subscription removed. Diagnostics refreshed below.");
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
          <button
            type="button"
            onClick={refreshDiagnostics}
            disabled={busy || support !== "supported"}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh diagnostics
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Browser diagnostics</h2>
        {!diagnostics ? (
          <p className="mt-3 text-sm text-gray-500">
            Click <span className="text-gray-300">Refresh diagnostics</span> after enabling push or when a notification does not appear.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <dl className="grid gap-3 md:grid-cols-2">
              {[
                ["Page URL", diagnostics.pageUrl],
                ["Secure context", diagnostics.isSecureContext ? "yes" : "no — Push requires HTTPS or localhost"],
                ["Expected service worker", diagnostics.expectedServiceWorkerUrl],
                ["Expected scope", diagnostics.expectedScope],
                ["SW controller", diagnostics.controllerUrl ?? "none — reload may be needed after first registration"],
                ["Ready scope", diagnostics.readyScope ?? "not ready within 2.5s"],
                ["Ready active script", diagnostics.readyActiveScriptUrl ?? "none"],
                ["Ready active state", diagnostics.readyActiveState ?? "none"],
                ["Browser push endpoint", diagnostics.browserSubscriptionEndpoint ? shortEndpoint(diagnostics.browserSubscriptionEndpoint) : "none"],
                ["Browser/server endpoint match", diagnostics.browserSubscriptionMatchesServer == null ? "unknown" : diagnostics.browserSubscriptionMatchesServer ? "yes" : "no"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-800 bg-gray-950 px-4 py-3">
                  <dt className="text-xs text-gray-500">{label}</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-gray-200">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Service worker registrations ({diagnostics.registrationCount})</h3>
              {diagnostics.registrations.length === 0 ? (
                <p className="mt-2 text-sm text-red-300">No service worker registrations found.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {diagnostics.registrations.map((registration) => (
                    <li key={registration.scope} className="rounded-lg border border-gray-800 bg-gray-900 p-3">
                      <dl className="space-y-1 text-xs">
                        <div><dt className="inline text-gray-500">scope: </dt><dd className="inline break-all font-mono text-gray-200">{registration.scope}</dd></div>
                        <div><dt className="inline text-gray-500">active: </dt><dd className="inline break-all font-mono text-gray-200">{registration.activeScriptUrl ?? "none"} ({registration.activeState ?? "no state"})</dd></div>
                        <div><dt className="inline text-gray-500">waiting: </dt><dd className="inline break-all font-mono text-gray-200">{registration.waitingScriptUrl ?? "none"}</dd></div>
                        <div><dt className="inline text-gray-500">installing: </dt><dd className="inline break-all font-mono text-gray-200">{registration.installingScriptUrl ?? "none"}</dd></div>
                        <div><dt className="inline text-gray-500">push endpoint: </dt><dd className="inline break-all font-mono text-gray-200">{registration.pushEndpoint ? shortEndpoint(registration.pushEndpoint) : "none"}</dd></div>
                        <div><dt className="inline text-gray-500">expiration: </dt><dd className="inline font-mono text-gray-200">{registration.pushExpirationTime ? new Date(registration.pushExpirationTime).toLocaleString() : "none"}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Last send results</h3>
              {lastSendResults.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No send attempt recorded in this page session.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {lastSendResults.map((result) => (
                    <li key={result.endpoint} className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs">
                      <p className="font-mono text-gray-200">{shortEndpoint(result.endpoint)}</p>
                      <p className={result.ok ? "mt-1 text-green-300" : "mt-1 text-red-300"}>
                        {result.ok ? "accepted" : "failed"} · HTTP {result.status}
                        {result.contentEncoding ? ` · ${result.contentEncoding}` : ""}
                        {result.payloadBytes ? ` · ${result.payloadBytes} bytes` : ""}
                        {result.error ? ` · ${result.error.slice(0, 180)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500">Raw diagnostics JSON</summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs text-gray-300">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </details>
          </div>
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
