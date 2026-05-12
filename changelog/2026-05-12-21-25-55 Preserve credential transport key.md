# Preserve credential transport key

Fixed stale-tab credential submission failures after accepting a worktree to production.

The browser credentials and local AES key were not changing. The failure came from the server-side RSA transport key used to wrap credentials for each request: it was generated per server process, so a blue/green production swap could leave already-open tabs encrypting to a key that the new server could not decrypt.

The RSA transport keypair is now persisted in the Primordia root and ignored by git, so production swaps keep accepting encrypted payloads from existing tabs. The client also fetches the public transport key for every credential transmission instead of reusing a module-level cached key, making future key rotation graceful.