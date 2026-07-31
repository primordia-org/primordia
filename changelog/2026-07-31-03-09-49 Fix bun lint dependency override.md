# Fix bun lint dependency override

Removed the global `brace-expansion` package override that forced every transitive consumer to use the latest CommonJS wrapper shape. Older `minimatch` versions bundled under ESLint expect `require("brace-expansion")` to return a function, so the forced v5 override made `bun run lint` crash before linting any files.

After reinstalling dependencies, Bun now keeps modern `brace-expansion` for modern `minimatch` while installing a compatible 1.x copy beneath ESLint's legacy `minimatch` users, allowing `bun run lint` to execute normally again.
