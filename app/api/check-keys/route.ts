// app/api/check-keys/route.ts
// Returns a list of missing required environment variables.
// Called on page load by ChatInterface so users get an immediate warning
// if the app is misconfigured.
//
// All LLM traffic now routes through the exe.dev gateway — no API key is needed.

export async function GET() {
  const missing: Array<{ key: string; description: string }> = [];
  // No required API keys — the exe.dev LLM gateway handles all auth.
  return Response.json({ missing });
}
