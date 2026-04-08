# Fix proxy-upstream.json corrupted by systemd `%s` specifier

## What changed

`scripts/primordia.service` — changed `%s` to `%%s` in the `ExecStartPre` printf format string.

## Why

In systemd unit files, `%s` is a built-in specifier that expands to the shell of the service user (e.g. `/usr/bin/bash`). This expansion happens before the quoted argument is passed to bash, so the `printf` format string:

```
printf "{\"port\":%s}\\n" "${PORT:-3001}"
```

was being rewritten by systemd to:

```
printf "{\"port\":/usr/bin/bash}\\n" "${PORT:-3001}"
```

causing `proxy-upstream.json` to contain `{port:/usr/bin/bash}` instead of valid JSON like `{"port":3001}`. The reverse proxy (`scripts/reverse-proxy.ts`) then failed to parse the file and silently kept its default port, breaking traffic routing after a service restart.

## Fix

Escaping the percent sign as `%%s` causes systemd to emit a literal `%s` after specifier processing, so `printf` receives the correct format string and writes valid JSON.
