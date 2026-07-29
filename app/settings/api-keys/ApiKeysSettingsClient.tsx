"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import CopyButton from "@/app/CopyButton";
import { withBasePath } from "@/lib/base-path";

const AES_KEY_STORAGE = "primordia_aes_key";
type ApiKeyClient = "cli" | "web";

interface ApiKeyRecord {
  shortId: string;
  version: string;
  client: ApiKeyClient;
  scopes: string;
  note: string | null;
  expiresAt: number;
  signature: string;
  createdAt: number;
  revokedAt: number | null;
}

const CLIENT_OPTIONS: { id: ApiKeyClient; title: string; description: string }[] = [
  { id: "cli", title: "Primordia CLI", description: "Use in a terminal with PRIMORDIA_CLI_KEY." },
  { id: "web", title: "Web client", description: "Use from a web client that resolves Primordia API keys." },
];

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function validStoredAesKey(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as JsonWebKey;
    return parsed.kty === "oct" && typeof parsed.k === "string" && parsed.k.length > 0;
  } catch {
    return false;
  }
}

function parseExpirationDays(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 366) return null;
  return parsed;
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(bytes).toBase64({ alphabet: "base64url", omitPadding: true });
}

async function createApiKeyPayload(client: ApiKeyClient, existingAesKeyJson: string, note: string, expiresAt: number) {
  const wrapperKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrapperJwk = await crypto.subtle.exportKey("jwk", wrapperKey);
  wrapperJwk.alg = wrapperJwk.alg ?? "A256GCM";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapperKey, new TextEncoder().encode(existingAesKeyJson));
  const encryptedAesKey = JSON.stringify({ iv: iv.toBase64(), ciphertext: new Uint8Array(ciphertext).toBase64() });
  const signature = await sha256Base64Url(JSON.stringify({ client, scopes: "", note, encryptedAesKey, expiresAt }));
  return { encryptedAesKey, signature, alg: wrapperJwk.alg, k: wrapperJwk.k };
}

