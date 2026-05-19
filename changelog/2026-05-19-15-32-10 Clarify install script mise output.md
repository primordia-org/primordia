# Clarify install script mise output

Updated the installer's success messages so the mise version line is explicit (`Using mise ...` / `Installed mise ...`) instead of printing an unlabeled version string. This makes the install summary clearer when it appears between git hooks and bash mise integration.

Also aligned related installer messages with the established wording pattern: `Using ...` for unchanged existing setup and `Installed ...` for setup that was installed or modified.
