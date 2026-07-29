"use client";

import { useMemo, useState } from "react";

type CoreMethod = {
  method: string;
  commandPath: string[];
  description: string;
  streaming: boolean;
};

type SchemaResponse = {
  protocol?: string;
  transports?: string[];
  auth?: string;
  methods?: CoreMethod[];
  error?: string;
};

type RunResponse = {
  ok?: boolean;
  id?: string;
  method?: string;
  argv?: string[];
  eventUrl?: string;
  error?: string;
};

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

function bearerHeaders(apiKey: string): HeadersInit {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

export default function CoreApiTestClient() {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:7042");
  const [apiKey, setApiKey] = useState("");
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [method, setMethod] = useState("status");
  const [argsText, setArgsText] = useState("{}");
  const [output, setOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const methods = useMemo(() => schema?.methods ?? [], [schema]);

  async function fetchSchema() {
    setBusy(true);
    setOutput([]);
    try {
      const res = await fetch(joinUrl(baseUrl, "/schema"), { headers: bearerHeaders(apiKey) });
      const data = (await res.json()) as SchemaResponse;
      setSchema(data);
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOutput([`Loaded ${data.methods?.length ?? 0} Core methods from ${data.protocol}.`]);
    } catch (error) {
      setOutput([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  function requestBody() {
    const parsed = JSON.parse(argsText) as { args?: string[]; options?: Record<string, unknown>; cwd?: string };
    return { method, params: parsed };
  }

  async function runBuffered() {
    setBusy(true);
    setOutput([]);
    try {
      const res = await fetch(joinUrl(baseUrl, "/rpc"), {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify(requestBody()),
      });
      const text = await res.text();
      setOutput([text]);
    } catch (error) {
      setOutput([error instanceof Error ? error.message : String(error)]);
    } finally {
      setBusy(false);
    }
  }

  async function runStreaming() {
    setBusy(true);
    setOutput([]);
    setActiveRunId(null);
    try {
      const res = await fetch(joinUrl(baseUrl, "/runs"), {
        method: "POST",
        headers: bearerHeaders(apiKey),
        body: JSON.stringify(requestBody()),
      });
      const data = (await res.json()) as RunResponse;
      if (!res.ok || !data.id || !data.eventUrl) throw new Error(data.error ?? `HTTP ${res.status}`);
      setActiveRunId(data.id);
      setOutput([`Started ${data.id}: ${(data.argv ?? []).join(" ")}`]);
      const source = new EventSource(joinUrl(baseUrl, data.eventUrl));
      const append = (line: string) => setOutput((current) => [...current, line]);
      source.addEventListener("start", (event) => append(`start ${event.data}`));
      source.addEventListener("stdout", (event) => append(`stdout ${JSON.parse(event.data).data}`));
      source.addEventListener("stderr", (event) => append(`stderr ${JSON.parse(event.data).data}`));
      source.addEventListener("error", (event) => {
        append(`error ${"data" in event ? event.data : "SSE connection error"}`);
      });
      source.addEventListener("exit", (event) => {
        append(`exit ${event.data}`);
        source.close();
        setBusy(false);
      });
    } catch (error) {
      setOutput([error instanceof Error ? error.message : String(error)]);
      setBusy(false);
    }
  }

  async function abortRun() {
    if (!activeRunId) return;
    await fetch(joinUrl(baseUrl, `/runs/${activeRunId}/abort`), {
      method: "POST",
      headers: bearerHeaders(apiKey),
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Connection</h2>
          <p className="mt-1 text-sm text-gray-400">
            Start the Core server with <code className="rounded bg-gray-950 px-1">bun run primordia core serve</code>, then paste a <code className="rounded bg-gray-950 px-1">web</code> API key from Settings → API Keys.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-300">Core base URL</span>
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
        </label>
        <label className="block text-sm">
          <span className="text-gray-300">Web API key</span>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="v1.short.alg.secret" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
        </label>
        <button type="button" onClick={fetchSchema} disabled={busy || !apiKey} className="rounded-lg border border-violet-700 bg-violet-950/50 px-4 py-2 text-sm text-violet-100 hover:border-violet-400 disabled:opacity-50">
          Load schema
        </button>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Run a method</h2>
          <p className="mt-1 text-sm text-gray-400">Buffered uses POST /rpc. Streaming uses POST /runs, then GET the SSE event stream.</p>
        </div>
        <label className="block text-sm">
          <span className="text-gray-300">Method</span>
          <select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100">
            <option value="status">status</option>
            {methods.map((entry) => <option key={entry.method} value={entry.method}>{entry.method}{entry.streaming ? " (streaming)" : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-300">Params JSON</span>
          <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={runBuffered} disabled={busy || !apiKey} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-100 hover:border-gray-400 disabled:opacity-50">POST /rpc</button>
          <button type="button" onClick={runStreaming} disabled={busy || !apiKey} className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-100 hover:border-emerald-400 disabled:opacity-50">POST + SSE</button>
          <button type="button" onClick={abortRun} disabled={!activeRunId} className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-100 hover:border-red-500 disabled:opacity-50">Abort active run</button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-950 p-5">
        <h2 className="text-base font-semibold text-white">Output</h2>
        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-xs text-gray-200">{output.join("\n") || "No output yet."}</pre>
      </section>
    </div>
  );
}
