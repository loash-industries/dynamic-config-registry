<!-- managed by cortex-config -->
# GitHub Copilot Instructions for dynamic-config-registry

## Project Context

dynamic-config-registry is a static registry of Sui coin types. Coins are authored one file per coin under `coins/`, validated against a JSON Schema plus Sui-specific semantic checks, merged into a single JSON artifact, and published to a CDN (Hetzner Object Storage). There is no running service — it is a build-and-publish data pipeline whose source of truth is version-controlled JSON.

- **Language**: TypeScript (ES2022 modules), run directly via `tsx` (no build step for tooling)
- **Runtime**: Node.js >= 20
- **Validation**: `ajv` (draft-07) + `ajv-formats`, plus hand-rolled Sui parsing in `src/sui.ts`
- **Testing**: `vitest`
- **Distribution**: Hetzner Object Storage (S3-compatible), published manually via `scripts/push.sh`

## Core Architectural Principles

- **One file per coin**: each coin is a standalone `coins/<symbol>.json`, keeping diffs and review scoped to a single coin.
- **Validate before anything leaves**: `validateAll` layers schema checks, Sui semantic checks (address / coin-type parsing), and cross-file invariants (no duplicate `coin_type`, no duplicate treasury address within a coin). `build` refuses to run if validation fails.
- **Canonical, stable output**: coins are normalized (addresses expanded to `0x` + 64 hex) and sorted by `coin_type` so published output is deterministic and diff-friendly.
- **Idempotency**: the upsert CLI is keyed by canonical `coin_type`, merges over existing entries, and rolls back on validation failure — re-running the same command is a no-op.
- **No SDK bloat in CI**: Sui address/coin-type handling is a few in-repo regexes rather than the full `@mysten/sui` SDK.

## Key Modules

| File | Purpose |
|------|---------|
| `src/sui.ts` | Sui address / coin-type parsing + normalization |
| `src/registry.ts` | Load, validate (`validateAll`, `validateCoin`), canonicalize (`normalizeCoin`) |
| `src/validate.ts` | `npm run validate` entrypoint |
| `src/upsert.ts` | `npm run upsert` entrypoint — idempotent create/update from CLI args |
| `src/build.ts` | `npm run build` entrypoint — writes `dist/registry*.json` |
| `schema/coin.schema.json` | JSON Schema for a single coin entry |
| `scripts/push.sh` | Build + publish `dist/` to the object store (local + manual CI) |

## Data Contract

Required coin fields: `chain_id` (CAIP-2, `sui:` namespace), `coin_type` (`0x<address>::<module>::<STRUCT>`), `symbol`, `name`, `decimals` (0–255). Optional: `icon_url`, `description`, `project_url`, `tags`, `treasury_addresses[]` (`{ address, type, label? }`). Unknown properties are rejected (`additionalProperties: false`).

## Code Style

- **Modules**: ES modules; import local files with the `.js` extension (e.g. `from "./sui.js"`) even though sources are `.ts`.
- **Strictness**: `tsc` runs with `strict` and `noUncheckedIndexedAccess`; handle `undefined` from indexed access explicitly.
- **Errors**: throw `Error` with a specific message that names the offending file/field; validation collects messages rather than throwing on the first failure.
- **Output formatting**: write coin JSON with 2-space indent and a trailing newline; keep keys in schema order for stable diffs.

## Build Commands

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run validate    # validate every coins/*.json
npm test            # vitest
npm run upsert -- --coin-type 0x…::mod::SYM --symbol SYM --name "…" --decimals 9 ...
npm run build       # write dist/registry*.json
scripts/push.sh --dry-run   # build + show what would publish
```

## Cortex Workflow

Before writing code: call `getConventions(scope: "general")` and `search_context(service_id: "dynamic-config-registry")`.
Before committing: call `chronicle_changes(service_id: "dynamic-config-registry", ...)` and prepend the result to `.cortex/changelog.md`.
