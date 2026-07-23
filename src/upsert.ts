/**
 * Idempotently upsert a single coin into the registry from CLI arguments.
 *
 * A coin's identity is its canonical `coin_type` (address expanded to 64 hex
 * chars). Upsert locates an existing coin by that canonical form — regardless
 * of which file it lives in — and updates it in place; if none exists it creates
 * a new `coins/<symbol>.json`. Fields you pass overwrite; fields you omit are
 * preserved from the existing coin (or absent, for a new one). Re-running the
 * same command therefore produces byte-identical output and reports "unchanged".
 *
 * The result is validated with the repo's full ruleset (schema + Sui semantics +
 * cross-file invariants) BEFORE the write is committed; a validation failure
 * rolls the file back so the working tree is never left in a broken state.
 *
 * Usage:
 *   npm run upsert -- \
 *     --chain-id sui:mainnet \
 *     --coin-type 0x2::cred::CRED \
 *     --symbol CRED --name "Credits" --decimals 9 \
 *     [--icon-url URL] [--description TEXT] [--project-url URL] \
 *     [--tag defi --tag governance] [--tags defi,governance] \
 *     [--treasury 0xabc:treasury:"Protocol treasury"] [--treasury '{"address":"0x..","type":"vesting"}'] \
 *     [--clear-tags] [--clear-treasury] \
 *     [--file coins/cred.json] [--dry-run]
 *
 * Only `--coin-type` is strictly required (it identifies the coin). Creating a
 * brand-new coin additionally requires the other schema-required fields
 * (chain_id, symbol, name, decimals) — validation will tell you if any are missing.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  COINS_DIR,
  ROOT,
  type Coin,
  type TreasuryAddress,
  loadCoinFiles,
  validateAll,
} from "./registry.js";
import { normalizeCoinType } from "./sui.js";

interface Args {
  flags: Record<string, string>;
  /** Repeatable options collected into arrays. */
  tags: string[];
  treasuries: string[];
  bools: Set<string>;
}

