#!/usr/bin/env python3
# scripts/claude-auth-pty.py
#
# PTY wrapper for the claude first-run interactive authentication flow.
#
# Runs `claude` (no subcommand) in a fresh CLAUDE_CONFIG_DIR so the full
# first-run setup wizard fires:
#   1. Theme selector  (❯ menu)  → press \r to accept default (Dark mode)
#   2. Login method    (❯ menu)  → press \r to accept first option
#                                   (Claude subscription)
#   3. Wait for "Paste code here…" prompt — extract URL from buffered output
#   4. User pastes code          → forward to claude via PTY
#   5. Poll for .credentials.json → once it exists, /exit claude
#
# Protocol (stdout, one line each):
#   URL:<url>    — OAuth URL to visit
#   DONE         — credentials written, claude exited cleanly
#   ERROR:<msg>  — fatal error; process exits non-zero
#
# Everything from the claude process is forwarded to stderr so Node.js can
# surface it in the live log panel.
#
# Terminal width notes:
#   • Normal width (220) keeps the theme/login menus rendering correctly.
#   • The OAuth URL (~480 chars) wraps across several lines at that width.
#   • We reconstruct the full URL from child.before by stripping ANSI codes
#     and joining consecutive non-space lines starting with "https://".
#   • An extreme width (10000) causes claude to render without the ❯
#     cursor, breaking menu detection — keep terminal dimensions sane.

import os
import re
import sys
import time
import pexpect

env = os.environ.copy()
CRED_PATH = os.path.join(env.get("CLAUDE_CONFIG_DIR", ""), ".credentials.json")

# Strip all ANSI/VT100 escape sequences from a string.
_ANSI_RE = re.compile(r'\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')

def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub('', s)


def extract_url(raw: str) -> str:
    """
    Reconstruct an OAuth URL that may have been wrapped across multiple lines
    by the terminal.  Strategy:
      1. Strip ANSI escape sequences.
      2. Split into lines (remove \\r).
      3. Find the line that starts with "https://".
      4. Append subsequent lines that contain no spaces (= URL continuation).
      5. Stop on a blank line or any line with a space.
    """
    clean = strip_ansi(raw)
    lines = [line.strip('\r') for line in clean.split('\n')]
    url = ''
    in_url = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_url:
                break       # blank line terminates the URL block
            continue
        if stripped.startswith('https://'):
            url = stripped
            in_url = True
        elif in_url and ' ' not in stripped and '\t' not in stripped:
            url += stripped  # continuation fragment (no spaces = URL chars only)
        elif in_url:
            break            # non-URL content terminates the URL block
    return url.rstrip('.,;)')


def die(msg: str) -> None:
    sys.stderr.write(f"[pty-wrapper] FATAL: {msg}\n")
    sys.stderr.flush()
    print(f"ERROR:{msg}", flush=True)
    sys.exit(1)


def log(msg: str) -> None:
    sys.stderr.write(f"[pty-wrapper] {msg}\n")
    sys.stderr.flush()


