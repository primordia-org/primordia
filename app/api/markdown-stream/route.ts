// app/api/markdown-stream/route.ts
// Streams a comprehensive markdown sample character-by-character via SSE.
// Used by the /markdown-test page to exercise the streamdown integration.

export const dynamic = "force-dynamic";

const FULL_MARKDOWN = `# Markdown Streaming Test

Welcome to the **streamdown** integration test. This page streams all major Markdown syntax in real time.

---

## Headings

# H1 — The Quick Brown Fox
## H2 — Jumps Over
### H3 — The Lazy Dog
#### H4 — Pack my box
##### H5 — with five dozen
###### H6 — liquor jugs

---

## Emphasis & Inline Formatting

Plain text, **bold text**, *italic text*, ***bold and italic***, ~~strikethrough~~, and \`inline code\`.

Here is a [link to the Streamdown docs](https://streamdown.ai/docs) and an ![alt text](https://placehold.co/32x32/333/ccc?text=img) image.

---

## Blockquotes

> "The only way to do great work is to love what you do."
> — Steve Jobs

> Nested blockquotes:
>
> > This is a nested quote.
> >
> > > And one more level deep.

---

## Lists

### Unordered

- Apples
- Bananas
  - Cavendish
  - Lady Finger
- Cherries

### Ordered

1. First item
2. Second item
   1. Sub-item A
   2. Sub-item B
3. Third item

### Task list

- [x] Design the test page
- [x] Add streaming API route
- [ ] Deploy to production
- [ ] Celebrate 🎉

---

## Code Blocks

### JavaScript

\`\`\`javascript
// Fibonacci with memoization
function fib(n, memo = {}) {
  if (n in memo) return memo[n];
  if (n <= 1) return n;
  memo[n] = fib(n - 1, memo) + fib(n - 2, memo);
  return memo[n];
}

console.log(fib(40)); // 102334155
\`\`\`

### TypeScript

\`\`\`typescript
interface StreamChunk {
  id: string;
  delta: string;
  done: boolean;
}

async function* streamMarkdown(url: string): AsyncGenerator<string> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    yield decoder.decode(value);
  }
}
\`\`\`

### Python

\`\`\`python
import asyncio

async def stream_tokens(text: str, delay: float = 0.02):
    for char in text:
        yield char
        await asyncio.sleep(delay)

async def main():
    async for token in stream_tokens("Hello, world!"):
        print(token, end="", flush=True)
\`\`\`

### Bash

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail

# Tail logs and highlight errors
journalctl -u primordia -f | while IFS= read -r line; do
  if echo "$line" | grep -qi "error"; then
    echo -e "\\e[31m$line\\e[0m"
  else
    echo "$line"
  fi
done
\`\`\`

---

## Tables

| Feature            | Status | Notes                          |
|--------------------|:------:|--------------------------------|
| Streaming mode     | ✅     | \`mode="streaming"\`           |
| Static mode        | ✅     | \`mode="static"\`              |
| GFM tables         | ✅     | GitHub Flavored Markdown       |
| Task lists         | ✅     | \`- [x]\` syntax               |
| Syntax highlight   | ✅     | Via Shiki                      |
| Math / LaTeX       | ⚙️     | Optional plugin                |
| Mermaid diagrams   | ⚙️     | Optional plugin                |

---

## Horizontal Rules

One:

---

Two:

***

Three:

___

---

## Inline HTML

<details>
<summary>Click to expand</summary>

This content is inside an HTML \`<details>\` block, rendered directly from Markdown source.

</details>

---

## Long Paragraph (streaming stress test)

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Praesent commodo cursus magna, vel scelerisque nisl consectetur. Cras mattis consectetur purus sit amet fermentum. Cras justo odio, dapibus ac facilisis in, egestas eget quam. Nullam quis risus eget urna mollis ornare vel eu leo. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.

---

## Nested Mixed Content

1. **Step one** — Install dependencies

   \`\`\`bash
   bun install
   \`\`\`

2. **Step two** — Configure environment

   Copy \`.env.example\` to \`.env.local\` and fill in:

   | Key                  | Required | Description              |
   |----------------------|----------|--------------------------|
   | \`REVERSE_PROXY_PORT\`| Yes      | Blue/green proxy port    |

3. **Step three** — Run locally

   \`\`\`bash
   bun run dev
   \`\`\`

   > **Note:** Turbopack is enabled by default for fast refresh.

4. **Step four** — Deploy 🚀

---

## End

That's all the major Markdown syntax. Streaming complete ✓
`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Delay in ms between each character (default 8 ms → ~125 chars/s)
  const delay = Math.max(0, Math.min(200, Number(searchParams.get("delay") ?? "8")));
  // Chunk size: how many characters to send per tick
  const chunkSize = Math.max(1, Math.min(50, Number(searchParams.get("chunk") ?? "3")));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < FULL_MARKDOWN.length; i += chunkSize) {
        const slice = FULL_MARKDOWN.slice(i, i + chunkSize);
        const sseEvent = `data: ${JSON.stringify(slice)}\n\n`;
        controller.enqueue(encoder.encode(sseEvent));

        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
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
