# Remove example leak diagnostics report

Removed the checked-in sample CPU/memory leak diagnostics files that were originally used to preview the Server Health diagnostics UI. Because those files shipped with every deploy, fresh deployments incorrectly showed an "example report for UI testing" under “Diagnose CPU usage / memory leaks.”

Added `leak-diagnostics/` to `.gitignore` so real runtime diagnostics can still be generated locally on affected instances without being committed as bundled example data again.

Follow-up: simplified evolve secret handling so the browser sends only its local ECDH public key when starting, continuing, or accepting an evolve session. The server now derives a `PRIMORDIA_DECRYPTION_KEY` from that public key and its instance secret, passes only that key to workers, and workers read the selected encrypted credential directly from SQLite by user/auth source. Existing browser AES secrets are migrated to versioned ECDH ciphertexts in a nondestructive way: the new `ecdh-p256-v1` payload is added while legacy top-level ciphertext is kept for rollback compatibility. A CLI-friendly `getPlaintextCredentialsForUser(userId, publicKey, authSource)` utility now provides the simple plaintext resolution path.
