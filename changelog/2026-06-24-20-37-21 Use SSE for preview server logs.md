# Use SSE for preview server logs

Evolve session preview server logs now stream through a client-side SSE connection instead of a recursive Server Component/Suspense tail. This keeps the browser from treating the page as perpetually loading while still showing an initial server-rendered log snapshot and following newly appended output live.

The log follower is resilient to empty or not-yet-created log files: the SSE endpoint reports when `.primordia-next-server.log` is missing, keeps the stream open while polling/watching for creation, and the client reconnects with backoff if the stream drops or returns an HTTP error.
