# Remove example leak diagnostics report

Removed the checked-in sample CPU/memory leak diagnostics files that were originally used to preview the Server Health diagnostics UI. Because those files shipped with every deploy, fresh deployments incorrectly showed an "example report for UI testing" under “Diagnose CPU usage / memory leaks.”

Added `leak-diagnostics/` to `.gitignore` so real runtime diagnostics can still be generated locally on affected instances without being committed as bundled example data again.

Follow-up: simplified evolve secret handling so the browser sends only its local ECDH public key when starting, continuing, or accepting an evolve session. The server now derives a `PRIMORDIA_DECRYPTION_KEY` from that public key and its instance secret, passes the encrypted SQLite payload plus derived key to workers, and workers decrypt the selected credential themselves. This removes the app's browser decrypt-and-resend flow for evolve credentials and consolidates worker secret passing around `PRIMORDIA_DECRYPTION_KEY`.
