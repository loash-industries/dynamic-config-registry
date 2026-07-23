# Sui Coin Registry

A static registry of [Sui](https://sui.io) coin types. Coins are stored one file
per coin, validated against a JSON Schema (plus Sui-specific semantic checks),
merged into a single JSON file, and published to a CDN (Hetzner Object Storage).

> **Publishing is manual/local today, not automated on merge.** CI validates and
> builds every change to `main`, but the actual push to the CDN is run by a
> maintainer from their machine. See [Publishing](#publishing-current-state) for
> the how and the why.

## Published artifacts

Publishing uploads the following to the object store:

| File                  | Description                                  |
| --------------------- | -------------------------------------------- |
| `registry.json`       | Pretty-printed array of all coins            |
| `registry.min.json`   | Minified array (for clients)                 |
| `registry.meta.json`  | `{ count, generated_at, schema }`            |

## Adding or editing a coin

1. Create/edit `coins/<symbol>.json`. See [`coins/cred.json`](coins/cred.json)
   for a complete example and [`schema/coin.schema.json`](schema/coin.schema.json)
   for the full contract.
2. Run `npm run validate` locally.
3. Open a PR. CI validates every coin; nothing merges unless validation passes.

Prefer not to hand-edit JSON? Use the upsert CLI (below), which writes the file
for you and validates before committing the change.

### Upserting a coin from the CLI

`npm run upsert` idempotently creates or updates a single `coins/*.json` from
arguments. A coin's identity is its **canonical `coin_type`** (address expanded
to 64 hex chars): upsert finds any existing coin with the same canonical type —
whatever file it lives in — and updates it in place, otherwise it creates
`coins/<symbol>.json`. Fields you pass overwrite; fields you omit are preserved.
Re-running the same command is a no-op (`= … unchanged`). The result is validated
with the full ruleset (schema + Sui semantics + cross-file invariants) **before**
the write is committed; a failure rolls the file back, so the tree is never left
broken.

```bash
# Create (or fully specify) a coin:
npm run upsert -- \
  --chain-id sui:mainnet \
  --coin-type 0x2::cred::CRED \
  --symbol CRED --name "Credits" --decimals 9 \
  --icon-url https://assets.example.com/coins/cred.png \
  --tag defi --tags governance \
  --treasury '0x1111:treasury:Protocol treasury' \
  --treasury '{"address":"0x2222","type":"vesting","label":"Team vesting"}'

# Partial update — change only what you pass (matched by coin_type):
npm run upsert -- --coin-type 0x2::cred::CRED --decimals 6

npm run upsert -- --coin-type 0x2::cred::CRED --dry-run   # preview, no write
npm run upsert -- --help                                  # full option list
```

Only `--coin-type` is always required. Creating a new coin also needs the other
required fields (`--chain-id`, `--symbol`, `--name`, `--decimals`); validation
reports any that are missing. Repeatable/set options: `--tag` (repeat) and
`--tags a,b`; `--treasury` (repeat) as `address:type[:label]` or JSON. Clear a
set with `--clear-tags` / `--clear-treasury`. Override the target filename with
`--file`.

### Coin shape

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

Required: `chain_id`, `coin_type`, `symbol`, `name`, `decimals`. Optional:
`icon_url`, `description`, `project_url`, `tags`, `treasury_addresses`.

**Validation rules enforced:**

- `chain_id` is a [CAIP-2](https://chainagnostic.org/CAIPs/caip-2) chain
  identifier restricted to the Sui namespace, e.g. `sui:mainnet`,
  `sui:testnet`, `sui:devnet`.
- `coin_type` must be a well-formed `0x<address>::<module>::<STRUCT>` — the
  address, module, and struct name are all parsed and checked.
- Addresses (coin type + treasury) must be valid Sui addresses; they are
  normalized to canonical `0x` + 64-hex form in the published output.
- `decimals` is an integer in `0..255` (Sui stores decimals as a `u8`).
- `treasury_addresses[].type` is one of a fixed enum (`treasury`, `vesting`,
  `team`, `community`, `liquidity`, `staking`, `ecosystem`, `burn`, `other`).
- No duplicate `coin_type` across files; no duplicate treasury address within a
  coin. Unknown properties are rejected (`additionalProperties: false`).

## Local development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run validate    # validate every coins/*.json
npm test            # unit tests (vitest)
npm run build       # write dist/registry*.json
```

## Publishing (current state)

**What is automated:** [`ci.yml`](.github/workflows/ci.yml) validates, tests, and
builds the registry on every PR and every merge to `main`, uploading `dist/` as a
CI artifact. `main` is therefore always known-good and buildable.

**What is manual:** the push to the CDN. A maintainer publishes from their machine:

```bash
export S3_BUCKET=coin-registry
export S3_ENDPOINT=https://fsn1.your-objectstorage.com
export AWS_PROFILE=hetz          # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

scripts/push.sh --dry-run        # build + show what would upload
scripts/push.sh                  # build + upload for real
```

See the cortex skill [`platform/push-coin-registry`](../../triex/cortex/cortex-config/skills/platform/push-coin-registry.md)
for the full local procedure. [`deploy.yml`](.github/workflows/deploy.yml) exists
only as a **manual** `workflow_dispatch` escape hatch that reuses `scripts/push.sh`;
it does not run on merge.

### Why publishing isn't wired into CI/CD yet

The end state we want is a **Temporal-orchestrated publish job** — durable
retries, scheduling, an audit trail, and cache invalidation — rather than a raw
`aws s3 cp` from a CI runner. Standing that up means running a Temporal worker and
the always-on infrastructure behind it, which carries a recurring cost we are
**not ready to take on yet**. Until that migration is funded, publishing stays
manual/local. Keeping the long-lived S3 keys off automated CI in the meantime
also keeps their blast radius small. When the Temporal job lands, `deploy.yml`
and `scripts/push.sh`'s upload path are retired.

### Credentials

For **local** pushes, use an `aws` profile (e.g. `hetz`) scoped to just the
registry bucket. For the **manual CI** dispatch, configure these in the repo's
`production` environment (Settings → Environments):

| Kind     | Name                    | Example                                   |
| -------- | ----------------------- | ----------------------------------------- |
| Secret   | `HETZNER_S3_ACCESS_KEY` | —                                         |
| Secret   | `HETZNER_S3_SECRET_KEY` | —                                         |
| Variable | `HETZNER_S3_ENDPOINT`   | `https://fsn1.your-objectstorage.com`     |
| Variable | `HETZNER_S3_REGION`     | `fsn1`                                     |
| Variable | `HETZNER_S3_BUCKET`     | `coin-registry`                           |

Objects are uploaded with `Cache-Control: public, max-age=60` and
`--acl public-read`. Adjust the cache TTL in `scripts/push.sh` to taste.

## Layout

```
coins/                  # one JSON file per coin (source of truth)
schema/coin.schema.json # JSON Schema for a single coin
src/sui.ts              # Sui address / coin-type parsing + normalization
src/registry.ts         # load + validate all coins
src/validate.ts         # `npm run validate` entrypoint
src/upsert.ts           # `npm run upsert` -> idempotently create/update a coin
src/build.ts            # `npm run build` -> dist/
scripts/push.sh         # build + publish to the object store (local + manual CI)
test/                   # vitest suites
.github/workflows/      # ci.yml (validate/build) + deploy.yml (manual publish)
```
