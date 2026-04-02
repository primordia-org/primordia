# Add file reading tools to chat mode

## What changed

Added two tools to the chat API (`app/api/chat/route.ts`) that give Claude the ability to read the live project files during a conversation:

- **`list_directory(path)`** — lists files and subdirectories inside a project directory, relative to the project root; dotfiles are excluded from the listing.
- **`read_file(path)`** — reads the text contents of a file, relative to the project root.

Both tools are sandboxed:
- Paths are resolved with `path.resolve()` and must stay within `process.cwd()` (the project root). Directory traversal attempts are blocked.
- Any path component starting with `.` is rejected, protecting `.env.local`, `.primordia-auth.db`, and other dotfiles.

The chat route now runs an agentic loop: after each Claude turn, if the stop reason is `tool_use`, the server executes the requested tools and feeds the results back to Claude. Text tokens are still streamed to the browser in real time as they arrive.

`max_tokens` was raised from 1024 to 4096 to accommodate tool-augmented responses.

The system prompt in `lib/system-prompt.ts` was updated to briefly describe the two new tools so Claude knows when to use them.

## Why

Chat mode previously only had the static PRIMORDIA.md and the last 30 changelog filenames baked into its system prompt at build time. This meant it could not answer questions about specific current file contents, actual code details, or project structure beyond what PRIMORDIA.md documented. Adding sandboxed file access makes chat mode genuinely useful for exploring and understanding the live codebase.
