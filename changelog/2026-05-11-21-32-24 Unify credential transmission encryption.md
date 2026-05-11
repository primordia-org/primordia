# Unify credential transmission encryption

All credential types now use the same hybrid transmission envelope: an ephemeral AES-256-GCM key encrypts the secret payload, and the server's ephemeral RSA-OAEP public key wraps that AES key.

This removes the old API-key-specific direct RSA-OAEP path and makes API keys, Claude Code credentials, and ChatGPT subscription credentials follow one shared encryption flow on both client and server.

Encrypted credential blobs now persist in a dedicated `encrypted_credentials` table keyed by `user_id` and clean `auth_source` values such as `anthropic-api-key`, `openrouter-api-key`, `claude-subscription`, and `chatgpt-subscription`, instead of ad-hoc user preference keys.

The obsolete `/api/llm-key/encrypted-key`, `/api/llm-key/encrypted-openrouter-key`, and `/api/llm-key/encrypted-credentials` storage endpoints were removed. Credential storage now goes through `/api/secrets/[type]`; `/api/llm-key/public-key` remains because clients still need the server RSA public key for hybrid transmission.
