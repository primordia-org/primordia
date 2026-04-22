# Add instance identity and social graph

## What changed

- **Instance identity** — each Primordia instance now has a fixed UUID v7 (generated once on first boot and stored in SQLite), plus an editable `name` and `description`.
- **`/.well-known/primordia.json`** — new endpoint (served via a Next.js rewrite from `/api/instance/primordia-json`) that returns a structured JSON document describing this instance and its known peer network:
  - `$schema`, `canonical_url`, `name`, `description`, `source` (git URL), `uuid7`
  - `nodes[]` — self + all registered peer instances
  - `edges[]` — directed relationships (type `child_of`: child → parent) between instances
  - `meta.generated_at` — ISO timestamp
- **`POST /api/instance/register`** — public endpoint for child instances to register themselves; validates UUID v7 format + URL; creates/updates a graph node and inserts a `child_of` edge (child → parent, i.e. `from` = child uuid7, `to` = this instance's uuid7).
- **`GET /PATCH /api/instance/config`** — admin-only endpoint to read and update instance name/description.
- **Admin panel `/admin/instance`** — new tab in the admin subnav; shows the UUID v7 (read-only), editable name/description fields, a list of known peer nodes, a table of graph edges, and copy-paste instructions for registering a child instance.
- **`lib/uuid7.ts`** — thin re-export of `uuid.v7()` from the `uuid` npm package (replaces the earlier homebrew implementation).
- **`/schemas/instance/v1.json`** — serves the canonical JSON Schema (draft 2020-12) for the instance manifest; includes `uuid7` as a required top-level field alongside `$schema` and `canonical_url`; `$id` is `https://primordia.app/schemas/instance/v1.json`.
- **Canonical URL and parent instance URL are stored in the database** and edited from the admin panel at `/admin/instance` — no environment variables needed. The well-known JSON uses the DB value, falling back to the request's host header if unset.
- **`lib/register-with-parent.ts`** — shared helper that POSTs this instance's identity to the parent's `/api/instance/register` endpoint. Called by the config PATCH route whenever settings are saved and `parentUrl` is set. `canonicalUrl` is included if available but is not required — the stable UUID v7 is the primary identity. This means registration happens once on first setup (when the admin fills in those fields) and again automatically whenever name or description is updated.
- `$schema` URL updated to `https://primordia.app/schemas/instance/v1.json` throughout.
- Edge type simplified: only `child_of` is documented as a known type (speculative types removed from schema).
- No environment variables are needed for instance identity; the admin panel manages everything.
- **DB tables** — `instance_config` (key/value), `graph_nodes`, `graph_edges` added to the SQLite schema with idempotent `CREATE TABLE IF NOT EXISTS` migrations.

## Why

Primordia instances need a stable identity and a way to discover each other to form a decentralised social network graph. This lays the foundation: each instance self-describes at a well-known URL, and instances can announce themselves to peers via the register endpoint.
