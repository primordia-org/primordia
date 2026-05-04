# Clarify credentials retention in dialog

Changed the wording in the Claude Credentials dialog from "the plaintext is never stored or transmitted" to "the decrypted credentials are only kept on the server for the duration of the agent run."

The old text was inaccurate — the server does briefly hold the decrypted credentials while running the Claude Code agent. The new text is more precise: it correctly describes that the decrypted credentials are held server-side only for as long as the agent run lasts, not persisted.
