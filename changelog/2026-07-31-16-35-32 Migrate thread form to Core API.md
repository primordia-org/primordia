# Migrate thread form to Core API

The thread request form now submits new threads through the Primordia Core route-action API (`/api/core/thread`) instead of the legacy `/api/thread` mutation. Follow-up requests on thread detail pages now use `/api/core/thread/[threadId]/followup`.

To preserve the web form capabilities from the old API, the Core API now accepts authenticated first-party web sessions in addition to revokable web API bearer keys. Multipart thread requests can still carry the browser-held `primordiaAesKey` when a selected preset needs encrypted billing credentials, and file attachments continue to flow through the Core multipart upload path.

The Core-exposed thread creation command also now accepts caveman mode and caveman intensity options, so the user's sticky caveman preferences remain available when the form uses Core API submission.
