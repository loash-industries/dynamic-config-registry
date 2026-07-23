import { validateAll } from "./registry.js";

function main(): void {
  const { coins, errors } = validateAll();

  if (errors.length > 0) {
    console.error(`✗ Validation failed with ${errors.length} error(s):\n`);
    for (const e of errors) {
      console.error(`  ${e.file}: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`✓ Validated ${coins.length} coin(s) — no errors.`);
}

main();
