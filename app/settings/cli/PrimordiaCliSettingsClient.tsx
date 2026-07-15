"use client";

import { useEffect, useMemo, useState } from "react";
import CopyButton from "@/app/CopyButton";
import { withBasePath } from "@/lib/base-path";

const AES_KEY_STORAGE = "primordia_aes_key";

interface CliKeyRecord {
  shortId: string;
  version: string;
  client: "cli" | "web";
  scopes: string;
  note: string | null;
  expiresAt: number;
  signature: string;
  createdAt: number;
}

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

async function createCliKeyPayload(existingAesKeyJson: string, note: string, expiresAt: number) {
  const wrapperKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const wrapperJwk = await crypto.subtle.exportKey("jwk", wrapperKey);
  wrapperJwk.alg = wrapperJwk.alg ?? "A256GCM";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrapperKey,
    new TextEncoder().encode(existingAesKeyJson),
  );
  const encryptedAesKey = JSON.stringify({
    iv: iv.toBase64(),
    ciphertext: new Uint8Array(ciphertext).toBase64(),
  });
  const signature = await sha256Base64Url(JSON.stringify({ client: "cli", scopes: "", note, encryptedAesKey, expiresAt }));
  return {
    encryptedAesKey,
    signature,
    alg: wrapperJwk.alg,
    k: wrapperJwk.k,
  };
}

export default function PrimordiaCliSettingsClient() {
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<CliKeyRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("30");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validKey = validStoredAesKey(aesKey);
  const parsedDays = parseExpirationDays(days);
  const daysError = parsedDays === null ? "Enter a whole number of days from 1 to 366." : null;
  const assignment = useMemo(() => (createdSecret ? `PRIMORDIA_CLI_KEY=${shellSingleQuote(createdSecret)}` : ""), [createdSecret]);
  const exportCommand = useMemo(() => (assignment ? `export ${assignment}` : ""), [assignment]);

  async function refreshKeys() {
    const res = await fetch(withBasePath("/api/settings/cli-keys"));
    const data = (await res.json()) as { keys?: CliKeyRecord[]; error?: string };
    if (!res.ok) throw new Error(data.error ?? "Failed to load CLI keys");
    setKeys(data.keys ?? []);
  }

  useEffect(() => {
    queueMicrotask(() => {
      setAesKey(localStorage.getItem(AES_KEY_STORAGE));
      refreshKeys()
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoaded(true));
    });
  }, []);

  async function createKey() {
    if (!validStoredAesKey(aesKey)) return;
    setBusy("create");
    setError(null);
    setCreatedSecret(null);
    try {
      if (parsedDays === null) throw new Error("Enter a whole number of expiration days from 1 to 366.");
      const expiresAt = Date.now() + parsedDays * 24 * 60 * 60 * 1000;
      const payload = await createCliKeyPayload(aesKey, note.trim(), expiresAt);
      const res = await fetch(withBasePath("/api/settings/cli-keys"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim(), expiresAt, encryptedAesKey: payload.encryptedAesKey, signature: payload.signature }),
      });
      const data = (await res.json()) as { key?: CliKeyRecord; error?: string };
      if (!res.ok || !data.key) throw new Error(data.error ?? "Failed to create CLI key");
      setCreatedSecret(`${data.key.version}.${data.key.shortId}.${payload.alg}.${payload.k}`);
      setNote("");
      await refreshKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(shortId: string) {
    setBusy(shortId);
    setError(null);
    try {
      const res = await fetch(withBasePath("/api/settings/cli-keys"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to revoke CLI key");
      await refreshKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function extend(shortId: string) {
    setBusy(shortId);
    setError(null);
    try {
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const res = await fetch(withBasePath("/api/settings/cli-keys"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId, expiresAt }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Failed to extend CLI key");
      await refreshKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 shadow-xl shadow-black/20">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-gray-500">Primordia CLI</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Revokable CLI keys</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Create revokable keys for secret-backed terminal commands like <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">bun run primordia create</code>, <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">followup</code>, and <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">accept</code>. The CLI reads <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">PRIMORDIA_CLI_KEY</code>; revoke a key here to make it unusable.
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-100">{error}</div>}

      {!loaded ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">Loading CLI keys…</div>
      ) : !validKey ? (
        <div className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100">
          <p>No browser AES key was found on this device.</p>
          <p className="mt-2 text-amber-100/80">Connect or reconnect a billing source from Settings → Billing sources, then return here to create a CLI key.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <h2 className="text-sm font-medium text-gray-200">Create a CLI key</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note, e.g. laptop shell" className="rounded-lg border border-gray-700 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
              <label className="flex flex-col gap-1 text-sm text-gray-300">
                <span className="flex items-center gap-2">
                  Expires in
                  <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" pattern="[0-9]*" aria-invalid={!!daysError} aria-describedby={daysError ? "cli-key-days-error" : undefined} className={`w-20 rounded-lg border bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 ${daysError ? "border-red-700" : "border-gray-700"}`} />
                  days
                </span>
                {daysError && <span id="cli-key-days-error" className="text-xs text-red-300">{daysError}</span>}
              </label>
              <button type="button" onClick={createKey} disabled={busy === "create" || !!daysError} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                {busy === "create" ? "Creating…" : "Create key"}
              </button>
            </div>
          </div>

          {createdSecret && (
            <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/20 p-4">
              <div className="mb-3 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-100">
                You&apos;ll only see this CLI key once. Copy it now and save it in your shell profile or secret manager.
              </div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-emerald-100">Environment assignment</h2>
                <CopyButton text={assignment} />
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-emerald-200"><code>{assignment}</code></pre>
              <div className="mt-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-sky-100">Export command</h2>
                <CopyButton text={exportCommand} />
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-sky-200"><code>{exportCommand}</code></pre>
            </div>
          )}

          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <h2 className="text-sm font-medium text-gray-200">Existing CLI keys</h2>
            {keys.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No CLI keys yet.</p>
            ) : (
              <div className="mt-3 divide-y divide-gray-800">
                {keys.map((key) => (
                  <div key={key.shortId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-mono text-sm text-gray-100">{key.version}.{key.shortId}</div>
                      <div className="mt-1 text-xs text-gray-500">{key.note || "No note"} · expires {formatDate(key.expiresAt)} · created {formatDate(key.createdAt)}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => extend(key.shortId)} disabled={busy === key.shortId} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-500 disabled:opacity-50">Extend 30d</button>
                      <button type="button" onClick={() => revoke(key.shortId)} disabled={busy === key.shortId} className="rounded-lg border border-red-800/70 px-3 py-1.5 text-xs text-red-200 hover:border-red-500 disabled:opacity-50">Revoke</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
