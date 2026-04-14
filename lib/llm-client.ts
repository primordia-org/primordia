// lib/llm-client.ts
// Creates an Anthropic client, either pointed at the exe.dev LLM gateway
// (default) or directly at the Anthropic API with a user-supplied key.
//
// The gateway is available at http://169.254.169.254/gateway/llm/anthropic inside
// exe.dev VMs and requires no API key. All chat requests are routed through it
// unless the caller provides an explicit apiKey override.

import Anthropic from "@anthropic-ai/sdk";

const GATEWAY_BASE_URL = "http://169.254.169.254/gateway/llm/anthropic";

/**
 * Returns an Anthropic client.
 *
 * - When `apiKey` is provided, the client calls the Anthropic API directly
 *   using that key (no gateway).
 * - When `apiKey` is omitted or falsy, the client routes through the exe.dev
 *   LLM gateway (no API key required).
 */
export function getLlmClient(
  apiKey?: string,
): { client: Anthropic; source: "gateway" | "user-key" } {
  if (apiKey) {
    return {
      client: new Anthropic({ apiKey }),
      source: "user-key",
    };
  }
  return {
    client: new Anthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: "gateway", // gateway handles auth; SDK requires a non-empty value
    }),
    source: "gateway",
  };
}
