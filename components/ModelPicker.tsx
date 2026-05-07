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
import type { ModelOption } from "../lib/agent-config";
import { withBasePath } from "../lib/base-path";

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
  anthropic:       { label: "Anthropic",       shortLabel: "Anthropic" },
  openai:          { label: "OpenAI",          shortLabel: "OpenAI" },
  "openai-native": { label: "OpenAI",          shortLabel: "OpenAI" },
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

/** Maps provider id → public path for a favicon PNG (base-path-prefixed at use time). */
const PROVIDER_FAVICON: Record<string, string> = {
  "openai-native":  "/brand-icons/openai-icon.png",
  openai:           "/brand-icons/openai-icon.png",
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

/** Provider icon: inline SVG for Anthropic/OpenAI/Google, favicon PNG for others. */
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
        className="flex items-center justify-center rounded-lg bg-[#cc785c]/15 text-[#cc785c] flex-shrink-0"
        style={style}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" width={size * 0.6} height={size * 0.6} fill="currentColor">
          <path d="M9.00387 20.1734L13.608 17.5917L13.6839 17.3655L13.608 17.2396H13.3803L12.6087 17.1927L9.97782 17.1222L7.70106 17.0284L5.48755 16.911L4.93101 16.7937L4.41241 16.1013L4.46301 15.761L4.93101 15.4441L5.60139 15.5028L7.08128 15.6084L9.30744 15.761L10.9138 15.8548L13.3044 16.1013H13.6839L13.7345 15.9487L13.608 15.8548L13.5068 15.761L11.2047 14.2002L8.71295 12.5573L7.41014 11.6067L6.71447 11.1256L6.36031 10.6796L6.20852 9.69386L6.84096 8.98975L7.70106 9.04843L7.91609 9.1071L8.78885 9.77601L10.6482 11.2194L13.0767 13.0032L13.4309 13.2966L13.5735 13.2003L13.5953 13.1323L13.4309 12.8624L12.1154 10.4801L10.7114 8.05093L10.079 7.04171L9.91458 6.44321C9.85088 6.19205 9.81339 5.98426 9.81339 5.72736L10.5344 4.74161L10.9391 4.61252L11.9131 4.74161L12.3178 5.09366L12.925 6.47842L13.8989 8.64943L15.4167 11.6067L15.8594 12.4868L16.0998 13.2966L16.1883 13.543H16.3401V13.4022L16.4666 11.7358L16.6943 9.69386L16.9219 7.06518L16.9978 6.32586L17.3646 5.43398L18.0983 4.95284L18.6674 5.22275L19.1354 5.89166L19.0722 6.32586L18.7939 8.13308L18.25 10.9613L17.8959 12.8624H18.0983L18.3386 12.6159L19.2999 11.3485L20.9063 9.33007L21.6146 8.53208L22.4494 7.65194L22.9806 7.22947H23.9925L24.7261 8.33258L24.3973 9.47089L23.3601 10.7852L22.5 11.9001L21.2667 13.5524L20.5015 14.8808L20.5701 14.9904L20.7545 14.9747L23.5372 14.3762L25.0424 14.1063L26.8385 13.8012L27.648 14.1767L27.7365 14.564L27.4203 15.3502L25.4977 15.8196L23.2463 16.2773L19.8935 17.0666L19.8564 17.0964L19.9002 17.1614L21.4122 17.2983L22.0573 17.3335H23.6384L26.5855 17.5564L27.3571 18.0611L27.8124 18.683L27.7365 19.1642L26.5475 19.7627L24.9538 19.3871L21.2225 18.4953L19.945 18.1784H19.7679V18.284L20.8304 19.3285L22.7909 21.0887L25.2321 23.3654L25.3586 23.9287L25.0424 24.3746L24.7135 24.3277L22.5632 22.7082L21.7284 21.9806L19.8564 20.3964H19.7299V20.5607L20.16 21.1944L22.4494 24.6328L22.5632 25.6889L22.3988 26.0293L21.8043 26.2405L21.1592 26.1231L19.8058 24.2338L18.4271 22.1214L17.314 20.2203L17.1796 20.3052L16.5172 27.3788L16.2136 27.7426L15.5053 28.0125L14.9108 27.5666L14.5946 26.839L14.9108 25.3956L15.2903 23.5179L15.5938 22.0276L15.8721 20.1734L16.042 19.554L16.027 19.5126L15.8913 19.5354L14.4934 21.4525L12.3684 24.3277L10.6861 26.1231L10.2814 26.2874L9.58571 25.9237L9.64895 25.2782L10.0411 24.7032L12.3684 21.7459L13.7724 19.9035L14.6773 18.8459L14.6685 18.6929L14.6185 18.6887L8.43468 22.7199L7.33425 22.8608L6.8536 22.4148L6.91685 21.6872L7.14452 21.4525L9.00387 20.1734Z" />
        </svg>
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

  // ── Favicon PNG for providers that have one (including OpenAI, Google/Gemini) ─────────────────────────────
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

  // Sort providers: free first, anthropic second, openai-native third, then rest alphabetically
  const priority: Record<string, number> = { free: 0, anthropic: 1, "openai-native": 2 };
  const providerIds = Object.keys(byProvider).sort((a, b) => {
    const pa = priority[a] ?? 99;
    const pb = priority[b] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });

  return providerIds.map((id) => {
    const meta = PROVIDER_META[id];
    return {
      id,
      label: meta?.label ?? id,
      shortLabel: meta?.shortLabel ?? id,
      models: byProvider[id],
    };
  });
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
  handleSelect: (id: string) => void;
  onClose: () => void;
}

