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
//
// Tools:
//   Claude has access to read_file and list_directory tools, both sandboxed
//   to process.cwd(). Dotfiles are blocked to protect .env and .primordia-auth.db.

/**
 * Chat with Claude
 * @description Streams a chat response from Claude (claude-sonnet-4-6) as SSE.
 * Send an array of messages; receive a stream of `data: {"text":"..."}` events followed by `data: [DONE]`.
 * Requires an active session.
 * @tags Chat
 * @openapi
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { getLlmClient } from "@/lib/llm-client";
import { decryptApiKey } from "@/lib/llm-encryption";
import fs from "fs";
import path from "path";
import { getSessionUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// File access sandbox
// ---------------------------------------------------------------------------

const PROJECT_ROOT = process.cwd();

/**
 * Resolves a user-supplied path relative to PROJECT_ROOT and validates it:
 *   - Must stay within PROJECT_ROOT (no directory traversal)
 *   - No path component may start with "." (blocks dotfiles like .env, .primordia-auth.db)
 *
 * Returns { safe: true, absolute } or { safe: false, absolute }.
 */
function resolveSafePath(userPath: string): { safe: boolean; absolute: string } {
  const absolute = path.resolve(PROJECT_ROOT, userPath);

  // Must be inside the project root
  const isInRoot =
    absolute === PROJECT_ROOT ||
    absolute.startsWith(PROJECT_ROOT + path.sep);
  if (!isInRoot) return { safe: false, absolute };

  // No component of the relative path may start with "."
  const relative = path.relative(PROJECT_ROOT, absolute);
  if (relative !== "") {
    const parts = relative.split(path.sep);
    if (parts.some((p) => p.startsWith("."))) return { safe: false, absolute };
  }

  return { safe: true, absolute };
}

const ACCESS_DENIED =
  "Error: Access denied. Path is outside the project directory or references a dotfile.";

function toolReadFile(input: Record<string, unknown>): string {
  const { safe, absolute } = resolveSafePath(String(input.path ?? ""));
  if (!safe) return ACCESS_DENIED;
  try {
    return fs.readFileSync(absolute, "utf-8");
  } catch (e) {
    return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function toolListDirectory(input: Record<string, unknown>): string {
  const { safe, absolute } = resolveSafePath(String(input.path ?? "."));
  if (!safe) return ACCESS_DENIED;
  try {
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    const lines = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`);
    return lines.length > 0 ? lines.join("\n") : "(empty directory)";
  } catch (e) {
    return `Error listing directory: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function executeTool(name: string, input: Record<string, unknown>): string {
  if (name === "read_file") return toolReadFile(input);
  if (name === "list_directory") return toolListDirectory(input);
  return `Error: Unknown tool "${name}"`;
}

// ---------------------------------------------------------------------------
// Tool definitions sent to Claude
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description:
      "Read the text contents of a file in the project. Only files within the project root are accessible; dotfiles (e.g. .env, .primordia-auth.db) are blocked.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the file, relative to the project root (e.g. 'app/api/chat/route.ts').",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description:
      "List the files and subdirectories inside a project directory. Dotfiles are excluded. Only paths within the project root are accessible.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Path to the directory, relative to the project root. Use '.' for the root.",
        },
      },
      required: ["path"],
    },
  },
];

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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
    // Optional encrypted Anthropic API key (RSA-OAEP, base64) to use instead of gateway.
    encryptedApiKey?: string;
  };

  if (!body.messages || !Array.isArray(body.messages)) {
    return new Response(JSON.stringify({ error: "messages array required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Decrypt the user's API key right before creating the client, then clear it.
  let userApiKey: string | undefined;
  if (body.encryptedApiKey) {
    try {
      userApiKey = await decryptApiKey(body.encryptedApiKey);
    } catch {
      return new Response(
        JSON.stringify({ error: "Could not decrypt API key. Please try again." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  const { client } = getLlmClient(userApiKey);
  userApiKey = undefined; // clear from memory

  const basePrompt = buildSystemPrompt();
  const systemPrompt = body.systemContext
    ? `${basePrompt}\n\n${body.systemContext}`
    : basePrompt;

  // Create a ReadableStream that emits SSE chunks
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(text: string) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
        );
      }

      // Send a no-op SSE comment to keep the connection alive through proxies
      // that close idle connections (typically after 60-120 s).
      function keepAlive() {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }

      try {
        // messages is mutated when tools are used (Claude turn + tool result turn).
        // The input messages use simple string content; tool turns use block arrays.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = [...body.messages];

        // Agentic loop: keep calling Claude until it stops requesting tools.
        while (true) {
          const anthropicStream = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            system: systemPrompt,
            tools: TOOLS,
            messages,
          });

          // Stream text tokens to the client as they arrive.
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send(event.delta.text);
            }
          }

          const finalMsg = await anthropicStream.finalMessage();

          if (finalMsg.stop_reason !== "tool_use") {
            // No more tool calls — we're done.
            break;
          }

          // Send a keep-alive ping before executing tools so the connection
          // doesn't time out during a long tool-execution + re-prompt cycle.
          keepAlive();

          // Execute every tool the model requested and collect results.
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of finalMsg.content) {
            if (block.type !== "tool_use") continue;
            const result = executeTool(
              block.name,
              block.input as Record<string, unknown>
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }

          // Another keep-alive after tool execution, before the follow-up API call.
          keepAlive();

          // Append Claude's turn (with tool_use blocks) and our tool results turn.
          messages.push({ role: "assistant", content: finalMsg.content });
          messages.push({ role: "user", content: toolResults });
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error from Anthropic API";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ text: `\n\nError: ${msg}` })}\n\n`
          )
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
