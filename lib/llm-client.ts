// lib/llm-client.ts
// Creates an Anthropic client pointed at the exe.dev LLM gateway.
//
// The gateway is available at http://169.254.169.254/gateway/llm/anthropic inside
// exe.dev VMs and requires no API key. All chat requests are routed through it.

import Anthropic from "@anthropic-ai/sdk";

const GATEWAY_BASE_URL = "http://169.254.169.254/gateway/llm/anthropic";

/**
 * Returns an Anthropic client configured to use the exe.dev LLM gateway.
 */
export function getLlmClient(): { client: Anthropic; source: "gateway" } {
  return {
    client: new Anthropic({
      baseURL: GATEWAY_BASE_URL,
      apiKey: "gateway", // gateway handles auth; SDK requires a non-empty value
    }),
    source: "gateway",
  };
}
