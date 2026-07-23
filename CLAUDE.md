# CLAUDE.md
<!-- managed by cortex-config -->

**MCP Server:** `https://cortex-relay-dev-api.trinary.exchange/mcp`

## Before writing any code

1. Call `getConventions` with `scope: "general"`.
2. Call `search_context` with your task description and `service_id: "dynamic-config-registry"`.

## Before every commit

3. Call `chronicle_changes` with `service_id: "dynamic-config-registry"`, a summary of what changed, and the list of changed files.
   Prepend the returned `changelog_entry` to `.cortex/changelog.md`.
   If `update_overview` is true, replace `.cortex/overview.md` with `overview_patch`.
   Commit these alongside your code changes.

## Build & test commands

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run validate    # validate every coins/*.json
npm test            # unit tests (vitest)
npm run upsert -- --coin-type 0x…::mod::SYM ...   # idempotently create/update a coin
npm run build       # write dist/registry*.json
scripts/push.sh --dry-run   # build + show what would publish (manual/local)
```
