// app/api/check-keys/route.ts
// Returns a list of missing required environment variables.
// Called on page load by ChatInterface so users get an immediate warning
// if the app is misconfigured.
//
// ANTHROPIC_API_KEY is only required when the exe.dev LLM gateway is not available.

import { isGatewayAvailable } from "@/lib/llm-client";

export async function GET() {
  const gatewayUp = await isGatewayAvailable();

  const missing: Array<{ key: string; description: string }> = [];

  if (!gatewayUp && !process.env.ANTHROPIC_API_KEY) {
    missing.push({ key: "ANTHROPIC_API_KEY", description: "Chat (Anthropic API)" });
  }

  return Response.json({ missing });
}
