# dynamic-config-registry

A static registry of [Sui](https://sui.io) coin types. Coins are authored one
file per coin, validated against a JSON Schema plus Sui-specific semantic checks,
merged into a single JSON artifact, and published to a CDN (Hetzner Object
Storage) for clients to consume. There is no running service — this is a
build-and-publish data pipeline whose source of truth is version-controlled JSON.

## Core Capabilities

**Coin authoring** — Each coin lives in its own `coins/<symbol>.json` file
(required: `chain_id`, `coin_type`, `symbol`, `name`, `decimals`; optional:
`icon_url`, `description`, `project_url`, `tags`, `treasury_addresses`). One file
per coin keeps diffs and review scoped to a single coin.

**Validation** — `npm run validate` checks every coin against
`schema/coin.schema.json` (shape) and layers Sui-specific semantic checks on top:
CAIP-2 `chain_id` restricted to the `sui:` namespace, well-formed
`0x<address>::<module>::<STRUCT>` coin types, valid Sui addresses, `decimals` in
a `u8` range, and cross-file invariants (no duplicate `coin_type`, no duplicate
treasury address within a coin). CI runs this on every PR; nothing merges unless
it passes.

**Idempotent upsert CLI** — `npm run upsert` creates or updates a single coin
from CLI arguments, keyed by the canonical `coin_type`. It merges provided fields
over any existing entry, writes stable schema-ordered JSON, and validates the
whole registry before committing the write (rolling the file back on failure), so
re-running the same command is a no-op.

**Build** — `npm run build` canonicalizes and sorts all coins, then writes
`dist/registry.json` (pretty), `dist/registry.min.json` (minified, for clients),
and `dist/registry.meta.json` (`{ count, generated_at, schema }`).

**Publish** — `scripts/push.sh` builds and uploads the `dist/` artifacts to the
object store. Publishing is currently **manual/local** by a maintainer; CI
validates and builds every merge but does not auto-push.

## Architecture

- **Language**: TypeScript (ES2022 modules), run directly via `tsx` — no build
  step for the tooling itself
- **Runtime**: Node.js >= 20
- **Validation**: `ajv` (draft-07) + `ajv-formats`, plus hand-rolled Sui address
  and coin-type parsing in `src/sui.ts` (avoids pulling the full `@mysten/sui`
  SDK into CI)
- **Testing**: `vitest`
- **Source of truth**: the `coins/*.json` files, committed to git
- **Distribution**: Hetzner Object Storage (S3-compatible), objects served with
  `Cache-Control: public, max-age=60`, `--acl public-read`

## Key Modules

| File | Purpose |
|------|---------|
| `src/sui.ts` | Sui address / coin-type parsing + normalization (canonical `0x` + 64-hex form) |
| `src/registry.ts` | Load, validate (`validateAll`, `validateCoin`), and canonicalize (`normalizeCoin`) coins |
| `src/validate.ts` | `npm run validate` entrypoint — validate every `coins/*.json` |
| `src/upsert.ts` | `npm run upsert` entrypoint — idempotently create/update one coin from CLI args |
| `src/build.ts` | `npm run build` entrypoint — write `dist/registry*.json` |
| `schema/coin.schema.json` | JSON Schema for a single coin entry |
| `scripts/push.sh` | Build + publish `dist/` to the object store (local + manual CI dispatch) |

## Data Contract

A coin entry (see `coins/cred.json` for a complete example):

```json
{
  "chain_id": "sui:mainnet",
  "coin_type": "0x…::cred::CRED",
  "symbol": "CRED",
  "name": "Credits",
  "decimals": 9,
  "icon_url": "https://…",
  "treasury_addresses": [
    { "address": "0x…", "label": "Protocol treasury", "type": "treasury" }
  ]
}
```

Published artifacts uploaded to the object store:

| File | Description |
|------|-------------|
| `registry.json` | Pretty-printed array of all coins |
| `registry.min.json` | Minified array (for clients) |
| `registry.meta.json` | `{ count, generated_at, schema }` |

## CI/CD

- `.github/workflows/ci.yml` — on every PR and push to `main`: typecheck,
  validate, test, build; uploads `dist/` as a CI artifact so `main` is always
  known-good and buildable.
- `.github/workflows/deploy.yml` — **manual** `workflow_dispatch` escape hatch
  that reuses `scripts/push.sh`; it does not run on merge.
- `.github/workflows/cortex-ingest.yml` — re-ingests `.cortex/**` into the Cortex
  knowledge graph on pushes to `main`.

## Roadmap

The intended end state for publishing is a **Temporal-orchestrated publish job**
(durable retries, scheduling, audit trail, cache invalidation) rather than a raw
`aws s3 cp` from a CI runner. Until that infrastructure is funded, publishing
stays manual/local and long-lived S3 keys are kept off automated CI to keep their
blast radius small.