try:
    child = pexpect.spawn(
        "claude",
        env=env,
        timeout=30,
        encoding="utf-8",
        echo=False,
        # 220 columns: normal width keeps the theme/login menus intact.
        # The URL wraps but we reconstruct it from child.before.
        dimensions=(50, 220),
    )

    # Forward everything the child outputs to our stderr (Node.js log).
    child.logfile_read = sys.stderr

    # ── Step 1: Theme selector ──────────────────────────────────────────────
    log("waiting for theme menu (❯)…")
    idx = child.expect(["❯", pexpect.EOF, pexpect.TIMEOUT])
    if idx != 0:
        die(f"did not see theme menu (idx={idx})")
    log("theme menu found — pressing \\r to accept default")
    child.send("\r")

    # ── Step 2: Login method selector ──────────────────────────────────────
    log("waiting for login-method menu (❯)…")
    idx = child.expect(["❯", pexpect.EOF, pexpect.TIMEOUT])
    if idx != 0:
        die(f"did not see login-method menu (idx={idx})")
    log("login-method menu found — pressing \\r to select Claude subscription")
    child.send("\r")

    # ── Step 3: Wait for code-input prompt; extract URL from buffered output ─
    # "Paste code here if prompted >" appears right after the URL is shown.
    # child.before (between the login ❯ match and the "Paste" match) contains
    # all the output including the URL, possibly wrapped across multiple lines.
    log("waiting for code-input prompt (will extract URL from buffered output)…")
    idx = child.expect(["Paste", pexpect.EOF, pexpect.TIMEOUT], timeout=60)
    if idx == 1:
        die("claude exited before showing the code-input prompt")
    if idx == 2:
        die("timed out waiting for code-input prompt (60 s)")

    raw_before = child.before or ''
    log(f"code-input prompt seen; extracting URL from {len(raw_before)} chars of buffered output")

    url = extract_url(raw_before)
    if not url.startswith("https://"):
        # Dump a snippet to stderr so the log panel shows what we got
        snippet = strip_ansi(raw_before)[-400:].replace('\r', '').replace('\n', '↵')
        die(f"could not extract URL from buffered output. snippet: {snippet}")

    log(f"URL extracted ({len(url)} chars)")
    print(f"URL:{url}", flush=True)

    # ── Step 4: Read code from Node.js, forward to claude ──────────────────
    log("waiting for authorization code on stdin…")
    code = sys.stdin.readline().strip()
    if not code:
        die("no authorization code received on stdin")
    log(f"got code ({len(code)} chars), sending to claude via PTY")
    child.sendline(code)

    # ── Step 5a: Wait for "Login successful. Press Enter to continue…" ───────
    # After a valid code claude verifies it with the server, shows a success
    # screen, and waits for Enter before writing credentials and entering the
    # REPL.  We must press Enter here or credentials are never written.
    #
    # Claude renders the success screen as a box bordered with asterisks
    # (e.g. "****...****") using cursor-up ANSI codes, so the literal words
    # "successful" / "Press Enter" may not appear in the raw PTY stream.
    # Match the asterisk border line as an additional signal; also send Enter
    # on timeout so credentials are still written if the pattern changed again.
    log("waiting for login-success screen…")
    idx = child.expect(
        [r"successful", r"ress Enter", r"\*{20,}", pexpect.EOF, pexpect.TIMEOUT],
        timeout=60,
    )
    if idx in (0, 1, 2):
        log("login-success / 'Press Enter to continue' / asterisk border seen — sending Enter")
        child.send("\r")
    elif idx == 3:
        log("claude exited (EOF) after code — will check for credentials")
    elif idx == 4:
        # Timed out without seeing the expected prompt — send Enter anyway in
        # case Claude is silently waiting for it (credentials won't be written
        # until Enter is pressed on the success screen).
        log("timeout waiting for success screen — sending Enter anyway and polling")
        child.send("\r")

    # ── Step 5b: Poll for .credentials.json ────────────────────────────────
    # After pressing Enter on the success screen, claude writes
    # .credentials.json and enters the REPL.
    log("polling for .credentials.json…")
    POLL_INTERVAL = 1.0
    POLL_TIMEOUT  = 60

    deadline = time.time() + POLL_TIMEOUT
    cred_found = False

    while time.time() < deadline:
        try:
            child.expect(pexpect.TIMEOUT, timeout=POLL_INTERVAL)
        except pexpect.EOF:
            log("claude exited (EOF) during polling")
            break

        if os.path.exists(CRED_PATH):
            log(f".credentials.json found ({os.path.getsize(CRED_PATH)} bytes)")
            cred_found = True
            break

    if not cred_found:
        cred_found = os.path.exists(CRED_PATH)

    if not cred_found:
        die(
            f".credentials.json not created within {POLL_TIMEOUT} s — "
            "the authorization code may be invalid or expired."
        )

    # ── Step 6: Exit the claude REPL ───────────────────────────────────────
    log("credentials found — sending /exit")
    try:
        child.sendline("/exit")
        child.expect(pexpect.EOF, timeout=15)
    except Exception as exc:
        log(f"note: /exit or EOF raised {exc} (credentials already saved — ignoring)")

    print("DONE", flush=True)

except pexpect.EOF:
    if os.path.exists(CRED_PATH):
        log("EOF received but .credentials.json exists — treating as success")
        print("DONE", flush=True)
    else:
        die("claude exited unexpectedly before authentication completed")
except pexpect.TIMEOUT:
    die("unexpected timeout")
except Exception as exc:
    die(str(exc))
