# Add systemd service for production deployment

## What changed

Added two new scripts to manage Primordia as a proper Linux service:

- `scripts/primordia.service` — systemd unit file, symlinked into `/etc/systemd/system/`
- `scripts/install-service.sh` — one-shot installer: symlinks the unit file, enables it on
  boot, kills any legacy nohup process, and (re)starts the service

Updated `scripts/deploy-to-exe-dev.sh` to call `install-service.sh` instead of the old
`nohup` + PID file approach, and to use `journalctl` for readiness checks and log tailing.

## Why

The previous deploy script ran the server via `nohup` with a hand-rolled PID file. This meant
the server would not restart after a crash or VM reboot, and there was no standard way to
manage it. Systemd handles all of that automatically.

## How

- The service file lives in the repo (not hand-crafted on the server) so it's version-controlled
  and consistent across deploys.
- A symlink from `/etc/systemd/system/primordia.service` points into the repo, so updating the
  unit file just requires a `systemctl daemon-reload`.
- `install-service.sh` is idempotent — safe to run on every deploy.

**Useful commands:**
```bash
sudo systemctl restart primordia   # restart
sudo systemctl status primordia    # check status
journalctl -u primordia -f         # tail logs
```
