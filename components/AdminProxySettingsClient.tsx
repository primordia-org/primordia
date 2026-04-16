"use client";
// components/AdminProxySettingsClient.tsx
// Form for configuring proxy magic numbers (inactivity timeout, disk threshold).
// Settings are stored in git config and picked up live by the reverse proxy.

import { useState, useEffect } from "react";
import { withBasePath } from "@/lib/base-path";

interface ProxySettings {
  previewInactivityMin: number;
  diskCleanupThresholdPct: number;
}

export default function AdminProxySettingsClient() {
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state (strings for controlled inputs)
  const [inactivityMin, setInactivityMin] = useState("");
  const [thresholdPct, setThresholdPct] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch(withBasePath("/api/admin/proxy-settings"));
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ProxySettings;
        setSettings(data);
        setInactivityMin(String(data.previewInactivityMin));
        setThresholdPct(String(data.diskCleanupThresholdPct));
      } catch (e) {
        setFetchError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const body: Partial<ProxySettings> = {};
      const inMin = parseInt(inactivityMin, 10);
      const tPct = parseInt(thresholdPct, 10);
      if (!isNaN(inMin)) body.previewInactivityMin = inMin;
      if (!isNaN(tPct)) body.diskCleanupThresholdPct = tPct;

      const res = await fetch(withBasePath("/api/admin/proxy-settings"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const rb = await res.json().catch(() => ({}));
        throw new Error((rb as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as ProxySettings;
      setSettings(updated);
      setInactivityMin(String(updated.previewInactivityMin));
      setThresholdPct(String(updated.diskCleanupThresholdPct));
      setSaveMessage("Settings saved. The proxy will pick up changes within seconds.");
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400">Loading proxy settings…</p>;
  }

  if (fetchError) {
    return <p className="text-sm text-red-400">{fetchError}</p>;
  }

  if (!settings) return null;

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Preview server inactivity timeout</h2>
        <p className="text-sm text-gray-500 mb-3">
          A preview dev server is automatically stopped after this many minutes of inactivity (no
          incoming requests). Reducing this frees ports and memory sooner; increasing it keeps
          servers warm for longer sessions.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={1440}
            step={1}
            value={inactivityMin}
            onChange={(e) => setInactivityMin(e.target.value)}
            className="w-28 px-3 py-1.5 text-sm rounded bg-gray-900 border border-gray-700 text-gray-100 focus:outline-none focus:border-gray-500"
          />
          <span className="text-sm text-gray-400">minutes (1 – 1440)</span>
        </div>
      </section>

      <section>
        <h2 className="text-base font-medium text-gray-200 mb-1">Disk cleanup threshold</h2>
        <p className="text-sm text-gray-500 mb-3">
          When disk usage reaches this percentage, the proxy automatically deletes the oldest
          non-production worktrees until usage drops below the threshold. Disk usage is checked
          every 5 minutes.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
            className="w-28 px-3 py-1.5 text-sm rounded bg-gray-900 border border-gray-700 text-gray-100 focus:outline-none focus:border-gray-500"
          />
          <span className="text-sm text-gray-400">% (1 – 100)</span>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saveMessage && <p className="text-sm text-green-400">{saveMessage}</p>}
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      </div>
    </form>
  );
}
