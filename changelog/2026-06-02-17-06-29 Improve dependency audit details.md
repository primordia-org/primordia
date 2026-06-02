# Improve dependency audit details

Updated the admin Dependencies page to make audit results easier to scan:

- Renamed the parsed findings section from “Structured findings” to “Parsed vulnerability findings”.
- Moved the raw `bun audit` response into a collapsed `<details>` section at the bottom of the page.
- Pretty-printed JSON audit output with two-space indentation so the raw data remains inspectable without dominating the page.
