# Let workers load stored secrets

Changed evolve worker authentication so API endpoints no longer pass encrypted credential blobs through worker config files. Evolve workers now receive only the initiating user ID, selected auth source, and the Primordia AES key via the existing sensitive environment path, then load and decrypt the selected stored secret with `decryptStoredSecretForUser` themselves.

This simplifies the handoff between the evolve API and detached worker processes and avoids redundantly reading and serializing encrypted secrets just to have the worker decrypt them later.

Follow-up fix: Accept-time helper workers now preserve the session's most recent harness/model selection when resolving conflicts, auto-committing unstaged changes, or auto-fixing type errors. This prevents ChatGPT subscription sessions that originally used a Pi `openai-codex:*` model from falling back to Pi's default Claude model during Accept.
