# Serve primordia_setup.sh from app instead of uploading it

Extracted the inline heredoc from `scripts/install-for-exe-dev.sh` into a standalone script at `scripts/primordia_setup.sh`, and added `app/setup.sh/route.ts` to serve it at `/setup.sh`.

`install-for-exe-dev.sh` now downloads and pipes the script via `curl -fsSL https://primordia.exe.xyz/setup.sh | bash -s -- '<port>'` instead of uploading a copy over SSH. This means the setup script is always the current version from the running app — no need to keep it in sync with a local copy.
