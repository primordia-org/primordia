# Enable ChatGPT subscription OAuth for Pi

Primordia now wires stored ChatGPT subscription OAuth credentials into the Pi harness for ChatGPT/Codex models. The Pi model picker includes `openai-codex:*` models, evolve and follow-up requests securely transmit the stored ChatGPT OAuth payload using hybrid encryption, and the Pi worker loads it into Pi's `openai-codex` OAuth auth storage instead of treating it as a normal API key.

This lets users select ChatGPT subscription-backed Codex models in the Pi harness without spawning Codex/OpenAI CLI processes or exposing plaintext credentials at rest.
