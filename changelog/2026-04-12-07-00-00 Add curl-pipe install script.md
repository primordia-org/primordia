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

## Remote setup drops to interactive SSH prompt (2026-04-12 follow-up #3)

### Root cause

`ssh -tt host bash -s -- args << 'HEREDOC'` feeds the heredoc via the remote PTY's stdin. Any subprocess inside the script that reads fd 0 competes with bash for that same stdin. `sudo apt-get install -y locales` reads from stdin (even with `-y`), consuming the rest of the heredoc — leaving the script truncated and the user dropped into an interactive shell.

The PTY's local-echo feature also reflected the heredoc content back to the terminal, producing the garbled `exedev@primordia2:~$ set -euo pipefail` lines seen in previous output.

### Fix

Replaced the single `ssh -tt ... << 'HEREDOC'` with a two-step approach:

1. **Upload** — `ssh host 'cat > /tmp/primordia_setup.sh' << 'REMOTE'` saves the script to a temp file (no PTY; the heredoc is consumed entirely by `cat` and nothing else can grab it).
2. **Execute** — `ssh -tt host "bash /tmp/primordia_setup.sh ARGS; rm -f /tmp/primordia_setup.sh"` runs from the file. bash reads the script from the file, so subprocesses inherit a clean PTY stdin (the forwarded local terminal), not the script content.

Side benefit: because bash now reads from a file instead of the PTY, it doesn't enter interactive mode and the PTY echo is suppressed — command names no longer appear garbled in the output.

Belt-and-suspenders: added `DEBIAN_FRONTEND=noninteractive` and `</dev/null` to all `apt-get`, `locale-gen`, and `update-locale` calls in the remote script to prevent any future interactive stdin reads from those commands.

## `setlocale: LC_ALL: cannot change locale` warning (2026-04-12 follow-up #4)

The remote setup script was exporting `LC_ALL=en_US.UTF-8` _before_ installing the `locales` package and generating the locale. Bash emits a `warning: setlocale: LC_ALL: cannot change locale (en_US.UTF-8)` whenever you try to set a locale that hasn't been generated yet.

Fixed by reordering the remote script preamble: `apt-get install locales`, `locale-gen`, and `update-locale` now run first, and the `export LANG/LC_ALL/LANGUAGE` lines follow after.

## Readiness check replaced with HTTP polling (2026-04-12 follow-up #4)

`install.sh` was checking `journalctl` logs for the string `"Ready"` to decide when the service was up. This never matched because the proxy logs `[proxy] listening on :3000` (not "Ready"), while the Next.js server logs `✓ Ready` only to its own stdout (not captured by journalctl). The result: the 120 s wait always expired, even when the service was actually running within 30–50 s.

Replaced with an HTTP health check: the loop now calls `curl -sf http://localhost:${REVERSE_PROXY_PORT}/` and considers the service ready as soon as it gets any HTTP response. This is more reliable, version-independent, and matches the only thing that actually matters — whether the service is accepting connections.

## Install output cleaned up (2026-04-12 follow-up #5)

The installer output was verbose and repetitive. Cleaned up:

- **DNS pre-resolution removed** — the client-side `/etc/hosts` injection was overly complex; the remote DNS wait loop handles the race condition reliably without needing the local machine to resolve and pass an IP.
- **Redundant diagnostics removed** — the remote setup script had its own `--- Remote host diagnostics ---` block that duplicated information already printed by `install.sh`'s `--- Server diagnostics ---` block. Removed the duplicate.
- **Verbose step output captured** — `bun` (installer), `git clone`, `bun install`, and `bun run build` now run silently and only print their output if the command fails, keeping the happy path clean.
- **Redundant "done" message removed** — `install-for-exe-dev.sh` was printing its own "Primordia is running!" after the SSH session closed, duplicating `install.sh`'s done message. Removed.
- **Minor diag noise removed** — `Running: ssh exe.dev new ...` and `SSHing into ...` lines removed; the surrounding info/spinner lines already communicate the same thing.

## VM SSH not ready — script exits 0 with no error (2026-04-13 follow-up)

### Root cause

After the output cleanup removed the `share port` / `share set-public` steps, there was no longer any delay between VM creation and the script upload SSH command (Step 1). On a freshly created VM the SSH daemon takes 15–30 s to start, so Step 1 was failing immediately with connection refused.

This should have triggered `set -e` + the ERR trap, but there was a second bug masking it: Step 2's command was:

```bash
ssh -tt "${VM_HOST}" "bash /tmp/primordia_setup.sh '${PROXY_PORT}'; rm -f /tmp/primordia_setup.sh"
```

The `;` means `rm -f` always runs and its exit code (always 0, even for missing files) becomes the exit code of the whole compound command. SSH returns 0. The local script sees 0, never fires the ERR trap, and exits cleanly — producing `✓` in the shell prompt with no indication of failure.

The user sees `bash: /tmp/primordia_setup.sh: No such file or directory` from the remote side (because Step 1 never wrote the file) but the local script has already exited 0 so there's no matching error message.

### Fix

1. **SSH readiness check added** — before Step 1, the installer now polls `ssh … exit 0` in a loop (up to 60 s with dots printed) and fails loudly if the VM never becomes reachable. This eliminates the race condition cleanly.

2. **Step 2 exit code no longer masked** — `rm -f` is now a separate `ssh` call (with `|| true` so cleanup failure is non-fatal) rather than being chained with `;` after the `bash` call. Step 2's ssh now returns the real exit code of the setup script.

### bun install moved to `install.sh`

Bun was installed twice: once in the remote heredoc in `install-for-exe-dev.sh` and again in `install.sh`. The redundant bun install block has been removed from `install-for-exe-dev.sh`; `install.sh` already handles it as part of its own setup sequence.

## Why

