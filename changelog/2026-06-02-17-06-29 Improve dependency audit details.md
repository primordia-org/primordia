# Improve dependency audit details

Updated the admin Dependencies page to make audit results easier to scan:

- Renamed the parsed findings section from “Structured findings” to “Current Vulnerabilities”.
- Moved the raw `bun audit` response into a collapsed `<details>` section at the bottom of the page.
- Pretty-printed JSON audit output with two-space indentation so the raw data remains inspectable without dominating the page.
- Constrained the raw output panel so wide audit JSON scrolls horizontally instead of stretching the page.
- Made finding IDs/advisory URLs link directly to their advisory and removed the duplicate trailing URL line from each finding.
- Clarified non-severe status summaries so moderate findings are called “moderate” instead of “lower-severity”.
