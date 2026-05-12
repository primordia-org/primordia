# Add subscription settings

Changed the previous `/settings/claude-ai` surface into `/settings/subscriptions`, preserving the existing API Keys page at `/settings`. The new Subscriptions tab keeps the Claude.ai subscription section and adds a ChatGPT section beneath it.

The ChatGPT section authenticates via the Codex device-code OAuth flow directly from the web app and stores the resulting OAuth credential JSON in the existing encrypted user secrets system. It does not spawn Codex, OpenAI CLI, or any other helper process.
