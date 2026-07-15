"use client";

import { useEffect, useMemo, useState } from "react";
import CopyButton from "@/app/CopyButton";

const AES_KEY_STORAGE = "primordia_aes_key";

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isPrimordiaAesKey(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as JsonWebKey;
    return parsed.kty === "oct" && typeof parsed.k === "string" && parsed.k.length > 0;
  } catch {
    return false;
  }
}

export default function PrimordiaCliSettingsClient() {
  const [aesKey, setAesKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setAesKey(localStorage.getItem(AES_KEY_STORAGE));
      setLoaded(true);
    });
  }, []);

  const assignment = useMemo(() => (aesKey ? `PRIMORDIA_AES_KEY=${shellSingleQuote(aesKey)}` : ""), [aesKey]);
  const exportCommand = useMemo(() => (assignment ? `export ${assignment}` : ""), [assignment]);
  const validKey = aesKey ? isPrimordiaAesKey(aesKey) : false;

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 shadow-xl shadow-black/20">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.25em] text-gray-500">Primordia CLI</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Use this browser&apos;s secret key in the terminal</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Secret-backed CLI commands need the same browser-held AES key that encrypts your billing sources. Copy this shell-safe environment assignment before running <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">bun run primordia create</code>, <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">bun run primordia followup</code>, or <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-200">bun run primordia accept</code> with a secret-backed thread.
        </p>
      </div>

      {!loaded ? (
        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4 text-sm text-gray-400">Loading local key…</div>
      ) : aesKey ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-gray-200">Environment assignment</h2>
              <CopyButton text={assignment} />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-emerald-200"><code>{assignment}</code></pre>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-gray-200">Export command</h2>
              <CopyButton text={exportCommand} />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-xs leading-5 text-sky-200"><code>{exportCommand}</code></pre>
          </div>

          <div className={`rounded-xl border p-4 text-sm leading-6 ${validKey ? "border-emerald-900/70 bg-emerald-950/20 text-emerald-100" : "border-amber-900/70 bg-amber-950/20 text-amber-100"}`}>
            {validKey ? (
              <p>
                This is the JSON Web Key string from <code className="rounded bg-black/30 px-1.5 py-0.5">localStorage.primordia_aes_key</code>, quoted for your shell. The CLI passes it to workers as <code className="rounded bg-black/30 px-1.5 py-0.5">PRIMORDIA_AES_KEY</code> so stored billing sources can be decrypted locally.
              </p>
            ) : (
              <p>
                A value exists in local storage, but it does not look like a Primordia AES JSON Web Key. If CLI secret-backed presets fail, reconnect a billing source from Settings → Billing sources on this device.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-900/70 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100">
          <p>No browser AES key was found on this device.</p>
          <p className="mt-2 text-amber-100/80">
            Connect or reconnect a billing source from Settings → Billing sources, then return here to copy the <code className="rounded bg-black/30 px-1.5 py-0.5">PRIMORDIA_AES_KEY</code> value.
          </p>
        </div>
      )}
    </section>
  );
}
