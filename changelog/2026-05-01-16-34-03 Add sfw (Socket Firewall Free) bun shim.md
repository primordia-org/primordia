# Add sfw (Socket Firewall Free) bun shim

## What changed

`scripts/install.sh` now sets up a lightweight security layer that routes every `bun` invocation through [sfw (Socket Firewall Free)](https://github.com/SocketDev/sfw-free), which filters outbound network traffic during package installs to block supply-chain attacks (malicious packages exfiltrating secrets on install or require).

### How it works

- `~/.bun/bin/sfw` is installed globally via the real bun binary
- `/bin/bun-real` is created as a symlink to the real `~/.bun/bin/bun`
- `/bin/bun` is replaced with a two-line bash shim: `exec bun-real --bun ~/.bun/bin/sfw bun-real "$@"`
- Because `/bin` is on PATH everywhere, the shim intercepts all `bun` invocations universally — interactive shells, non-interactive shells, SSH one-liners, systemd services, and agents — without any PATH ordering tricks or `.bashrc` sourcing
- The `--bun` flag forces sfw to run under the bun runtime instead of node
- The reverse proxy (`ExecStart`) uses `/bin/bun-real` directly to bypass sfw, since sfw would otherwise intercept the proxy's outbound HTTP connections
- Bun upgrades update `~/.bun/bin/bun` and the `/bin/bun-real` symlink follows automatically; the shim never needs updating

### Why

Any `bun install` — including those triggered automatically by the evolve pipeline in worktrees — is a potential vector for a malicious npm package to exfiltrate secrets. sfw intercepts outbound connections made during install and blocks unexpected ones. By replacing `/bin/bun` with the shim rather than manipulating PATH or wrapping specific script invocations, protection is automatic and universal with no opt-in required.
