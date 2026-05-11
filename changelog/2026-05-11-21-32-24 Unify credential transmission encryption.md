# Unify credential transmission encryption

All credential types now use the same hybrid transmission envelope: an ephemeral AES-256-GCM key encrypts the secret payload, and the server's ephemeral RSA-OAEP public key wraps that AES key.

This removes the old API-key-specific direct RSA-OAEP path from the client and makes API keys, Claude Code credentials, and ChatGPT subscription credentials follow one shared encryption flow. The server still accepts legacy direct RSA-OAEP API-key payloads so older open browser tabs can submit successfully during deployment.
