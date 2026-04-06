# Fix git clone protocol error by forwarding Content-Encoding

## What changed

Added `HTTP_CONTENT_ENCODING` to the CGI environment variables forwarded to `git http-backend` in `app/api/git/[...path]/route.ts`.

## Why

Git protocol v2 clients (git ≥ 2.26) send the `POST /git-upload-pack` request body **gzip-compressed** when it exceeds ~100 bytes, and signal this with a `Content-Encoding: gzip` request header.

The `git http-backend` CGI program learns about content encoding via the `HTTP_CONTENT_ENCODING` environment variable. Without it, http-backend forwarded the raw gzip bytes directly to the `git-upload-pack` subprocess. git-upload-pack tried to interpret the gzip magic bytes (`\x1f\x8b`) as pkt-line hex digits, immediately failed with:

```
fatal: protocol error: bad line length character: <0x1f><0x8b>
```

…and the clone client received an incomplete HTTP response, producing:

```
fatal: expected 'packfile'
```

Setting `HTTP_CONTENT_ENCODING` tells git http-backend to decompress the request body before handing it off to git-upload-pack, restoring correct clone behaviour.
