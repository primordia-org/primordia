"use client";

// components/ModelPicker.tsx
// A rich model picker that replaces the plain <select> for model selection.
//
// Layout:
//  • Trigger button: provider icon + model name + chevron
//  • Dialog (centered on all screen sizes):
//      - Search bar at top
//      - Left column: provider tabs (icon + name)
//      - Right column: scrollable model list with name + description

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, Check, X } from "lucide-react";
import { ClaudeIcon } from "@/components/brand-icons/ClaudeIcon";
import type { ModelOption } from "../lib/agent-config";
import { withBasePath } from "../lib/base-path";
import { filterModelsForAuthSource } from "../lib/preset-options";
import type { PresetAuthSource } from "../lib/presets";

// ─── Provider detection ────────────────────────────────────────────────────────

/** A logical provider group for display purposes. */
interface ProviderGroup {
  id: string;
  label: string;
  /** Short label for narrow tabs */
  shortLabel: string;
  models: ModelOption[];
}

// Well-known provider slug → display info
const PROVIDER_META: Record<string, { label: string; shortLabel: string }> = {
  free:            { label: "Free",            shortLabel: "Free" },
  misc:            { label: "Misc",            shortLabel: "Misc" },
  anthropic:       { label: "Anthropic",       shortLabel: "Anthropic" },
  openai:          { label: "OpenAI",          shortLabel: "OpenAI" },
  "openai-native": { label: "OpenAI",          shortLabel: "OpenAI" },
  "openai-codex":  { label: "ChatGPT",         shortLabel: "ChatGPT" },
  google:          { label: "Google",          shortLabel: "Google" },
  "x-ai":          { label: "xAI",             shortLabel: "xAI" },
  mistralai:       { label: "Mistral AI",      shortLabel: "Mistral" },
  "meta-llama":    { label: "Meta",            shortLabel: "Meta" },
  qwen:            { label: "Qwen",            shortLabel: "Qwen" },
  deepseek:        { label: "DeepSeek",        shortLabel: "DeepSeek" },
  nvidia:          { label: "NVIDIA",          shortLabel: "NVIDIA" },
  amazon:          { label: "Amazon",          shortLabel: "Amazon" },
  cohere:          { label: "Cohere",          shortLabel: "Cohere" },
  "bytedance-seed":{ label: "ByteDance",       shortLabel: "ByteDance" },
  moonshotai:      { label: "Moonshot",        shortLabel: "Moonshot" },
  "z-ai":          { label: "Z.ai",            shortLabel: "Z.ai" },
  "arcee-ai":      { label: "Arcee",           shortLabel: "Arcee" },
  baidu:           { label: "Baidu",           shortLabel: "Baidu" },
  allenai:         { label: "AllenAI",         shortLabel: "AllenAI" },
  ai21:            { label: "AI21",            shortLabel: "AI21" },
  alibaba:         { label: "Alibaba",         shortLabel: "Alibaba" },
  inception:       { label: "Inception",       shortLabel: "Inception" },
};

/** Maps provider id → public path for a favicon asset (base-path-prefixed at use time). */
const PROVIDER_FAVICON: Record<string, string> = {
  "openai-native":  "/brand-icons/chatgpt-favicon.svg",
  "openai-codex":   "/brand-icons/chatgpt-favicon.svg",
  openai:           "/brand-icons/chatgpt-favicon.svg",
  google:           "/brand-icons/google-gemini-icon.png",
  deepseek:         "/brand-icons/deepseek-icon.png",
  mistralai:        "/brand-icons/mistralai-icon.png",
  "meta-llama":     "/brand-icons/meta-llama-icon.png",
  qwen:             "/brand-icons/qwen-icon.png",
  nvidia:           "/brand-icons/nvidia-icon.png",
  moonshotai:       "/brand-icons/moonshotai-icon.png",
  "bytedance-seed": "/brand-icons/bytedance-seed-icon.png",
  inception:        "/brand-icons/inception-icon.png",
  kwaipilot:        "/brand-icons/kwaipilot-icon.png",
  "z-ai":           "/brand-icons/z-ai-icon.png",
  "x-ai":           "/brand-icons/x-ai-icon.png",
  baidu:            "/brand-icons/baidu-icon.png",
};

