# Use SSE for preview server logs

Evolve session preview server logs now stream through a client-side SSE connection instead of a recursive Server Component/Suspense tail. This keeps the browser from treating the page as perpetually loading while still showing an initial server-rendered log snapshot and following newly appended output live.
