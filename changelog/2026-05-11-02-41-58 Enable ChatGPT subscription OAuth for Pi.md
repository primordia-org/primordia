# Enable ChatGPT subscription OAuth for Pi

Primordia now wires stored ChatGPT subscription OAuth credentials into the Pi harness for ChatGPT/Codex models. The Pi model picker includes `openai-codex:*` models, evolve and follow-up requests securely transmit the stored ChatGPT OAuth payload using hybrid encryption, and the Pi worker loads it into Pi's `openai-codex` OAuth auth storage instead of treating it as a normal API key.

This lets users select ChatGPT subscription-backed Codex models in the Pi harness without spawning Codex/OpenAI CLI processes or exposing plaintext credentials at rest.

Also fixed Pi worker compatibility with modern `minimatch` by using the package's ESM named import for path-scoped `.claude/rules/*.md` discovery.

The abort/recovery path now says “AI Agent” instead of “Claude Code”, reads the worktree PID file if in-memory worker state was lost, and signals the detached worker process group so Abort stops Pi/Claude workers and their subprocesses more reliably.