The previous design required the script to be run on the server and prompted for API keys upfront. The new installer runs entirely from the user's laptop, orchestrates VM creation automatically, and defers all configuration to the app's own first-run flow.

## Installer output redesigned (2026-04-13 follow-up)

The installer output was redesigned to be cleaner and more readable:

### Visual hierarchy
- Local script steps use `▸` / `✓` at the top level
- Remote bootstrap steps use `  ▸` / `  ✓` (2-space indent), visually nested under the local script
- `▸ Running ~/primordia/scripts/install.sh...` acts as a section divider between the bootstrap phase and the install.sh phase
- install.sh respects `INSTALL_PREFIX` env var — when set to `"  "` by the bootstrap, all output is indented for visual nesting

### Changes
- **ASCII art banner**: PRIMORDIA rendered in figlet-style ASCII art at the top
- **Interactive prompt**: `? Choose VM name` prefix instead of plain text
- **`✓ VM SSH ready`**: explicit success message after the SSH readiness check
- **Upload step**: now shows `▸ Uploading /tmp/primordia_setup.sh...` / `✓ Uploaded successfully`
- **Removed**: `--- Diagnostics ---` block from happy path (ERR trap still shows diagnostics on failure)
- **Removed**: `VM JSON response:` dump, `Resolved hostname:` and `Proxy port:` diag lines
- **Removed**: `--- Server diagnostics ---` block from install.sh happy path (shown only in standalone mode)
- **Captured**: verbose output from `bun` installer, `git clone`, `bun install`, `bun run build`, and `install-service.sh` — only shown on failure
- **Simplified**: `install-service.sh` output replaced with `✓ Installed systemd service and enabled on boot` / `✓ Started primordia-proxy systemd service`
- **Removed**: intermediate `10s... 20s...` messages from readiness wait
- **Fixed**: stray `ssh -n ...` command text appearing in output — caused by the curl pipe's remaining content flowing into the remote PTY's stdin. Fixed by adding `-n` to `ssh -n -tt` in the execute step.

## Installer polish (2026-04-13 follow-up)

### In-place status line replacement

Status lines now replace themselves with the success result — `▸ Checking exe.dev SSH access...` becomes `✓ Connected to exe.dev` on the same line (using `\r\033[K` + reprint). Both the local script and all remote steps (bootstrap + install.sh) use this pattern via `_step()` / `_done()` helpers.

### New ASCII banner

The banner at the top of the installer is now the user-specified design:

```
  ___     _                  _ _
 | _ \_ _(_)_ __  ___ _ _ __| (_)__ _
 |  _/ '_| | '  \/ _ \ '_/ _` | / _` |
 |_| |_| |_|_|_|_\___/_| \__,_|_\__,_|

          . _  __|_ _ || _  _
          || |_\ | (_|||(/_|   for exe.dev
```

### Locale success message in bootstrap

The remote setup script now shows `✓ Updated locale to en_US.UTF-8 for better character support` after the locale install step (which runs before any UTF-8 output), rather than silently setting the locale.

### Removed "Useful commands:" section

The `journalctl`/`systemctl` tips at the end of `install.sh` have been removed — they aren't timely information for a first-run install flow.

## Phase context sentences (2026-04-13 follow-up)

Added short expectation-setting sentences before each major phase of the installer, so the user knows what's about to happen before it starts:

- **Before VM name prompt**: "First let's create a VM to install Primordia on:"
- **Before bootstrap upload**: "Next, we'll run a short script to install git and clone the Primordia repo:"
- **Before `install.sh`**: "Now we install Primordia using its installer:"
- **Before `install-service.sh`**: "Finally, let's ensure Primordia is automatically started on boot:"

## Whitespace consistency (2026-04-13 follow-up)

Tightened up vertical spacing so the output is cleaner and more consistent:

- **Phase headers** now end with `:` (not `.`) and are followed by a blank line, then content with no extra gaps
- **Bootstrap steps** (locale, DNS, git, clone) no longer have blank lines between them — they're compact, all at the same indent level
- **No blank line** between `Running /tmp/primordia_setup.sh:` and the first remote step
- **No blank line** between `Running ~/primordia/scripts/install.sh:` and the first install.sh step
- **No blank line** after the exe.dev host detection line when running in nested mode
- **`✓ Congratulations! Primordia is running!`** — printed at top level (no `  ` indent) so it stands out as the install's final positive confirmation
- **`Open:` and sign-in text** — also at top level (no `  ` indent), consistent with the congratulations line above

## Spinner and label polish (2026-04-13 follow-up)

### ASCII spinner instead of static `▸`

All `_step()` calls now start a background subprocess that cycles `\ | / -` in place at 120 ms intervals. `_done()` kills the subprocess and overwrites the line with `✓`. `_spin_kill()` is used on error paths to stop the spinner cleanly before printing diagnostics. This applies to all three scripts (`install-for-exe-dev.sh` local + remote heredoc, `install.sh`).

### Label changes

- `✓ Uploaded successfully` → `✓ Uploaded ./primordia_setup.sh successfully`
- `▸ Running setup script...` → `Running /tmp/primordia_setup.sh:` (plain section header, no spinner)
- `  ✓ git 2.43.0` → `  ✓ Using git 2.43.0`
- `  ▸ Running ~/primordia/scripts/install.sh...` → `Running ~/primordia/scripts/install.sh:` (plain section header, no spinner)
- `  ✓ bun 1.3.12` (fresh install) → `  ✓ Installed bun 1.3.12`
- `  ✓ Installed systemd service and enabled on boot` → `  ✓ Installed primordia-proxy systemd service and enabled on boot`
- `  ✓ Primordia is ready!\n\n  Primordia is running!` → `  ✓ Primordia is running!` (merged into single line, bold heading removed)
