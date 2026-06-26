# Sketch Primordia CLI core

Added a new documentation sketch for a future `primordia` CLI and package split that would move Primordia's core evolve, thread, preview, and deployment capabilities out of the Next.js app and optional reverse proxy.

The document outlines likely commands, framework-agnostic adapter contracts, a package split, local API mode, example workflows for terminal and Astro usage, and a migration plan for extracting existing internals into a reusable Primordia Core layer. It now uses `thread` as the user-facing name for evolve work, combining what Primordia currently calls sessions and backing branches into one concept while keeping git branches as an internal implementation detail.
