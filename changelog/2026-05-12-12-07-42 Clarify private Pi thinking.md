# Clarify private Pi thinking

Pi/GPT reasoning streams can start a thinking block without exposing any reasoning text, especially for OpenAI Codex/GPT models that sometimes keep thoughts private. The session view now labels those blocks as private reasoning instead of showing an empty “Thinking...” panel.

The Pi worker also records thinking-end markers and captures final thinking content when a provider sends it only at the end of the block, so completed sessions can show accurate “Thought for …” durations and recover thoughts that were not streamed as deltas.