function AddApiKey({ added, onAdd }: { added: ApiKeyClient[]; onAdd: (client: ApiKeyClient) => void }) {
  const [choosing, setChoosing] = useState(false);
  const available = CLIENT_OPTIONS.filter((option) => !added.includes(option.id));
  if (available.length === 0) return null;

  return (
    <div className="rounded-xl border border-dashed border-gray-700 hover:border-gray-500 transition-colors">
      {!choosing ? (
        <button type="button" onClick={() => setChoosing(true)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
          <Plus size={14} strokeWidth={2} /> Add an API key
        </button>
      ) : (
        <div className="space-y-1 p-2">
          {available.map((option) => (
            <button key={option.id} type="button" onClick={() => { onAdd(option.id); setChoosing(false); }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-800 transition-colors">
              <span className="block text-sm font-medium text-gray-200">{option.title}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{option.description}</span>
            </button>
          ))}
          <button type="button" onClick={() => setChoosing(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
        </div>
      )}
    </div>
  );
}

function CreateApiKeyCard({ client, aesKey, onCreated }: { client: ApiKeyClient; aesKey: string; onCreated: (key: ApiKeyRecord, secret: string) => void }) {
  const [note, setNote] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const daysError = parseExpirationDays(days) === null ? "Enter a whole number of days from 1 to 366." : null;
  const title = client === "cli" ? "Primordia CLI key" : "Web client key";

  async function createKey() {
    const parsedDays = parseExpirationDays(days);
    if (parsedDays === null) return;
    setBusy(true);
    setError(null);
    try {
      const expiresAt = Date.now() + parsedDays * 24 * 60 * 60 * 1000;
      const payload = await createApiKeyPayload(client, aesKey, note.trim(), expiresAt);
      const res = await fetch(withBasePath("/api/settings/api-keys"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, note: note.trim(), expiresAt, encryptedAesKey: payload.encryptedAesKey, signature: payload.signature }),
      });
      const data = (await res.json()) as { key?: ApiKeyRecord; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? "Failed to create API key");
      onCreated(data.key, `${data.key.version}.${data.key.shortId}.${payload.alg}.${payload.k}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
      <h2 className="text-sm font-medium text-gray-200">Create a {title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, e.g. laptop shell" className="rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
        <label className="flex flex-col gap-1 text-sm text-gray-300"><span className="flex items-center gap-2">Expires in <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" pattern="[0-9]*" aria-invalid={!!daysError} className={`w-20 rounded-lg border bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 ${daysError ? "border-red-700" : "border-gray-700"}`} /> days</span>{daysError && <span className="text-xs text-red-300">{daysError}</span>}</label>
        <button type="button" onClick={createKey} disabled={busy || !!daysError} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? "Creating…" : "Create key"}</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}

export default function ApiKeysSettingsClient() {
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState<ApiKeyClient[]>([]);
  const [created, setCreated] = useState<{ client: ApiKeyClient; secret: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validKey = validStoredAesKey(aesKey);
  const assignment = useMemo(() => created?.client === "cli" ? `PRIMORDIA_CLI_KEY=${shellSingleQuote(created.secret)}` : "", [created]);

  async function refreshKeys() {
    const res = await fetch(withBasePath("/api/settings/api-keys"));
    const data = (await res.json()) as { keys?: ApiKeyRecord[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to load API keys");
    setKeys(data.keys ?? []);
  }

  useEffect(() => {
    queueMicrotask(() => {
      setAesKey(localStorage.getItem(AES_KEY_STORAGE));
      refreshKeys().catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setLoaded(true));
    });
  }, []);

  async function revoke(shortId: string) {
    setBusy(shortId); setError(null);
    try {
      const res = await fetch(withBasePath("/api/settings/api-keys"), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortId }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to revoke API key");
      await refreshKeys();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  }

  async function extend(shortId: string) {
    setBusy(shortId); setError(null);
    try {
      // eslint-disable-next-line react-hooks/purity -- event handler computes a fresh extension timestamp on click.
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const res = await fetch(withBasePath("/api/settings/api-keys"), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortId, expiresAt }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to extend API key");
      await refreshKeys();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(null); }
  }

  return (
    <section className="space-y-6">
      <div><h1 className="text-2xl font-semibold text-gray-100">API keys</h1><p className="mt-1 text-sm leading-6 text-gray-400">Create revokable API keys for a Primordia CLI or web client. Each key wraps this device&apos;s encrypted billing credentials and can be revoked here.</p></div>
      {error && <div className="rounded-xl border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-100">{error}</div>}
      {!loaded ? <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">Loading API keys…</div> : !validKey ? <div className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100"><p>No browser AES key was found on this device.</p><p className="mt-2 text-amber-100/80">Connect or reconnect a billing source from Settings → Billing sources, then return here to create an API key.</p></div> : <div className="grid gap-2">
        {adding.map((client) => <CreateApiKeyCard key={client} client={client} aesKey={aesKey} onCreated={async (key, secret) => { setCreated({ client, secret }); setAdding((current) => current.filter((value) => value !== client)); setKeys((current) => [key, ...current]); }} />)}
        <AddApiKey added={adding} onAdd={(client) => setAdding((current) => [...current, client])} />
        <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4"><h2 className="text-sm font-medium text-gray-200">Existing API keys</h2>{keys.length === 0 ? <p className="mt-3 text-sm text-gray-500">No API keys yet.</p> : <div className="mt-3 divide-y divide-gray-800">{keys.map((key) => { const revoked = key.revokedAt !== null; return <div key={key.shortId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><span className="font-mono text-sm text-gray-100">{key.version}.{key.shortId}</span><span className="rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-300">{key.client}</span>{revoked && <span className="rounded-full border border-red-900/70 bg-red-950/40 px-2 py-0.5 text-[11px] font-medium text-red-200">Revoked</span>}</div><div className="mt-1 text-xs text-gray-500">{key.note || "No note"} · {revoked ? `revoked ${formatDate(key.revokedAt!)}` : `expires ${formatDate(key.expiresAt)}`} · created {formatDate(key.createdAt)}</div></div><div className="flex gap-2"><button type="button" onClick={() => extend(key.shortId)} disabled={busy === key.shortId || revoked} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-500 disabled:opacity-50">Extend 30d</button><button type="button" onClick={() => revoke(key.shortId)} disabled={busy === key.shortId || revoked} className="rounded-lg border border-red-800/70 px-3 py-1.5 text-xs text-red-200 hover:border-red-500 disabled:opacity-50">{revoked ? "Revoked" : "Revoke"}</button></div></div>; })}</div>}</div>
      </div>}
      {created && <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/20 p-4"><div className="mb-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100">You&apos;ll only see this API key once. Copy it now and save it in a secret manager.</div><div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-sm font-medium text-emerald-100">API key</h2><CopyButton text={created.secret} /></div><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-emerald-200"><code>{created.secret}</code></pre>{assignment && <><div className="mt-3 flex items-center justify-between gap-3"><h2 className="text-sm font-medium text-sky-100">Export command</h2><CopyButton text={`export ${assignment}`} /></div><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-sky-200"><code>{`export ${assignment}`}</code></pre></>}</div>}
    </section>
  );
}
