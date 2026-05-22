# Harden reverse proxy crash boundaries

Audited the reverse proxy endpoints and raw socket paths for unhandled exceptions and crash risks. Added defensive boundaries around request handling, SSE writes, child-process spawning, git-config reloads, preview startup, production slot spawning, raw TCP classification, and scheduled cleanup work.

The proxy now logs unexpected errors and returns safe HTTP errors where possible instead of allowing request-level failures, client disconnects, missing ports, oversized buffered bodies, or malformed/slow raw socket input to crash the long-running proxy process.
