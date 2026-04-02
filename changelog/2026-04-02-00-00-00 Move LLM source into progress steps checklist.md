# Move LLM source into progress steps checklist

## What changed

In `lib/evolve-sessions.ts`, the LLM backend indicator was previously logged as a Markdown blockquote (`> LLM backend: exe.dev gateway`) that appeared above the setup checklist. It now appears as the first checklist item (`- [x] Determine LLM source: exe.dev gateway`), inline with the other setup steps.

## Why

- The blockquote rendered visually separate from the step list, making it feel like a separate "header" rather than part of the setup flow.
- Including it as a `- [x]` checklist item means it is counted in the "✅ N steps completed" summary (now shows **5 steps** instead of 4), and it collapses neatly with the rest of the setup details.
- The new wording "Determine LLM source" better describes what this step represents (a runtime check of which backend is in use), rather than just labelling it as a backend property.
