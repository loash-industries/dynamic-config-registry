## 2026-07-22 — cortex onboarding

Onboarded dynamic-config-registry to Cortex. Added `.cortex/manifest.yaml`
(TypeScript, platform team, no framework), `.cortex/overview.md` (Sui coin
registry — authoring, validation, idempotent upsert CLI, build, and manual
publish pipeline), `CLAUDE.md`, `.github/copilot-instructions.md`, and
`.vscode/mcp.json`. Added a `cortex-ingest` workflow gated on pushes to `main`
that touch `.cortex/**`.
