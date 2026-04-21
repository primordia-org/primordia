# Add instance identity and social graph

## What changed

- **Instance identity** — each Primordia instance now has a fixed UUID v7 (generated once on first boot and stored in SQLite), plus an editable `name` and `description`.
- **`/.well-known/primordia.json`** — new endpoint (served via a Next.js rewrite from `/api/instance/primordia-json`) that returns a structured JSON document describing this instance and its known peer network:
  - `$schema`, `canonical_url`, `name`, `description`, `source` (git URL), `uuid7`
  - `nodes[]` — self + all registered peer instances
  - `edges[]` — directed relationships (type `fork`) between instances
  - `meta.generated_at` — ISO timestamp
- **`POST /api/instance/register`** — public endpoint for child instances to register themselves; validates UUID v7 format + URL; creates/updates a graph node and inserts a `fork` edge from self → child.
- **`GET /PATCH /api/instance/config`** — admin-only endpoint to read and update instance name/description.
- **Admin panel `/admin/instance`** — new tab in the admin subnav; shows the UUID v7 (read-only), editable name/description fields, a list of known peer nodes, a table of graph edges, and copy-paste instructions for registering a child instance.
- **`lib/uuid7.ts`** — thin re-export of `uuid.v7()` from the `uuid` npm package (replaces the earlier homebrew implementation).
- **`/schemas/instance/v1.json`** — serves the canonical JSON Schema (draft 2020-12) for the instance manifest; includes `uuid7` as a required top-level field alongside `$schema` and `canonical_url`; `$id` is `https://primordia.app/schemas/instance/v1.json`.
- **`PRIMORDIA_CANONICAL_URL`** env var — optional; used as the base URL in the well-known JSON; falls back to deriving from request headers if unset.
- `$schema` URL updated to `https://primordia.app/schemas/instance/v1.json` throughout.
- **DB tables** — `instance_config` (key/value), `graph_nodes`, `graph_edges` added to the SQLite schema with idempotent `CREATE TABLE IF NOT EXISTS` migrations.

## Why

Primordia instances need a stable identity and a way to discover each other to form a decentralised social network graph. This lays the foundation: each instance self-describes at a well-known URL, and instances can announce themselves to peers via the register endpoint.
