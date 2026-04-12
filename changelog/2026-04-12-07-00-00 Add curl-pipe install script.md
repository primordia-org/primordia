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

### `bun install` fails with `ConnectionRefused` on new VMs

New exe.dev VMs accept SSH connections immediately, but outbound routing to external services (specifically the npm registry at `registry.npmjs.org`) may not be fully established for the first ~30–60 seconds after creation. This causes `bun install --frozen-lockfile` to fail with `ConnectionRefused` on every package simultaneously.

Fixed by adding two defences in `scripts/install.sh`:

1. **Network readiness check** — before running `bun install`, poll `https://registry.npmjs.org/` with `curl` (2-second intervals, up to 60s total). If it becomes reachable, proceed immediately; if not, warn and try anyway.
2. **Retry logic** — `bun install` is attempted up to 3 times with a 15-second delay between failures. On final failure, a connectivity check is printed in the diagnostic output.

The IP injection for `primordia.exe.xyz` (added in the previous fix) is kept: that's a separate structural issue where VMs in the exe.dev network can't resolve the primordia domain through DNS (it routes through the proxy), and IP injection is the correct long-term fix regardless of timing.

## Why

The previous design required the script to be run on the server and prompted for API keys upfront. The new installer runs entirely from the user's laptop, orchestrates VM creation automatically, and defers all configuration to the app's own first-run flow.
