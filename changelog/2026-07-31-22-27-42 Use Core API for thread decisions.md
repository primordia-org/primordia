# Use Core API for thread decisions

Updated the thread detail page so accepting and rejecting a thread now call the Primordia Core route-action endpoints instead of the legacy `/api/thread/manage` endpoint. Follow-up submissions already used Core and continue through the Core follow-up endpoint.

The thread view shell now loads the heavy live thread UI client-only, avoiding server rendering for the highly browser-driven session page instead of using requestAnimationFrame as a hydration workaround.

This keeps the primary thread action buttons aligned with the Core API surface used by the lightweight thread page and CLI-backed route actions while matching the page's client-side streaming architecture.
