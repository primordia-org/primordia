"use client";

import { useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";

type CoreRoute = {
  path: string;
  httpMethod: "POST";
  commandPath: string[];
  description: string;
  streaming: boolean;
  multipart: boolean;
};

type SchemaResponse = {
  protocol?: string;
  style?: string;
  auth?: string;
  basePath?: string;
  routes?: CoreRoute[];
  error?: string;
};

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function bearerHeaders(apiKey: string): HeadersInit {
  return { authorization: `Bearer ${apiKey}` };
}

function exampleBody(route: CoreRoute | undefined): string {
  if (!route) return "{}";
  if (route.path === "/thread" || route.path.endsWith("/followup")) return JSON.stringify({ request: "Describe the change here", options: {} }, null, 2);
  if (route.path.includes("schedule/[job]/set")) return JSON.stringify({ args: ["5m"], options: {} }, null, 2);
  return JSON.stringify({ args: [], options: {} }, null, 2);
}

function fillExampleParams(path: string, threadId: string): string {
  return path.replaceAll("[threadId]", encodeURIComponent(threadId || "core-api-cli-definitions")).replaceAll("[job]", "dependency-audit");
}

export default function CoreApiTestClient() {
  const [apiKey, setApiKey] = useState("");
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [routePath, setRoutePath] = useState("/status");
  const [threadId, setThreadId] = useState("core-api-cli-definitions");
  const [bodyText, setBodyText] = useState(JSON.stringify({ args: [], options: {} }, null, 2));
  const [useMultipart, setUseMultipart] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const routes = useMemo(() => schema?.routes ?? [], [schema]);
  const selectedRoute = routes.find((route) => route.path === routePath);
  const routeNeedsThreadId = routePath.includes("[threadId]");
  const concretePath = fillExampleParams(routePath, threadId);

  async function fetchSchema() {
    setBusy(true);
    setOutput([]);
    try {
      const res = await fetch(withBasePath("/api/core"), { headers: bearerHeaders(apiKey) });
      const data = (await res.json()) as SchemaResponse;
      setSchema(data);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOutput([`Loaded ${data.routes?.length ?? 0} ${data.style} Core API routes from ${data.protocol}.`]);
    } catch (error) {
      setOutput([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  function requestBody(): BodyInit | undefined {
    if (!bodyText.trim()) return undefined;
    const parsed = JSON.parse(bodyText) as { args?: string[]; options?: Record<string, string | boolean>; request?: string };
    if (!useMultipart) return JSON.stringify(parsed);
    const form = new FormData();
    if (parsed.request) form.set("request", parsed.request);
    if (parsed.args) form.set("args", JSON.stringify(parsed.args));
    for (const [key, value] of Object.entries(parsed.options ?? {})) form.set(key, String(value));
    return form;
  }

  async function runAction() {
    setBusy(true);
    setOutput([]);
    try {
      const headers = bearerHeaders(apiKey);
      if (!useMultipart) (headers as Record<string, string>)["content-type"] = "application/json";
      const res = await fetch(withBasePath(`/api/core${ensureLeadingSlash(concretePath)}`), {
        method: "POST",
        headers,
        body: requestBody(),
      });

      if (selectedRoute?.streaming) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body to stream.");
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          setOutput((current) => [...current, decoder.decode(value, { stream: true })]);
        }
      } else {
        const text = await res.text();
        try {
          setOutput([JSON.stringify(JSON.parse(text), null, 2)]);
        } catch {
          setOutput([text]);
        }
      }
    } catch (error) {
      setOutput([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  function selectRoute(nextPath: string) {
    setRoutePath(nextPath);
    const route = routes.find((entry) => entry.path === nextPath);
    setUseMultipart(route?.multipart ?? false);
    setBodyText(exampleBody(route));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Connection</h2>
          <p className="mt-1 text-sm text-gray-400">
            This page calls the in-app Core route-action API at <code className="rounded bg-gray-950 px-1">/api/core</code>. Paste a revokable <code className="rounded bg-gray-950 px-1">web</code> API key from Settings → API Keys.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-300">Web API key</span>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="v1.short.alg.secret" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
        </label>
        <button type="button" onClick={fetchSchema} disabled={busy || !apiKey} className="rounded-lg border border-violet-700 bg-violet-950/50 px-4 py-2 text-sm text-violet-100 hover:border-violet-400 disabled:opacity-50">
          Load API routes
        </button>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Run a route action</h2>
          <p className="mt-1 text-sm text-gray-400">Commands are exposed as POST endpoints. JSON responses are pretty-printed here; streaming commands, such as logs, stream plain text by default.</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-300">Route</span>
          <select value={routePath} onChange={(event) => selectRoute(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100">
            <option value="/status">/status</option>
            {routes.map((route) => <option key={route.path} value={route.path}>{route.httpMethod} {route.path}{route.streaming ? " (streams)" : ""}{route.multipart ? " (multipart)" : ""}</option>)}
          </select>
        </label>
        {routeNeedsThreadId && (
          <label className="block text-sm">
            <span className="text-gray-300">Thread ID</span>
            <input value={threadId} onChange={(event) => setThreadId(event.target.value)} placeholder="core-api-cli-definitions" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
          </label>
        )}
        <div className="rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-400">
          Concrete test URL: <code className="text-gray-200">{withBasePath(`/api/core${ensureLeadingSlash(concretePath)}`)}</code>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={useMultipart} onChange={(event) => setUseMultipart(event.target.checked)} />
          Send as multipart/form-data
        </label>
        <label className="block text-sm">
          <span className="text-gray-300">Body JSON</span>
          <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={7} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
        </label>
        <button type="button" onClick={runAction} disabled={busy || !apiKey} className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-100 hover:border-emerald-400 disabled:opacity-50">
          POST action
        </button>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-950 p-5">
        <h2 className="text-base font-semibold text-white">Output</h2>
        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs text-gray-200">{output.join("") || "No output yet."}</pre>
      </section>
    </div>
  );
}
