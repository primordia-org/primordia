# Add curl-pipe install script for exe.dev

Added `scripts/install-for-exe-dev.sh` — a one-command installer that runs on the user's **personal computer** and sets up a new Primordia instance in their exe.dev account end-to-end.

## What changed

- **New**: `scripts/install-for-exe-dev.sh` — the client-side entry point
- **New**: `app/install-for-exe-dev.sh/route.ts` — dynamic route that serves the script with the git-clone branch injected from the current `NEXT_BASE_PATH`
- **New**: `components/CopyButton.tsx` — one-click copy button used on the landing page
- **Updated**: `scripts/install.sh` — simplified to a server-side setup script (runs inside the cloned repo)
- **Updated**: `app/page.tsx` — curl install command is now the primary call-to-action on the landing page

## Usage

```bash
curl -fsSL https://primordia.exe.xyz/install-for-exe-dev.sh | bash
```

Run this on your personal computer — the machine that already has SSH keys for your exe.dev account.

## Branch-aware installs

When the script is served from a preview URL (e.g. `/preview/curl-pipe-install-script/install-for-exe-dev.sh`), the dynamic route automatically injects `--branch curl-pipe-install-script` into the `git clone` command. This means preview installs clone the same branch that the preview is serving, making it easy to test install changes end-to-end.

## What the script does

1. **Checks SSH access** to exe.dev (`ssh exe.dev help`) and exits with clear instructions if not configured.
2. **Prompts for a VM name** (default: `primordia`) — works interactively even when the script is piped through bash.
3. **Creates the VM** via `ssh exe.dev new --name=<name> --json`.
4. **Sets port 3000 as the public port** via `ssh exe.dev share port` + `ssh exe.dev share set-public`.
5. **SSHes into the new VM** and runs a self-contained setup:
   - Installs `git` and `bun` if missing.
   - Clones Primordia from `https://primordia.exe.xyz/api/git`.
   - Runs `scripts/install.sh` inside the cloned repo to build and start the service.
6. **Prints the app URL** (`https://<vmname>.exe.xyz/`) when done.

No API keys are collected during install — the app's `check_keys` flow prompts the owner for any missing configuration on first login.

## Bug fixes

**Silent exit in `curl | bash`** — When `ssh exe.dev help` ran without `-n`, it inherited bash's stdin (the pipe carrying the rest of the script), consuming it — causing bash to silently exit with code 0 after the SSH check line. All intermediate `ssh` invocations (`help`, `new`, `share port`, `share set-public`) now pass `-n` to redirect their stdin from `/dev/null`.

**Silent hang on VM name prompt** — `read -p "prompt"` sends its prompt to stderr. The prompt was being suppressed by `2>/dev/null` on the `read` call, so the script silently waited for input with nothing on screen. Fixed by writing the prompt explicitly to `/dev/tty` with `printf` and using plain `read -r < /dev/tty`.

**Wrong VM create syntax** — `ssh exe.dev new` does not accept a positional VM name argument. Fixed to use the `--name=<vm>` flag: `ssh exe.dev new --name=${VM_NAME} --json`.

## Spinner / progress dots

Long-running steps now print dots to the terminal so the user can tell the script is running (not hung):

- **Creating VM** — dots while `ssh exe.dev new` runs.
- **Configuring public port** — dots while `ssh exe.dev share port` + `share set-public` run.
- Remote install output is streamed live (via `-tt` SSH), so no spinner is needed there.

## Diagnostics

Both scripts are instrumented to make failures easy to debug:

- **System info printed at startup** — date, OS, hostname, disk/memory, SSH keys, bun/git versions.
- **Named steps** — each logical step sets `_CURRENT_STEP` so the ERR trap can print exactly where the script failed (e.g. `✗ Install failed at step: bun run build (line 89)`).
- **ERR trap on both scripts** — fires on any non-zero exit and prints the step name, line number, and (on the server) the last 30 lines of `journalctl` + `systemctl status`.
- **Full command output captured** — `ssh exe.dev new`, `share port`, and `share set-public` outputs are shown in dim diagnostic text; on failure the raw output is printed to stderr.
- **Timeout diagnostic dump** — if the service doesn't report ready within 60 s, the last 40 log lines and `systemctl status` are printed automatically rather than silently failing.
- **`bash -x` hint** — the ERR trap reminds the user they can re-run with `bash -x` for full trace output.

## Additional fixes (2026-04-12 follow-up)

### git clone fails: `Could not resolve host: primordia.exe.xyz`

New exe.dev VMs cannot resolve `primordia.exe.xyz` from within the exe.dev network (the domain routes through the proxy and is not directly resolvable from peer VMs). Fixed by:

