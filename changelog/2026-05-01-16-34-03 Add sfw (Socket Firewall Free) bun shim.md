# Add sfw (Socket Firewall Free) bun shim

## What changed

`scripts/install.sh` now sets up a lightweight security layer that routes every `bun` invocation through [sfw (Socket Firewall Free)](https://github.com/SocketDev/sfw-free), which filters outbound network traffic during package installs to block supply-chain attacks (malicious packages exfiltrating secrets on install or require).

### How it works

- `~/.bun/bin/sfw` is installed globally via `bun install -g sfw`
- `~/.primordia/bin/bun-real` is created as a symlink to the real `~/.bun/bin/bun`
- `~/.primordia/bin/bun` is written as a two-line bash shim: `exec sfw bun-real "$@"`
- `~/.primordia/bin` is prepended to PATH in `.bashrc` and in the systemd service unit, so the shim shadows the real bun for all callers — interactive shells, agents, and subprocesses alike
- Bun upgrades update `~/.bun/bin/bun` and the `bun-real` symlink follows automatically; the shim never needs updating

### Why

Any `bun install` — including those triggered automatically by the evolve pipeline in worktrees — is a potential vector for a malicious npm package to exfiltrate secrets. sfw intercepts outbound connections made during install and blocks unexpected ones. By shimming the bun binary itself rather than wrapping specific script invocations, protection is automatic and opt-out is impossible without deliberately bypassing the shim.
