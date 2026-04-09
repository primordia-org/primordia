# Fix Bad Gateway em dash rendering

## What changed

Replaced the Unicode em dash (`—`) in the "Bad Gateway" error message with a regular hyphen-minus (`-`) in `scripts/reverse-proxy.ts`.

**Before:** `Bad Gateway — upstream server unavailable`
**After:** `Bad Gateway - upstream server unavailable`

## Why

The em dash character (U+2014) can render as a garbled character sequence (e.g. `â€"`) in browsers or terminals that assume Latin-1/ISO-8859-1 encoding instead of UTF-8. The response is sent as `text/plain` with no explicit `charset=utf-8` declaration, so some clients default to a legacy encoding and misinterpret the multi-byte UTF-8 sequence. Using a plain ASCII hyphen avoids the ambiguity entirely.
