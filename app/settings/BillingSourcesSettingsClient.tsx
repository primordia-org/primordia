"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { AuthSourceIcon } from "@/components/AgentIdentity";
import type { SecretCiphertexts, SecretType } from "@/lib/secret-types";
import ApiKeySettingsClient from "./ApiKeySettingsClient";
import CredentialsSettingsClient from "./subscriptions/CredentialsSettingsClient";
import ChatGptSubscriptionSettingsClient from "./subscriptions/ChatGptSubscriptionSettingsClient";

type BillingSourceId = "anthropic-api-key" | "openrouter-api-key" | "claude-subscription" | "chatgpt-subscription";

const SOURCE_OPTIONS: {
  id: BillingSourceId;
  title: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    id: "anthropic-api-key",
    title: "Anthropic API key",
    description: "Use your own Anthropic API key for Claude models.",
    icon: <AuthSourceIcon source="anthropic-api-key" size={20} />,
  },
  {
    id: "openrouter-api-key",
    title: "OpenRouter API key",
    description: "Use OpenRouter models through the Pi harness.",
    icon: <AuthSourceIcon source="openrouter-api-key" size={20} />,
  },
  {
    id: "claude-subscription",
    title: "Claude.ai subscription",
    description: "Use Claude Code with your Claude.ai account credentials.",
    icon: <AuthSourceIcon source="claude-subscription" size={20} />,
  },
  {
    id: "chatgpt-subscription",
    title: "ChatGPT subscription",
    description: "Use Codex models through Pi with ChatGPT OAuth credentials.",
    icon: <AuthSourceIcon source="chatgpt-subscription" size={20} />,
  },
];

function GatewaySourceCard() {
  return (
    <div className="border border-gray-700 rounded-xl overflow-hidden bg-gray-900/30 transition-colors">
      <div className="flex items-start gap-3 px-4 py-3 bg-gray-800/50">
        <div className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center shrink-0">
          <AuthSourceIcon source="exe-dev-gateway" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100">exe.dev LLM gateway</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-950/50 text-blue-300 border border-blue-900/50">default</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/50">Active</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Built-in billing source available without adding credentials.</p>
        </div>
      </div>
    </div>
  );
}

function AddBillingSource({ added, onAdd }: { added: BillingSourceId[]; onAdd: (id: BillingSourceId) => void }) {
  const [choosing, setChoosing] = useState(false);
  const available = SOURCE_OPTIONS.filter((source) => !added.includes(source.id));

  if (available.length === 0) {
    return <p className="text-xs text-gray-500 px-1">All supported billing sources have been added.</p>;
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-700 hover:border-gray-500 transition-colors">
      {!choosing ? (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
        >
          <Plus size={14} strokeWidth={2} />
          Add another billing source
        </button>
      ) : (
        <div className="p-2 space-y-1">
          {available.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => {
                onAdd(source.id);
                setChoosing(false);
              }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-800 transition-colors"
            >
              <span className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 flex items-center justify-center shrink-0">
                {source.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-200">{source.title}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{source.description}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function SourceContent({
  source,
  initialSecretCiphertexts,
}: {
  source: BillingSourceId;
  initialSecretCiphertexts: SecretCiphertexts;
}) {
  if (source === "anthropic-api-key") return <ApiKeySettingsClient provider="anthropic" initialCiphertext={initialSecretCiphertexts.ANTHROPIC_API_KEY ?? null} />;
  if (source === "openrouter-api-key") return <ApiKeySettingsClient provider="openrouter" initialCiphertext={initialSecretCiphertexts.OPENROUTER_API_KEY ?? null} />;
  if (source === "claude-subscription") return <CredentialsSettingsClient initialCiphertext={initialSecretCiphertexts.CLAUDE_CODE_CREDENTIALS_JSON ?? null} />;
  return <ChatGptSubscriptionSettingsClient initialCiphertext={initialSecretCiphertexts.CHATGPT_SUBSCRIPTION_OAUTH ?? null} />;
}

export default function BillingSourcesSettingsClient({
  initialSecretTypes,
  initialSecretCiphertexts,
}: {
  initialSecretTypes: SecretType[];
  initialSecretCiphertexts: SecretCiphertexts;
}) {
  const initialAdded = useMemo(() => {
    const activeSources: BillingSourceId[] = [];
    if (initialSecretTypes.includes("ANTHROPIC_API_KEY")) activeSources.push("anthropic-api-key");
    if (initialSecretTypes.includes("OPENROUTER_API_KEY")) activeSources.push("openrouter-api-key");
    if (initialSecretTypes.includes("CLAUDE_CODE_CREDENTIALS_JSON")) activeSources.push("claude-subscription");
    if (initialSecretTypes.includes("CHATGPT_SUBSCRIPTION_OAUTH")) activeSources.push("chatgpt-subscription");
    return activeSources;
  }, [initialSecretTypes]);
  const [added, setAdded] = useState<BillingSourceId[]>(initialAdded);

  const addedSources = useMemo(
    () => SOURCE_OPTIONS.filter((source) => added.includes(source.id)),
    [added],
  );

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-100">Billing sources</h1>
        <p className="text-sm text-gray-400 mt-1">
          Start with the built-in gateway, or add only the API key or subscription source you want to use in Evolve presets.
        </p>
      </div>

      <div className="grid gap-2">
        <GatewaySourceCard />

        {addedSources.map((source) => (
          <SourceContent key={source.id} source={source.id} initialSecretCiphertexts={initialSecretCiphertexts} />
        ))}

        <AddBillingSource
          added={added}
          onAdd={(source) => setAdded((current) => current.includes(source) ? current : [...current, source])}
        />
      </div>
    </section>
  );
}
