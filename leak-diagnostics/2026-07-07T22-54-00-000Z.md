# Primordia CPU / memory leak diagnostics

Captured at: 2026-07-07T22:54:00.000Z

Reason: example report for UI testing; memory 94% used (threshold 90%); load average 3.04 on 2 CPU(s); Primordia processes using 184.5% CPU across 2 CPU(s)

Summary:
- Load average: 3.04 3.00 3.02 on 2 CPU(s)
- Memory: 94% used, 476 MB available of 7,936 MB
- Primordia CPU total: 184.5%
- Top Primordia process: 1404868 101.0 91.9 7479296 node /home/exedev/primordia/worktrees/example/node_modules/.bin/next start

## System

```
Linux primordia-example 6.1.0 #1 SMP x86_64 GNU/Linux
```

## Uptime

```
 22:54:00 up 12 days, 6:00,  1 user,  load average: 3.04, 3.00, 3.02
```

## Memory (/proc/meminfo)

```
MemTotal:        8126464 kB
MemFree:          120000 kB
MemAvailable:     487424 kB
Buffers:            8120 kB
Cached:           422000 kB
SwapCached:            0 kB
Active:          6950000 kB
Inactive:         510000 kB
SwapTotal:             0 kB
SwapFree:              0 kB
```

## Top processes by CPU

```
    PID    PPID USER     STAT %CPU %MEM     RSS      VSZ     ELAPSED     TIME COMMAND
1404868 1403998 exedev   R    101.0 91.9 7479296 82837504 6-21:19:00 4-08:25:00 node /home/exedev/primordia/worktrees/example/node_modules/.bin/next start
1404000 1403998 exedev   R     83.5 91.9 7479296 82837504 6-21:19:00 6-21:19:00 node /home/exedev/primordia/worktrees/example/node_modules/.bin/next start
1149988       1 exedev   S      0.0  1.6  128000 74000000 1-01:00:00 01:03:33 /home/exedev/.local/share/mise/installs/bun/1.3.14/bin/bun /home/exedev/primordia/reverse-proxy.js
```

## Top processes by memory

```
    PID    PPID USER     STAT %CPU %MEM     RSS      VSZ     ELAPSED     TIME COMMAND
1404868 1403998 exedev   R    101.0 91.9 7479296 82837504 6-21:19:00 4-08:25:00 node /home/exedev/primordia/worktrees/example/node_modules/.bin/next start
1404000 1403998 exedev   R     83.5 91.9 7479296 82837504 6-21:19:00 6-21:19:00 node /home/exedev/primordia/worktrees/example/node_modules/.bin/next start
1278325 1278324 exedev   S      0.0  2.0  164864 75392614 1-02:00:00 00:27:56 node /home/exedev/primordia/worktrees/preview/node_modules/.bin/next start
```

## Primordia process manager status

```json
{
  "productionBranch": "example",
  "reverseProxy": { "running": true, "pid": 1149988 },
  "servers": [
    { "branch": "example", "pid": 1404000, "status": "running", "port": 3001, "mode": "prod" },
    { "branch": "preview", "pid": 1278325, "status": "running", "port": 3002, "mode": "prod" }
  ],
  "agents": []
}
```

## Git worktrees

```
worktree /home/exedev/primordia/worktrees/example
HEAD deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
branch refs/heads/example

worktree /home/exedev/primordia/worktrees/preview
HEAD feedfacefeedfacefeedfacefeedfacefeedface
branch refs/heads/preview
```
