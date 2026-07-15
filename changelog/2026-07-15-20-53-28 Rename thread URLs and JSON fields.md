# Rename thread URLs and JSON fields

Changed the user-facing thread detail URL from `/evolve/session/[id]` to `/thread/[id]`, with the legacy route redirecting to the new path so old links do not break.

Updated evolve-related REST JSON request and response fields from `sessionId` to `threadId`, including thread creation, follow-up, manage, restart, abort, upstream sync, force-reset, and admin-created thread flows. Query-based thread APIs now use `threadId` as well, and the UI now calls those endpoints with the new parameter name.

This continues the product-language shift away from implementation terms like evolve session and toward the user-facing concept of threads.
