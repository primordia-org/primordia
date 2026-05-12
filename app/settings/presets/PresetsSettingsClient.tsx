"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, Edit3, Loader, Plus, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { PRESET_AUTH_SOURCE_LABELS, type EvolvePreset, type PresetAuthSource } from "@/lib/presets";
import type { EvolvePresetWithAvailability } from "@/lib/preset-availability";
import { firstModelForAuthSource, getHarnessesForAuthSource, filterModelsForAuthSource } from "@/lib/preset-options";
import type { ModelOption } from "@/lib/agent-config";
import { ModelPicker } from "@/components/ModelPicker";
import { AgentIdentityLine, AuthSourceIcon, HarnessIcon } from "@/components/AgentIdentity";
import { trackEvent } from "@/lib/events-client";

const AUTH_SOURCES = Object.keys(PRESET_AUTH_SOURCE_LABELS) as PresetAuthSource[];

function markAvailable(preset: EvolvePreset): EvolvePresetWithAvailability {
  return { ...preset, available: true };
}

function emptyPreset(): EvolvePreset {
  return {
    id: `custom:${crypto.randomUUID()}`,
    name: "New preset",
    authSource: "exe-dev-gateway",
    harness: "pi",
    model: "claude-sonnet-4-6",
  };
}

interface NiceSelectOption {
  value: string;
  label: string;
  icon: ReactNode;
}

function NiceSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: NiceSelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-gray-100 outline-none transition-colors hover:border-gray-600 focus:border-blue-500"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-300">{selected?.icon}</span>
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Select"}</span>
        <ChevronDown size={14} className={`shrink-0 text-gray-500 transition-transform${open ? " rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-gray-700 bg-gray-950 p-1 shadow-2xl" role="listbox">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(option.value); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${active ? "bg-blue-600/20 text-blue-100" : "text-gray-200 hover:bg-gray-800"}`}
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{option.icon}</span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active && <Check size={14} className="shrink-0 text-blue-300" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PresetCard({
  preset,
  disabled = false,
  showDisabledPill = disabled,
  right,
  modelLabel,
}: {
  preset: EvolvePresetWithAvailability | EvolvePreset;
  disabled?: boolean;
  showDisabledPill?: boolean;
  right?: ReactNode;
  modelLabel?: string;
}) {
  const unavailable = 'available' in preset && !preset.available;
  return (
    <div
      className={`border rounded-xl overflow-hidden transition-colors ${
        disabled || unavailable ? "border-gray-700/50 opacity-60" : "border-gray-700"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3 bg-gray-800/50">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100">{preset.name}</span>
            {!preset.builtIn && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">custom</span>
            )}
            {unavailable && preset.unavailableReason && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-400 border border-amber-900/50">{preset.unavailableReason}</span>
            )}
            {showDisabledPill && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-500">disabled</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 truncate">
            <AgentIdentityLine authSource={preset.authSource} harness={preset.harness} model={modelLabel ?? preset.model} iconSize={12} />
          </p>
        </div>
        {right && <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">{right}</div>}
      </div>
    </div>
  );
}

export default function PresetsSettingsClient() {
  const [builtIn, setBuiltIn] = useState<EvolvePresetWithAvailability[]>([]);
  const [disabledBuiltInIds, setDisabledBuiltInIds] = useState<string[]>([]);
  const [custom, setCustom] = useState<EvolvePresetWithAvailability[]>([]);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [modelOptionsByHarness, setModelOptionsByHarness] = useState<Record<string, ModelOption[]>>({});
  const [savingTarget, setSavingTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(withBasePath('/api/settings/presets'))
      .then((r) => r.json())
      .then((data: { builtInPresets?: EvolvePresetWithAvailability[]; customPresets?: EvolvePresetWithAvailability[]; disabledBuiltInPresetIds?: string[] }) => {
        setBuiltIn(data.builtInPresets ?? []);
        setCustom(data.customPresets ?? []);
        setDisabledBuiltInIds(data.disabledBuiltInPresetIds ?? []);
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

  function editPreset(id: string, editing: boolean) {
    setEditingIds((prev) => {
      const next = new Set(prev);
      if (editing) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleBuiltIn(id: string) {
    const nextDisabled = disabledBuiltInIds.includes(id)
      ? disabledBuiltInIds.filter((x) => x !== id)
      : [...disabledBuiltInIds, id];
    setDisabledBuiltInIds(nextDisabled);
    void persistPresets(custom, nextDisabled, `builtin:${id}`);
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

  function modelLabelFor(harness: string, model: string): string {
    return modelOptionsByHarness[harness]?.find((m) => m.id === model)?.label ?? model;
  }

  function normalizedPresets(source = custom): EvolvePreset[] {
    return source.map((p) => {
      const harnesses = getHarnessesForAuthSource(p.authSource);
      const harness = harnesses.some((h) => h.id === p.harness) ? p.harness : (harnesses[0]?.id ?? p.harness);
      const models = filterModelsForAuthSource(modelOptionsByHarness[harness] ?? [], p.authSource, harness);
      const model = models.some((m) => m.id === p.model) ? p.model : (models[0]?.id ?? p.model);
      return { ...p, harness, model };
    });
  }

  async function persistPresets(nextCustom = custom, nextDisabled = disabledBuiltInIds, target = 'presets') {
    setSavingTarget(target);
    setMessage(null);
    try {
      const cleaned = normalizedPresets(nextCustom);
      const res = await fetch(withBasePath('/api/settings/presets'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPresets: cleaned, disabledBuiltInPresetIds: nextDisabled }),
      });
      const data = await res.json() as { customPresets?: EvolvePresetWithAvailability[]; disabledBuiltInPresetIds?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Save failed: ${res.status}`);
      setCustom(data.customPresets ?? cleaned.map(markAvailable));
      setDisabledBuiltInIds(data.disabledBuiltInPresetIds ?? nextDisabled);
      setEditingIds((prev) => {
        const next = new Set(prev);
        if (target.startsWith('custom:')) next.delete(target);
        return next;
      });
      setMessage('Saved.');
      trackEvent('settings/presets-saved/v1', { count: cleaned.length, disabledBuiltInCount: nextDisabled.length, target });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSavingTarget(null);
    }
  }

  function deletePreset(id: string) {
    const nextCustom = custom.filter((p) => p.id !== id);
    setCustom(nextCustom);
    void persistPresets(nextCustom, disabledBuiltInIds, `delete:${id}`);
  }

  function addPreset() {
    const preset = emptyPreset();
    setCustom((prev) => [...prev, markAvailable(preset)]);
    editPreset(preset.id, true);
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Presets</h1>
        <p className="text-sm text-gray-400 mt-1">Pick billing source + harness + model once, then switch by name in Evolve.</p>
      </div>

      <div className="space-y-3">
        <div className="grid gap-2">
          {builtIn.map((p) => {
            const disabled = disabledBuiltInIds.includes(p.id);
            return (
              <PresetCard
                key={p.id}
                preset={p}
                disabled={disabled}
                showDisabledPill={disabled}
                modelLabel={modelLabelFor(p.harness, p.model)}
                right={
                  <button
                    type="button"
                    title={disabled ? "Enable preset" : "Disable preset"}
                    onClick={() => toggleBuiltIn(p.id)}
                    disabled={savingTarget === `builtin:${p.id}`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    {disabled ? (
                      <ToggleLeft size={16} strokeWidth={2} />
                    ) : (
                      <ToggleRight size={16} strokeWidth={2} className="text-blue-400" />
                    )}
                  </button>
                }
              />
            );
          })}

          {custom.map((p) => {
            const isEditing = editingIds.has(p.id);
            const harnesses = getHarnessesForAuthSource(p.authSource);
            const selectedHarness = harnesses.some((h) => h.id === p.harness) ? p.harness : (harnesses[0]?.id ?? p.harness);
            const authSourceOptions: NiceSelectOption[] = AUTH_SOURCES.map((source) => ({
              value: source,
              label: PRESET_AUTH_SOURCE_LABELS[source],
              icon: <AuthSourceIcon source={source} size={16} />,
            }));
            const harnessOptions: NiceSelectOption[] = harnesses.map((h) => ({
              value: h.id,
              label: h.label,
              icon: <HarnessIcon harness={h.id} size={16} />,
            }));
            const selectableModels = filterModelsForAuthSource(modelOptionsByHarness[selectedHarness] ?? [], p.authSource, selectedHarness);
            const selectedModel = selectableModels.some((m) => m.id === p.model) ? p.model : (selectableModels[0]?.id ?? p.model);

            if (!isEditing) {
              return (
                <PresetCard
                  key={p.id}
                  preset={{ ...p, harness: selectedHarness, model: selectedModel }}
                  modelLabel={modelLabelFor(selectedHarness, selectedModel)}
                  right={
                    <>
                      <button type="button" title="Edit preset" onClick={() => editPreset(p.id, true)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                        <Edit3 size={14} strokeWidth={2} />
                      </button>
                      <button type="button" title="Delete preset" onClick={() => deletePreset(p.id)} disabled={savingTarget === `delete:${p.id}`} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 disabled:opacity-40 transition-colors">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </>
                  }
                />
              );
            }

            return (
              <div key={p.id} className="border border-blue-700/40 rounded-xl p-4 space-y-3 bg-gray-800/30">
                <p className="text-sm font-medium text-gray-200">Edit custom preset</p>
                <label className="flex flex-col gap-1 text-xs text-gray-400">
                  Display name
                  <input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} className="rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500 transition-colors" />
                </label>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="flex flex-col gap-1 text-xs text-gray-400">
                    <span>1. Billing source</span>
                    <NiceSelect value={p.authSource} options={authSourceOptions} onChange={(value) => changeAuthSource(p, value as PresetAuthSource)} />
                  </div>
                  <div className="flex flex-col gap-1 text-xs text-gray-400">
                    <span>2. Harness</span>
                    <NiceSelect value={selectedHarness} options={harnessOptions} onChange={(value) => changeHarness(p, value)} />
                  </div>
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
                <div className="flex gap-2">
                  <button type="button" onClick={() => persistPresets(custom, disabledBuiltInIds, p.id)} disabled={savingTarget === p.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                    {savingTarget === p.id ? <Loader size={13} strokeWidth={2} className="animate-spin" /> : null}
                    Save preset
                  </button>
                  <button type="button" onClick={() => editPreset(p.id, false)} className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors">
                    Cancel
                  </button>
                  <button type="button" title="Delete preset" onClick={() => deletePreset(p.id)} disabled={savingTarget === `delete:${p.id}`} className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-gray-700 disabled:opacity-40 transition-colors">
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addPreset}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-dashed border-gray-700 hover:border-gray-500 transition-colors w-full"
          >
            <Plus size={14} strokeWidth={2} />
            Add custom preset
          </button>
        </div>

        {message && <div className="pt-2 text-sm text-gray-400">{message}</div>}
      </div>
    </section>
  );
}
