// app/api/chat/route.ts
// Proxies chat messages to the Anthropic API and streams the response back to
// the client using Server-Sent Events (SSE).
//
// Request body:
//   { messages: Array<{ role: "user" | "assistant", content: string }> }
//
// Response:
//   A stream of SSE lines:
//     data: {"text": "<token>"}\n\n
//     data: [DONE]\n\n

import Anthropic from "@anthropic-ai/sdk";
// SYSTEM_PROMPT is generated at build time by scripts/generate-changelog.mjs
// (run as a prebuild/predev step). It embeds PRIMORDIA.md + the last 30
// changelog entry filenames so the assistant has accurate self-knowledge.
import { SYSTEM_PROMPT } from "@/lib/generated/system-prompt";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    // Optional extra context appended to the system prompt (e.g. deploy preview info).
    systemContext?: string;
  };

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: "messages array required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Create a ReadableStream that emits SSE chunks
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(text: string) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
        );
      }

      try {
        const anthropicStream = await client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: body.systemContext
            ? `${SYSTEM_PROMPT}\n\n${body.systemContext}`
            : SYSTEM_PROMPT,
          messages: body.messages,
        });

        for await (const event of anthropicStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send(event.delta.text);
          }
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error from Anthropic API";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: `\n\nError: ${msg}` })}\n\n`)
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
