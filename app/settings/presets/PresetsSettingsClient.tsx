"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { PRESET_AUTH_SOURCE_LABELS, type EvolvePreset, type PresetAuthSource } from "@/lib/presets";
import { firstModelForAuthSource, getHarnessesForAuthSource, filterModelsForAuthSource } from "@/lib/preset-options";
import type { ModelOption } from "@/lib/agent-config";
import { ModelPicker } from "@/components/ModelPicker";
import { trackEvent } from "@/lib/events-client";

const AUTH_SOURCES = Object.keys(PRESET_AUTH_SOURCE_LABELS) as PresetAuthSource[];

function emptyPreset(): EvolvePreset {
  return {
    id: `custom:${crypto.randomUUID()}`,
    name: "New preset",
    authSource: "exe-dev-gateway",
    harness: "pi",
    model: "claude-sonnet-4-6",
  };
}

export default function PresetsSettingsClient() {
  const [builtIn, setBuiltIn] = useState<EvolvePreset[]>([]);
  const [custom, setCustom] = useState<EvolvePreset[]>([]);
  const [modelOptionsByHarness, setModelOptionsByHarness] = useState<Record<string, ModelOption[]>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(withBasePath('/api/settings/presets'))
      .then((r) => r.json())
      .then((data: { builtInPresets?: EvolvePreset[]; customPresets?: EvolvePreset[] }) => {
        setBuiltIn(data.builtInPresets ?? []);
        setCustom(data.customPresets ?? []);
      })
      .catch(() => setMessage('Could not load presets.'));
    fetch(withBasePath('/api/evolve/models'))
      .then((r) => r.json())
      .then((data: Record<string, ModelOption[]>) => setModelOptionsByHarness(data))
      .catch(() => { /* keep text fallback */ });
  }, []);

  function updatePreset(id: string, patch: Partial<EvolvePreset>) {
    setCustom((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  }

  function changeAuthSource(preset: EvolvePreset, authSource: PresetAuthSource) {
    const harnesses = getHarnessesForAuthSource(authSource);
    const harness = harnesses.some((h) => h.id === preset.harness) ? preset.harness : (harnesses[0]?.id ?? 'pi');
    const models = filterModelsForAuthSource(modelOptionsByHarness[harness] ?? [], authSource, harness);
    const model = models.some((m) => m.id === preset.model) ? preset.model : (models[0]?.id ?? preset.model);
    updatePreset(preset.id, { authSource, harness, model });
  }

  function changeHarness(preset: EvolvePreset, harness: string) {
    const model = firstModelForAuthSource(modelOptionsByHarness, preset.authSource, harness) || preset.model;
    updatePreset(preset.id, { harness, model });
  }

  function normalizedPresets(): EvolvePreset[] {
    return custom.map((p) => {
      const harnesses = getHarnessesForAuthSource(p.authSource);
      const harness = harnesses.some((h) => h.id === p.harness) ? p.harness : (harnesses[0]?.id ?? p.harness);
      const models = filterModelsForAuthSource(modelOptionsByHarness[harness] ?? [], p.authSource, harness);
      const model = models.some((m) => m.id === p.model) ? p.model : (models[0]?.id ?? p.model);
      return { ...p, harness, model };
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const cleaned = normalizedPresets();
      const res = await fetch(withBasePath('/api/settings/presets'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPresets: cleaned }),
      });
      const data = await res.json() as { customPresets?: EvolvePreset[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Save failed: ${res.status}`);
      setCustom(data.customPresets ?? cleaned);
      setMessage('Saved.');
      trackEvent('settings/presets-saved/v1', { count: cleaned.length });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Presets</h1>
        <p className="text-sm text-gray-400 mt-1">Pick billing source + harness + model once, then switch by name in Evolve.</p>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <h2 className="text-sm font-semibold text-gray-200 mb-3">Built-in presets</h2>
        <div className="grid gap-2">
          {builtIn.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2">
              <div className="text-sm text-gray-100">{p.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{PRESET_AUTH_SOURCE_LABELS[p.authSource]} · {p.harness} · {p.model}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-200">Custom presets</h2>
          <button type="button" onClick={() => setCustom((prev) => [...prev, emptyPreset()])} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800">
            <Plus size={14} /> Add preset
          </button>
        </div>

        {custom.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-800 rounded-lg p-4">No custom presets yet.</p>
        ) : custom.map((p) => {
          const harnesses = getHarnessesForAuthSource(p.authSource);
          const selectedHarness = harnesses.some((h) => h.id === p.harness) ? p.harness : (harnesses[0]?.id ?? p.harness);
          const selectableModels = filterModelsForAuthSource(modelOptionsByHarness[selectedHarness] ?? [], p.authSource, selectedHarness);
          const selectedModel = selectableModels.some((m) => m.id === p.model) ? p.model : (selectableModels[0]?.id ?? p.model);
          return (
          <div key={p.id} className="rounded-lg border border-gray-800 bg-gray-950/40 p-3 space-y-3">
            <label className="flex flex-col gap-1 text-xs text-gray-400">
              Display name
              <input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-amber-500" />
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                1. Billing source
                <select value={p.authSource} onChange={(e) => changeAuthSource(p, e.target.value as PresetAuthSource)} className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-amber-500">
                  {AUTH_SOURCES.map((source) => <option key={source} value={source}>{PRESET_AUTH_SOURCE_LABELS[source]}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-400">
                2. Harness
                <select value={selectedHarness} onChange={(e) => changeHarness(p, e.target.value)} className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-amber-500">
                  {harnesses.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                </select>
              </label>
              <div className="flex flex-col gap-1 text-xs text-gray-400">
                3. Model
                <ModelPicker
                  modelOptionsByHarness={modelOptionsByHarness}
                  authSource={p.authSource}
                  selectedHarness={selectedHarness}
                  selectedModel={selectedModel}
                  onChange={(model) => updatePreset(p.id, { harness: selectedHarness, model })}
                  disabled={selectableModels.length === 0}
                  compact
                />
              </div>
            </div>

            {selectableModels.length === 0 && (
              <p className="text-xs text-amber-300">No models match this billing source + harness yet.</p>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={() => setCustom((prev) => prev.filter((x) => x.id !== p.id))} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-red-300 hover:bg-red-950/30">
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>
          );
        })}

        <div className="flex items-center gap-3 pt-2">
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save presets'}</button>
          {message && <span className="text-sm text-gray-400">{message}</span>}
        </div>
      </div>
    </section>
  );
}
