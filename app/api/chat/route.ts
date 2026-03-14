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

// The system prompt that gives Claude its Primordia persona.
// Keep this short — it should be expanded via PRIMORDIA.md as the app evolves.
const SYSTEM_PROMPT = `You are the AI assistant embedded in Primordia, a self-modifying web application.
You help users accomplish tasks and answer questions. Be concise and helpful.
When users seem interested in changing the app itself, remind them they can switch to "evolve mode" to propose changes.`;

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
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
          system: SYSTEM_PROMPT,
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
