# Use Core API for thread decisions

Updated the thread detail page so accepting and rejecting a thread now call the Primordia Core route-action endpoints instead of the legacy `/api/thread/manage` endpoint. Follow-up submissions already used Core and continue through the Core follow-up endpoint.

The thread page remains server-rendered so `page.tsx` can keep owning metadata generation. Client-only state syncs that previously tripped React lint rules now defer those specific updates with `requestAnimationFrame` and cancel pending frames during cleanup.

This keeps the primary thread action buttons aligned with the Core API surface used by the lightweight thread page and CLI-backed route actions while matching the page's client-side streaming architecture.