1. **Pre-resolving on the local machine** — before SSHing into the new VM, the installer resolves `primordia.exe.xyz` to an IP using `python3`, `dig`, or `getent` (whichever is available on the user's Mac).
2. **Injecting the IP into `/etc/hosts` on the remote VM** — the resolved IP and hostname are passed as positional args (`bash -s -- HOST IP`) to the remote bash session. If the VM can't resolve the hostname, it's written to `/etc/hosts` before `git clone` runs. This preserves the HTTPS cert check (the hostname still matches; only DNS resolution is bypassed).

### Garbled box-drawing characters in remote output

exe.dev VMs don't have a UTF-8 locale set by default, causing Unicode box-drawing characters (`─`, `✓`, `▸`) to render as garbage. Fixed by setting `LANG`, `LC_ALL`, and `LANGUAGE` to `en_US.UTF-8` at the very start of the remote script section, plus running `sudo locale-gen en_US.UTF-8` (non-fatal if it fails).

### `bun install` fails with `ConnectionRefused` on new VMs — root cause: DNS race

The `ConnectionRefused` errors on every npm package were caused by DNS being unavailable, not by a missing outbound route. The symptom (`ConnectionRefused` vs `ETIMEDOUT`) pointed to `getaddrinfo` failing immediately rather than a slow connection.

Root cause: Ubuntu's `systemd-resolved` starts before the VM's NIC is fully initialised (a known race in systemd-257, [issue #35654](https://github.com/systemd/systemd/issues/35654)). This leaves `resolvectl status` reporting `Current Scopes: none` — meaning the resolver has no interface to send queries through — for up to 120 s after VM creation. All DNS lookups fail immediately until either the resolver self-recovers or is restarted.

Fixed by adding a `wait for DNS` step in both `install-for-exe-dev.sh` (in the remote heredoc) and `install.sh`, run before any network I/O:

1. **Detect** — `getent hosts registry.npmjs.org` to check if DNS is functional.
2. **Wait for NIC** — if DNS is not ready, call `sudo systemd-networkd-wait-online --timeout=30` to cleanly block until systemd-networkd reports the interface is fully configured (avoids polling the interface state manually).
3. **Flush cache** — `sudo resolvectl flush-caches` clears any stale negative entries now that the NIC is up.
4. **Restore `/etc/resolv.conf` symlink** — if the file is missing or doesn't point to `127.0.0.53`, restore the symlink to the stub resolver.
5. **Restart resolved** — if `resolvectl status` still shows `Current Scopes: none`, restart `systemd-networkd`, wait for it with `systemd-networkd-wait-online --timeout=15` (falling back to `sleep 5` if the command is missing), then restart `systemd-resolved`.
6. **Poll up to 60 s** — fallback polling every 2 s with dots printed to the terminal.
7. **Public DNS fallback** — if DNS is still broken after 60 s, write `1.1.1.1` and `8.8.8.8` directly to `/etc/resolv.conf` to bypass `systemd-resolved` entirely. If that also fails, exit with a diagnostic.

DNS diagnostic info (`resolv.conf` content, `Current Scopes` from `resolvectl`) is now included in both the remote and server diagnostics sections, making future failures easier to diagnose.

## Proxy fails to start production server: "no worktree for branch 'main'" (2026-04-12 follow-up #2)

The reverse proxy was logging `[proxy] cannot start prod server: no worktree for branch 'main'` on every fresh install, leaving the app unreachable.

### Root causes

1. **`spawn('bun', ...)` fails with ENOENT** — The proxy systemd service doesn't have `~/.bun/bin` in its PATH. When the proxy called `spawn('bun', ['run', 'start'], ...)` to start the production Next.js server, the OS couldn't find the `bun` binary. Fixed by:
   - Replacing `spawn('bun', ...)` with `spawn(process.execPath, ...)` across all three call sites — `process.execPath` is the absolute path to the running bun binary, always correct regardless of PATH.
   - Creating a symlink `/usr/local/bin/bun → ~/.bun/bin/bun` in `install-service.sh` as a belt-and-suspenders fix.
   - Adding explicit `PATH` and `HOME` to the systemd unit so the service environment is predictable.

2. **Worktree line parsing lacked `.trim()`** — `git worktree list --porcelain` output parsing in `startProdServerIfNeeded` used `.slice(9)` / `.slice(7)` without trimming. Any trailing whitespace or carriage return would cause the branch comparison to fail silently. Fixed with `.trimEnd()` + `.trim()` on parsed values.

3. **`branch.main.port` never set** — `install-service.sh` initialised `primordia.productionBranch = main` but never ran `assign-branch-ports.sh`, so `branch.main.port = 3001` was absent from git config. While the proxy defaults to port 3001, the missing entry caused unnecessary uncertainty. Fixed by calling `assign-branch-ports.sh` from `install-service.sh`.

4. **Fallback for edge cases** — Added a secondary fallback in `startProdServerIfNeeded`: if the worktree list lookup fails to find a worktree for the production branch, the proxy now checks whether `MAIN_REPO`'s own HEAD matches and uses it directly. Covers any edge case where the freshly-cloned repo doesn't appear in the worktree list output.

### Additional improvement

The readiness wait in `install.sh` was extended from 60 s to 120 s (the production Next.js server can take >60 s to start on a cold VM), and now also matches `✓ Ready` in addition to `Ready`.

## Why

The previous design required the script to be run on the server and prompted for API keys upfront. The new installer runs entirely from the user's laptop, orchestrates VM creation automatically, and defers all configuration to the app's own first-run flow.
