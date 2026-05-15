import { Key } from "lucide-react";
import { ClaudeIcon } from "@/components/brand-icons/ClaudeIcon";
import { withBasePath } from "@/lib/base-path";
import { PRESET_AUTH_SOURCE_LABELS, type PresetAuthSource } from "@/lib/presets";
import type { AgentAuthInfo } from "@/lib/session-events";

export const AUTH_SOURCE_ICON_PATH: Partial<Record<PresetAuthSource, string>> = {
  "exe-dev-gateway": "/brand-icons/exe-dev-favicon.ico",

  "chatgpt-subscription": "/brand-icons/chatgpt-favicon.svg",
  "openrouter-api-key": "/brand-icons/openrouter-favicon.ico",
  "anthropic-api-key": "/brand-icons/anthropic-favicon.png",
  "openai-api-key": "/brand-icons/chatgpt-favicon.svg",
  "gemini-api-key": "/brand-icons/google-gemini-icon.png",
};

export const HARNESS_ICON_PATH: Record<string, string> = {
  codex: "/brand-icons/codex-favicon.svg",
  pi: "/brand-icons/pi-dev-favicon.svg",
};

export function authSourceFromAgentAuth(auth?: AgentAuthInfo): PresetAuthSource {
  if (!auth || auth.source === "llm-gateway") return "exe-dev-gateway";
  if (auth.source === "claude-credentials") return "claude-subscription";
  if (auth.source === "chatgpt-subscription") return "chatgpt-subscription";
  return "anthropic-api-key";
}

export function harnessLabel(harnessIdOrLabel?: string): string {
  if (!harnessIdOrLabel) return "Claude Code";
  if (harnessIdOrLabel === "claude-code") return "Claude Code";
  if (harnessIdOrLabel === "codex") return "Codex";
  if (harnessIdOrLabel === "pi") return "Pi";
  return harnessIdOrLabel;
}

export function AuthSourceIcon({ source, size = 16 }: { source?: PresetAuthSource; size?: number }) {
  if (source === "claude-subscription") {
    return <ClaudeIcon size={size} />;
  }
  const icon = source ? AUTH_SOURCE_ICON_PATH[source] : undefined;
  if (!icon) {
    return <Key size={size} strokeWidth={2.3} className="text-amber-400" aria-hidden="true" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={withBasePath(icon)} alt="" width={size} height={size} className="rounded-sm object-contain" aria-hidden="true" />
  );
}

export function HarnessIcon({ harness, size = 16 }: { harness?: string; size?: number }) {
  const key = harness === "Pi" ? "pi" : harness === "Codex" ? "codex" : harness === "Claude Code" ? "claude-code" : harness;
  if (key === "claude-code") {
    return <ClaudeIcon size={size} />;
  }
  const icon = key ? HARNESS_ICON_PATH[key] : undefined;
  if (!icon) {
    const text = harnessLabel(harness).slice(0, 2).toUpperCase();
    return <span className="inline-flex items-center justify-center rounded bg-gray-700 text-[9px] font-bold text-gray-300" style={{ width: size, height: size }}>{text}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={withBasePath(icon)} alt="" width={size} height={size} className="rounded-sm object-contain" aria-hidden="true" />
  );
}

export function AgentIdentityLine({
  authSource,
  auth,
  harness,
  model,
  className = "",
  iconSize = 14,
}: {
  authSource?: PresetAuthSource;
  auth?: AgentAuthInfo;
  harness?: string;
  model?: string;
  className?: string;
  iconSize?: number;
}) {
  const resolvedAuth = authSource ?? authSourceFromAgentAuth(auth);
  const authLabel = PRESET_AUTH_SOURCE_LABELS[resolvedAuth];
  const hLabel = harnessLabel(harness);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1 min-w-0" title={authLabel}>
        <AuthSourceIcon source={resolvedAuth} size={iconSize} />
        <span className="hidden truncate sm:inline">{authLabel}</span>
      </span>
      <span className="text-gray-600">/</span>
      <span className="inline-flex items-center gap-1 min-w-0" title={hLabel}>
        <HarnessIcon harness={harness} size={iconSize} />
        <span className="hidden truncate sm:inline">{hLabel}</span>
      </span>
      {model && (
        <>
          <span className="text-gray-600">/</span>
          <span className="truncate">{model}</span>
        </>
      )}
    </span>
  );
}
