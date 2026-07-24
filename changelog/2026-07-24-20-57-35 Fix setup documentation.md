# Fix setup documentation

Updated the setup documentation to make the supported installation path clear: Primordia installs on a local machine, VM, or exe.dev server with the one-line `curl -fsSL https://primordia.exe.xyz/install.sh | bash -s` command.

The README now includes the requested Deploy on exe.dev button, removes outdated manual deploy/setup steps from the primary flow, and clarifies that `REVERSE_PROXY_PORT` is normally written by the installer. CLAUDE.md now reflects the same installer-first setup guidance while preserving manual source-checkout notes for development.

Removed the now-unused `deploy-to-exe.dev` package script so the CLI surface matches the installer-first setup flow documented here.
