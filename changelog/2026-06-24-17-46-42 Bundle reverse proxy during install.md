# Bundle reverse proxy during install

The install script now runs Bun's bundler on `scripts/reverse-proxy.ts` and installs the generated `reverse-proxy.js` runtime file. The systemd unit and local startup guidance were updated to launch the bundled file.

This prepares the reverse proxy for future refactors while keeping deployment behavior consistent.
