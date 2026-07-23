import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DIST_DIR, normalizeCoin, validateAll } from "./registry.js";

function main(): void {
  const { coins, errors } = validateAll();

  if (errors.length > 0) {
    console.error(`✗ Refusing to build — ${errors.length} validation error(s):\n`);
    for (const e of errors) {
      console.error(`  ${e.file}: ${e.message}`);
    }
    process.exit(1);
  }

  // Canonicalize and sort by coin_type for stable, diff-friendly output.
  const registry = coins
    .map(({ coin }) => normalizeCoin(coin))
    .sort((a, b) => a.coin_type.localeCompare(b.coin_type));

  mkdirSync(DIST_DIR, { recursive: true });

  const pretty = `${JSON.stringify(registry, null, 2)}\n`;
  writeFileSync(join(DIST_DIR, "registry.json"), pretty);
  writeFileSync(join(DIST_DIR, "registry.min.json"), JSON.stringify(registry));

  const meta = {
    count: registry.length,
    generated_at: new Date().toISOString(),
    schema: "coin.schema.json",
  };
  writeFileSync(join(DIST_DIR, "registry.meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

  console.log(`✓ Built dist/registry.json with ${registry.length} coin(s).`);
}

main();
