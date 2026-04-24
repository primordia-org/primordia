# Replace one-command installer with two-step landing page instructions

Deleted `scripts/install-for-exe-dev.sh` and its serving route `app/install-for-exe-dev.sh/route.ts`. The old script handled a lot of unhappy-path edge cases (SSH polling, JSON parsing, spinner state) that made it hard to maintain.

The landing page now shows two simple happy-path commands:

```
$ ssh exe.dev new --name=primordia
$ ssh primordia.exe.xyz bash <(curl -fsSL .../setup.sh)
```

The first creates the VM, the second downloads and runs `scripts/primordia_setup.sh` (served at `/setup.sh`) directly on it. Users can substitute any VM name they like. Error handling is left to the user's shell and the existing `setup.sh` / `install.sh` scripts.