/** Provider icon: inline SVG for Anthropic and favicon assets for others. */
function ProviderIcon({
  providerId,
  size = 24,
}: {
  providerId: string;
  size?: number;
}) {
  const style = { width: size, height: size };

  // ── Anthropic (inline SVG) ──────────────────────────────────────────────
  if (providerId === "anthropic") {
    return (
      <span
        className="flex items-center justify-center rounded-lg bg-[#cc785c]/15 flex-shrink-0"
        style={style}
        aria-hidden="true"
      >
        <ClaudeIcon size={size * 0.6} />
      </span>
    );
  }

  // ── Misc badge
  if (providerId === "misc") {
    return (
      <span
        className="flex items-center justify-center rounded-lg bg-gray-700/40 text-gray-400 font-bold flex-shrink-0"
        style={{ ...style, fontSize: size * 0.3 }}
        aria-hidden="true"
      >
        MISC
      </span>
    );
  }

  // ── Free tier badge
  if (providerId === "free") {
    return (
      <span
        className="flex items-center justify-center rounded-lg bg-emerald-900/40 text-emerald-400 font-bold flex-shrink-0"
        style={{ ...style, fontSize: size * 0.32 }}
        aria-hidden="true"
      >
        FREE
      </span>
    );
  }

  // ── Favicon assets for providers that have one ─────────────────────────────
  const faviconSrc = PROVIDER_FAVICON[providerId];
  if (faviconSrc) {
    return (
      <span
        className="flex items-center justify-center rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden"
        style={style}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBasePath(faviconSrc)} alt="" width={size * 0.72} height={size * 0.72} className="object-contain" />
      </span>
    );
  }

  // ── Generic fallback: initials ──────────────────────────────────────────
  const initials = providerId.slice(0, 2).toUpperCase();
  return (
    <span
      className="flex items-center justify-center rounded-lg bg-gray-700/60 text-gray-300 font-bold flex-shrink-0"
      style={{ ...style, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

// ─── Provider grouping ─────────────────────────────────────────────────────────

/** Determine the provider slug for a model. */
function getModelProvider(model: ModelOption): string {
  // Free models (:free suffix) get their own virtual group
  if (model.id.endsWith(":free")) return "free";
  // ChatGPT subscription models are namespaced as "openai-codex:model".
  if (model.id.startsWith("openai-codex:")) return "openai-codex";
  // OpenRouter models have a slash in the id: "provider/model-name"
  if (model.id.includes("/")) {
    return model.id.split("/")[0];
  }
  // Native Anthropic models
  if (model.id.startsWith("claude-")) return "anthropic";
  // Native OpenAI models
  if (
    model.id.startsWith("gpt-") ||
    model.id.startsWith("codex-") ||
    model.id.startsWith("o1") ||
    model.id.startsWith("o3") ||
    model.id.startsWith("o4")
  ) {
    return "openai-native";
  }
  return "other";
}

function buildProviderGroups(models: ModelOption[]): ProviderGroup[] {
  const byProvider: Record<string, ModelOption[]> = {};
  for (const m of models) {
    const prov = getModelProvider(m);
    byProvider[prov] = [...(byProvider[prov] ?? []), m];
  }

  // Providers that are exempt from singleton-merging (always get their own tab)
  const NEVER_MISC = new Set(["free", "anthropic", "openai-native", "openai-codex", "openai"]);

  // Collect singleton paid providers into a virtual "misc" group
  const miscModels: ModelOption[] = [];
  const singletonProviders = new Set<string>();
  for (const [id, ms] of Object.entries(byProvider)) {
    if (!NEVER_MISC.has(id) && ms.length === 1) {
      miscModels.push(...ms);
      singletonProviders.add(id);
    }
  }

  // Sort providers: free first, anthropic second, ChatGPT/OpenAI next, named
  // multi-model providers alphabetically, then misc last
  const priority: Record<string, number> = { free: 0, anthropic: 1, "openai-codex": 2, "openai-native": 3, misc: 999 };
  const providerIds = Object.keys(byProvider)
    .filter((id) => !singletonProviders.has(id))
    .sort((a, b) => {
      const pa = priority[a] ?? 99;
      const pb = priority[b] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });

  const groups: ProviderGroup[] = providerIds.map((id) => {
    const meta = PROVIDER_META[id];
    return {
      id,
      label: meta?.label ?? id,
      shortLabel: meta?.shortLabel ?? id,
      models: byProvider[id],
    };
  });

  // Append the Misc group at the end (sorted by label within the group)
  if (miscModels.length > 0) {
    miscModels.sort((a, b) => a.label.localeCompare(b.label));
    groups.push({ id: "misc", label: "Misc", shortLabel: "Misc", models: miscModels });
  }

  return groups;
}

// ─── DropdownContent ─────────────────────────────────────────────────────────
// Shared inner content for both desktop dropdown and mobile bottom sheet.

interface DropdownContentProps {
  search: string;
  setSearch: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  handleSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  providerGroups: ProviderGroup[];
  effectiveProvider: string | null;
  setActiveProvider: (id: string) => void;
  filteredModels: ModelOption[];
  selectedModel: string;
  authSource?: PresetAuthSource;
  handleSelect: (id: string) => void;
  onClose: () => void;
}

function displayModelDescription(model: ModelOption, authSource?: PresetAuthSource): string {
  if (authSource !== "chatgpt-subscription" || !model.id.startsWith("openai-codex:")) {
    return model.description;
  }
  const withoutPricing = model.description
    .split(" · ")
    .filter((part) => !/[$¢]\d|\d+¢/.test(part))
    .join(" · ");
  return withoutPricing ? `${withoutPricing} · Subscription` : "ChatGPT subscription";
}

function ModelRow({
  model,
  authSource,
  isSelected,
  showRowIcon,
  onSelect,
}: {
  model: ModelOption;
  authSource?: PresetAuthSource;
  isSelected: boolean;
  showRowIcon: boolean;
  onSelect: (id: string) => void;
}) {
  const provId = getModelProvider(model);
  // For free/misc virtual groups, show the actual provider icon per row
  const rowIconProvId = (provId === "free" || provId === "misc") && model.id.includes("/")
    ? model.id.split("/")[0]
    : provId;
  const description = displayModelDescription(model, authSource);
  return (
    <button
      type="button"
      data-selected={isSelected ? "true" : undefined}
      onClick={() => onSelect(model.id)}
      className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
        isSelected ? "bg-gray-800" : "hover:bg-gray-800/60"
      }`}
    >
      {showRowIcon && (
        <span className="flex-shrink-0 mt-0.5">
          <ProviderIcon providerId={rowIconProvId} size={22} />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span
            className={`text-sm font-medium truncate ${isSelected ? "text-gray-100" : "text-gray-200"}`}
          >
            {model.label}
          </span>
          {isSelected && (
            <Check
              size={13}
              className="text-amber-400 flex-shrink-0 ml-auto"
              aria-hidden="true"
            />
          )}
        </span>
        {description && (
          <span className="block text-xs text-gray-500 truncate leading-tight mt-0.5">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

function DropdownContent({
  search,
  setSearch,
  searchRef,
  dropdownRef,
  handleSearchKeyDown,
  providerGroups,
  effectiveProvider,
  setActiveProvider,
  filteredModels,
  selectedModel,
  authSource,
  handleSelect,
  onClose,
}: DropdownContentProps) {
  // Show per-row provider icon when: searching, single provider, or browsing a mixed virtual group (free/misc)
  const showRowIcon = !!search || providerGroups.length <= 1 || effectiveProvider === "free" || effectiveProvider === "misc";

  return (
    <>
      {/* Header: search + close */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800 flex-shrink-0">
        <Search size={14} className="text-gray-500 flex-shrink-0" aria-hidden="true" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search models…"
          className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-gray-500 hover:text-gray-300 p-0.5"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 p-0.5"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body: provider sidebar + model list */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Vertical provider sidebar: icon-only on xs, icon+label on sm+ */}
        {!search && providerGroups.length > 1 && (
          <div className="flex flex-col w-10 sm:w-[120px] flex-shrink-0 border-r border-gray-800 overflow-y-auto py-1">
            {providerGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveProvider(group.id)}
                title={group.shortLabel}
                className={`flex items-center gap-2 px-2 sm:px-3 py-2 text-left transition-colors text-xs font-medium ${
                  effectiveProvider === group.id
                    ? "bg-gray-800 text-gray-100"
                    : "text-gray-400 hover:bg-gray-800/60 hover:text-gray-200"
                }`}
              >
                <ProviderIcon providerId={group.id} size={22} />
                <span className="hidden sm:block truncate leading-tight">{group.shortLabel}</span>
              </button>
            ))}
          </div>
        )}

        {/* Model list */}
        <div
          ref={dropdownRef}
          className="flex-1 overflow-y-auto py-1 min-w-0"
        >
          {filteredModels.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">
              No models found
            </div>
          ) : (
            filteredModels.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                authSource={authSource}
                isSelected={model.id === selectedModel}
                showRowIcon={showRowIcon}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Turn a raw model id into a human-readable label when no registry entry is found. */
function humanizeModelId(id: string): string {
  // Strip :free suffix
  const base = id.replace(/:free$/, "");
  // Take the part after the last slash (OpenRouter ids are "provider/name")
  const name = base.includes("/") ? base.split("/").pop()! : base;
  // Replace separators with spaces, title-case each word
  return name
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ─── ModelPicker props ─────────────────────────────────────────────────────────

interface ModelPickerProps {
  /** All available models for the current harness, keyed by harness. */
  modelOptionsByHarness: Record<string, ModelOption[]>;
  /** Optional auth source to limit visible models. */
  authSource?: PresetAuthSource;
  /** The currently selected harness id. */
  selectedHarness: string;
  /** The currently selected model id. */
  selectedModel: string;
  /** Called when the user picks a new model. */
  onChange: (modelId: string) => void;
  disabled?: boolean;
  /** Compact mode: smaller trigger. */
  compact?: boolean;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ModelPicker({
  modelOptionsByHarness,
  authSource,
  selectedHarness,
  selectedModel,
  onChange,
  disabled = false,
  compact = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  const models = filterModelsForAuthSource(modelOptionsByHarness[selectedHarness] ?? [], authSource, selectedHarness);
  const providerGroups = useMemo(() => buildProviderGroups(models), [models]);

  // Determine the active provider (default to first group or provider of selected model)
  const effectiveProvider = useMemo(() => {
    if (activeProvider && providerGroups.some((g) => g.id === activeProvider)) {
      return activeProvider;
    }
    // Default to the provider of the currently selected model
    const selProv = models.find((m) => m.id === selectedModel);
    if (selProv) {
      const prov = getModelProvider(selProv);
      if (providerGroups.some((g) => g.id === prov)) return prov;
    }
    return providerGroups[0]?.id ?? null;
  }, [activeProvider, providerGroups, models, selectedModel]);

  // Filtered models: if searching, show all matching; otherwise show active provider's models
  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      return models.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          (m.description?.toLowerCase().includes(q) ?? false),
      );
    }
    if (effectiveProvider) {
      return providerGroups.find((g) => g.id === effectiveProvider)?.models ?? [];
    }
    return models;
  }, [search, models, effectiveProvider, providerGroups]);

  const selectedModelObj = models.find((m) => m.id === selectedModel);
  const hideSelectedPrice = authSource === "chatgpt-subscription" && selectedModelObj?.id.startsWith("openai-codex:");
  const selectedProviderRaw = selectedModelObj ? getModelProvider(selectedModelObj) : null;
  // For free/misc virtual groups in the trigger, show the actual provider icon
  const selectedProvider = (selectedProviderRaw === "free" || selectedProviderRaw === "misc") && selectedModelObj?.id.includes("/")
    ? selectedModelObj.id.split("/")[0]
    : selectedProviderRaw;

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);


  // Focus search on open
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [open]);

  // Scroll selected model into view when dropdown opens
  useEffect(() => {
    if (!open || !dropdownRef.current) return;
    const sel = dropdownRef.current.querySelector("[data-selected='true']");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }, [open, effectiveProvider]);

  const handleSelect = useCallback(
    (modelId: string) => {
      onChange(modelId);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  // When search is active and user presses Escape, clear search first; then close
  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (search) {
        setSearch("");
      } else {
        setOpen(false);
      }
    }
  }

  // ── Trigger ──────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      <button
        type="button"
        data-id="evolve/model-picker-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700 hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-0 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
      >
        {/* Provider icon */}
        {selectedProvider && (
          <span className="flex-shrink-0">
            <ProviderIcon providerId={selectedProvider} size={compact ? 18 : 22} />
          </span>
        )}
        {/* Model name + price */}
        <span className="flex flex-col min-w-0 flex-1">
          <span className={`truncate font-medium leading-tight ${compact ? "text-xs" : "text-sm"}`}>
            {selectedModelObj?.label ?? humanizeModelId(selectedModel)}
          </span>
          {!compact && selectedModelObj?.inputPriceLabel && !hideSelectedPrice && (
            <span className="text-[10px] text-gray-500 leading-tight">
              {selectedModelObj.inputPriceLabel}
            </span>
          )}
        </span>
        <ChevronDown
          size={compact ? 12 : 14}
          strokeWidth={2}
          className={`flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {/* ── Dialog (all screen sizes) ────────────────────────────────── */}
      {open && typeof document !== "undefined" && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Dialog */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pick a model"
            className="fixed inset-x-0 top-0 z-50 flex justify-center pt-[15vh] px-4 pointer-events-none"
          >
            <div className="pointer-events-auto flex flex-col w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl shadow-black/60 overflow-hidden max-h-[min(520px,70dvh)]">
              <DropdownContent
                search={search}
                setSearch={setSearch}
                searchRef={searchRef}
                dropdownRef={dropdownRef}
                handleSearchKeyDown={handleSearchKeyDown}
                providerGroups={providerGroups}
                effectiveProvider={effectiveProvider}
                setActiveProvider={setActiveProvider}
                filteredModels={filteredModels}
                selectedModel={selectedModel}
                authSource={authSource}
                handleSelect={handleSelect}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