function ModelRow({
  model,
  isSelected,
  showRowIcon,
  onSelect,
}: {
  model: ModelOption;
  isSelected: boolean;
  showRowIcon: boolean;
  onSelect: (id: string) => void;
}) {
  const provId = getModelProvider(model);
  // For free models, show the actual provider icon (not the green FREE badge)
  const rowIconProvId = provId === "free" && model.id.includes("/")
    ? model.id.split("/")[0]
    : provId;
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
        {model.description && (
          <span className="block text-xs text-gray-500 truncate leading-tight mt-0.5">
            {model.description}
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
  handleSelect,
  onClose,
}: DropdownContentProps) {
  // Show per-row provider icon when: searching (mixed results), single provider, or browsing the "free" group (mixed providers)
  const showRowIcon = !!search || providerGroups.length <= 1 || effectiveProvider === "free";

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

// ─── ModelPicker props ─────────────────────────────────────────────────────────

interface ModelPickerProps {
  /** All available models for the current harness, keyed by harness. */
  modelOptionsByHarness: Record<string, ModelOption[]>;
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
  selectedHarness,
  selectedModel,
  onChange,
  disabled = false,
  compact = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  const models = modelOptionsByHarness[selectedHarness] ?? [];
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
  const selectedProviderRaw = selectedModelObj ? getModelProvider(selectedModelObj) : null;
  // For free models in the trigger, show the actual provider icon not the FREE badge
  const selectedProvider = selectedProviderRaw === "free" && selectedModelObj?.id.includes("/")
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
        className={`flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
      >
        {/* Provider icon for selected model */}
        {selectedProvider && (
          <span className="flex-shrink-0">
            <ProviderIcon providerId={selectedProvider} size={compact ? 18 : 20} />
          </span>
        )}
        <span className="truncate max-w-[160px] sm:max-w-[240px]">
          {selectedModelObj?.label ?? selectedModel}
        </span>
        {selectedModelObj?.inputPriceLabel && (
          <span className="text-gray-500 text-[10px] flex-shrink-0 hidden sm:inline">
            {selectedModelObj.inputPriceLabel}
          </span>
        )}
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
