# Show localhost URL on first install for exe.xyz hosts

## What changed

When the install script completes on an exe.xyz host and this is a **first-time install** (no prior production branch), it now prints two URLs instead of one:

- **Open (internal):** `http://localhost:<port>` — always reachable from within the VM immediately after install
- **Open (external):** `https://<hostname>.exe.xyz` — the public URL, with a note that it requires public access to be enabled on the exe.dev dashboard

For updates (re-runs of the install script on an existing instance) and for non-exe.xyz hosts, the output is unchanged — only the single relevant URL is printed.

## Why

exe.xyz instances are **private by default**. The external HTTPS URL is not accessible until the owner explicitly enables public access in the exe.dev dashboard. Previously the script only printed the external URL, which caused confusion when an automated agent (Shelley) tried to open the app immediately after install and found it unreachable. Printing the localhost address first gives both humans and agents a URL that is guaranteed to work right away.
