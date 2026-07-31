# Migrate thread form to Core API

The thread request form now submits new threads through the Primordia Core route-action API (`/api/core/thread`) instead of the legacy `/api/thread` mutation. Follow-up requests on thread detail pages now use `/api/core/thread/[threadId]/followup`.

To preserve the web form capabilities from the old API without making Core depend on Next.js session auth, browsers now automatically create a revokable `web` API key after login. The key is noted with the detected browser and OS (for example, `Firefox / macOS`), stored in localStorage, sent to Core endpoints as a Bearer token, and revoked on logout.

The auto-generated web API key wraps the browser-held Primordia AES key, so stored billing credentials can still be decrypted by the worker when a selected preset needs them. Multipart file attachments continue to flow through the Core multipart upload path.

The Core-exposed thread creation command also now accepts caveman mode and caveman intensity options, so the user's sticky caveman preferences remain available when the form uses Core API submission.