const REPEATABLE = new Set(["tag", "treasury"]);
const BOOLEANS = new Set(["dry-run", "clear-tags", "clear-treasury", "help"]);

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string> = {};
  const tags: string[] = [];
  const treasuries: string[] = [];
  const bools = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${JSON.stringify(token)} (options must start with --)`);
    }
    let key = token.slice(2);
    let value: string | undefined;
    const eq = key.indexOf("=");
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }

    if (BOOLEANS.has(key)) {
      bools.add(key);
      continue;
    }

    if (value === undefined) {
      value = argv[++i];
      if (value === undefined) throw new Error(`option --${key} expects a value`);
    }

    if (key === "tag") tags.push(value);
    else if (key === "treasury") treasuries.push(value);
    else if (REPEATABLE.has(key)) throw new Error(`internal: unhandled repeatable --${key}`);
    else flags[key] = value;
  }

  return { flags, tags, treasuries, bools };
}

/** Parse one `--treasury` value: either JSON, or `address:type[:label]`. */
function parseTreasury(spec: string): TreasuryAddress {
  const trimmed = spec.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`--treasury is not valid JSON: ${(err as Error).message}`);
    }
    const t = parsed as Partial<TreasuryAddress>;
    if (!t.address || !t.type) {
      throw new Error(`--treasury JSON must include "address" and "type": ${spec}`);
    }
    const out: TreasuryAddress = { address: t.address, type: t.type };
    if (t.label !== undefined) out.label = t.label;
    return out;
  }

  const first = trimmed.indexOf(":");
  if (first === -1) {
    throw new Error(`--treasury must be "address:type[:label]" or JSON, got: ${spec}`);
  }
  const address = trimmed.slice(0, first);
  const rest = trimmed.slice(first + 1);
  const second = rest.indexOf(":");
  const type = second === -1 ? rest : rest.slice(0, second);
  const label = second === -1 ? undefined : rest.slice(second + 1);

  if (!address || !type) {
    throw new Error(`--treasury must be "address:type[:label]" or JSON, got: ${spec}`);
  }
  const out: TreasuryAddress = { address, type };
  if (label) out.label = label;
  return out;
}

/** Turn a symbol into a safe, lowercase file slug (e.g. "CRED" -> "cred"). */
function slugForSymbol(symbol: string): string {
  const slug = symbol
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "coin";
}

/** Serialize a coin with a stable, schema-ordered key layout. */
function serialize(coin: Coin): string {
  const ordered: Record<string, unknown> = {};
  const order: (keyof Coin)[] = [
    "chain_id",
    "coin_type",
    "symbol",
    "name",
    "decimals",
    "icon_url",
    "description",
    "project_url",
    "tags",
    "treasury_addresses",
  ];
  for (const key of order) {
    if (coin[key] !== undefined) ordered[key] = coin[key];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function usage(): string {
  // Print the module header comment (the block between the first /** and */).
  const src = readFileSync(new URL(import.meta.url), "utf8");
  const match = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return "See src/upsert.ts for usage.";
  return match[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, ""))
    .join("\n")
    .trim();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.bools.has("help")) {
    console.log(usage());
    return;
  }

  const { flags } = args;

  // `coin_type` identifies the coin; it is always required.
  const rawCoinType = flags["coin-type"];
  if (!rawCoinType) {
    console.error("✗ --coin-type is required (it identifies which coin to upsert).");
    console.error("  Run with --help for usage.");
    process.exit(2);
  }

  // Canonicalize to locate any existing entry regardless of source formatting.
  let canonicalCoinType: string;
  try {
    canonicalCoinType = normalizeCoinType(rawCoinType);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(2);
  }

  const existing = loadCoinFiles();
  const match = existing.find((e) => {
    try {
      return normalizeCoinType(e.coin.coin_type) === canonicalCoinType;
    } catch {
      return false;
    }
  });

  // Start from the existing coin (update) or an empty object (create).
  const base: Partial<Coin> = match ? { ...match.coin } : {};

  // `coin_type` is the identity key. On create, store the value as given; on an
  // existing match, keep its stored form so that identifying a coin by a
  // differently-formatted (but canonically-equal) address is a non-destructive,
  // idempotent operation rather than a rewrite.
  if (!match) base.coin_type = rawCoinType;
  if (flags["chain-id"] !== undefined) base.chain_id = flags["chain-id"];
  if (flags["symbol"] !== undefined) base.symbol = flags["symbol"];
  if (flags["name"] !== undefined) base.name = flags["name"];
  if (flags["decimals"] !== undefined) {
    const n = Number(flags["decimals"]);
    if (!Number.isInteger(n)) {
      console.error(`✗ --decimals must be an integer, got: ${flags["decimals"]}`);
      process.exit(2);
    }
    base.decimals = n;
  }
  if (flags["icon-url"] !== undefined) base.icon_url = flags["icon-url"];
  if (flags["description"] !== undefined) base.description = flags["description"];
  if (flags["project-url"] !== undefined) base.project_url = flags["project-url"];

  // Tags: --clear-tags wipes; --tag/--tags (provided) replaces the set.
  if (args.bools.has("clear-tags")) {
    delete base.tags;
  } else {
    const tags = [...args.tags];
    if (flags["tags"] !== undefined) {
      tags.push(...flags["tags"].split(",").map((t) => t.trim()).filter(Boolean));
    }
    if (tags.length > 0) base.tags = [...new Set(tags)];
  }

  // Treasury addresses: --clear-treasury wipes; any --treasury replaces the set.
  if (args.bools.has("clear-treasury")) {
    delete base.treasury_addresses;
  } else if (args.treasuries.length > 0) {
    try {
      base.treasury_addresses = args.treasuries.map(parseTreasury);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(2);
    }
  }

  const coin = base as Coin;

  // Decide the target file: reuse the existing one, or --file, or symbol slug.
  let targetFile: string;
  if (match) {
    targetFile = match.file;
  } else if (flags["file"]) {
    targetFile = flags["file"].startsWith("coins/") ? flags["file"] : join("coins", flags["file"]);
  } else {
    if (!coin.symbol) {
      console.error("✗ --symbol is required when creating a new coin (used for the filename).");
      process.exit(2);
    }
    targetFile = join("coins", `${slugForSymbol(coin.symbol)}.json`);
  }
  const targetPath = join(ROOT, targetFile);

  const nextContent = serialize(coin);
  const prevContent =
    match || existsSync(targetPath) ? readFileSync(targetPath, "utf8") : undefined;

  // Idempotency: identical desired state is a no-op.
  if (prevContent === nextContent) {
    console.log(`= ${targetFile} unchanged (already at desired state).`);
    return;
  }

  const action = match ? "update" : "create";

  if (args.bools.has("dry-run")) {
    console.log(`Would ${action} ${targetFile}:\n`);
    console.log(nextContent);
    return;
  }

  // Write, then validate the whole registry; roll back on any failure.
  writeFileSync(targetPath, nextContent);
  const { errors } = validateAll();
  if (errors.length > 0) {
    if (prevContent === undefined) unlinkSync(targetPath);
    else writeFileSync(targetPath, prevContent);
    console.error(`✗ Refusing to ${action} — ${errors.length} validation error(s):\n`);
    for (const e of errors) console.error(`  ${e.file}: ${e.message}`);
    console.error("\nNo changes written.");
    process.exit(1);
  }

  const verb = match ? "Updated" : "Created";
  console.log(`✓ ${verb} ${targetFile} (${coin.symbol} — ${coin.coin_type}).`);
}

main();
