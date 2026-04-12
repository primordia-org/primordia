# Add curl-pipe install script

Added `scripts/install.sh` — a one-command installer for Primordia on exe.dev servers.

## What changed

New script: `scripts/install.sh`

Users with an exe.dev account can now install Primordia with a single command run in their server's shell:

```bash
curl -fsSL https://raw.githubusercontent.com/boldsoftware/primordia/main/scripts/install.sh | bash
```

Or with a personal fork:

```bash
PRIMORDIA_REPO=your-username/primordia \
  curl -fsSL https://raw.githubusercontent.com/boldsoftware/primordia/main/scripts/install.sh | bash
```

## What the script does

1. **Detects the exe.dev environment** — recognises `*.exe.xyz` hostnames and sets the app URL accordingly; warns if running outside exe.dev (SSO and the LLM gateway won't be available).
2. **Installs git and bun** if not already present (via `apt-get` or `yum`).
3. **Checks for an existing install** — exits gracefully if `~/primordia` already has a `.git` directory.
4. **Prompts interactively** for:
   - `ANTHROPIC_API_KEY` (required for Evolve / Claude Code; warns and continues without it so the user can add it later)
   - `GITHUB_REPO` + `GITHUB_TOKEN` (optional, enables the Git Sync dialog)
5. **Clones the repo** into `~/primordia` (or `$INSTALL_DIR`).
6. **Writes `.env.local`** with the provided values.
7. **Runs `bun install --frozen-lockfile` and `bun run build`**.
8. **Runs `scripts/install-service.sh`** to install and start the `primordia-proxy` systemd service.
9. **Waits up to 60 s** for the Next.js server to emit its "Ready" signal.
10. **Prints the app URL** and next steps (sign in with exe.dev SSO, or register a passkey on other hosts).

## Why

The previous setup flow required users to fork the repo, configure `.env.local`, and run a local deploy script. The new installer runs entirely on the server and removes the need for any local setup, making it far easier for exe.dev users to spin up their own Primordia instance.
