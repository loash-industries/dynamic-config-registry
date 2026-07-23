import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { normalizeCoinType, normalizeSuiAddress, parseCoinType } from "./sui.js";

export const ROOT = process.cwd();
export const COINS_DIR = join(ROOT, "coins");
export const SCHEMA_PATH = join(ROOT, "schema", "coin.schema.json");
export const DIST_DIR = join(ROOT, "dist");

export interface TreasuryAddress {
  address: string;
  label?: string;
  type: string;
}

export interface Coin {
  chain_id: string;
  coin_type: string;
  symbol: string;
  name: string;
  decimals: number;
  icon_url?: string;
  description?: string;
  project_url?: string;
  tags?: string[];
  treasury_addresses?: TreasuryAddress[];
}

export interface LoadedCoin {
  /** Path relative to the repo root, e.g. "coins/cred.json". */
  file: string;
  coin: Coin;
}

export interface ValidationIssue {
  file: string;
  message: string;
}

export interface ValidationResult {
  coins: LoadedCoin[];
  errors: ValidationIssue[];
}

function buildValidator(): ValidateFunction {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** Read every coins/*.json file from disk. Does not validate. */
export function loadCoinFiles(): LoadedCoin[] {
  const entries = readdirSync(COINS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => e.name)
    .sort();

  return entries.map((name) => {
    const file = join("coins", name);
    const raw = readFileSync(join(COINS_DIR, name), "utf8");
    let coin: Coin;
    try {
      coin = JSON.parse(raw) as Coin;
    } catch (err) {
      throw new Error(`${file}: not valid JSON — ${(err as Error).message}`);
    }
    return { file, coin };
  });
}

/**
 * Load and fully validate every coin: JSON Schema shape checks, Sui-specific
 * semantic checks (coin type + address parsing), and cross-file invariants
 * (duplicate coin types, duplicate treasury addresses within a coin).
 */
export function validateAll(): ValidationResult {
  const validate = buildValidator();
  const errors: ValidationIssue[] = [];

  let loaded: LoadedCoin[] = [];
  try {
    loaded = loadCoinFiles();
  } catch (err) {
    return { coins: [], errors: [{ file: "coins/", message: (err as Error).message }] };
  }

  const seenCoinTypes = new Map<string, string>();

  for (const entry of loaded) {
    const { file, coin } = entry;

    // 1. Schema (shape) validation.
    if (!validate(coin)) {
      for (const e of validate.errors ?? []) {
        const path = e.instancePath || "(root)";
        errors.push({ file, message: `${path} ${e.message ?? "is invalid"}` });
      }
      continue; // shape is wrong; skip semantic checks for this file
    }

    // 2. Sui semantic validation of the coin type.
    let normalizedCoinType: string;
    try {
      normalizedCoinType = normalizeCoinType(coin.coin_type);
    } catch (err) {
      errors.push({ file, message: (err as Error).message });
      continue;
    }

    // 3. Cross-file: duplicate coin types (compared in canonical form).
    const prior = seenCoinTypes.get(normalizedCoinType);
    if (prior) {
      errors.push({
        file,
        message: `duplicate coin_type ${coin.coin_type} — also defined in ${prior}`,
      });
    } else {
      seenCoinTypes.set(normalizedCoinType, file);
    }

    // 4. Treasury addresses: valid + unique within this coin.
    const seenAddresses = new Set<string>();
    for (const t of coin.treasury_addresses ?? []) {
      let normalizedAddress: string;
      try {
        normalizedAddress = normalizeSuiAddress(t.address);
      } catch (err) {
        errors.push({ file, message: (err as Error).message });
        continue;
      }
      if (seenAddresses.has(normalizedAddress)) {
        errors.push({
          file,
          message: `duplicate treasury address ${t.address}`,
        });
      }
      seenAddresses.add(normalizedAddress);
    }
  }

  return { coins: loaded, errors };
}

/**
 * Validate a single coin object in isolation: JSON Schema shape checks plus the
 * Sui-specific semantic checks (coin type + treasury address parsing). Returns a
 * list of human-readable error messages — empty means the coin is well-formed.
 *
 * This does NOT check cross-file invariants (e.g. duplicate coin types); use
 * {@link validateAll} for those.
 */
export function validateCoin(coin: unknown): string[] {
  const validate = buildValidator();
  const errors: string[] = [];

  if (!validate(coin)) {
    for (const e of validate.errors ?? []) {
      const path = e.instancePath || "(root)";
      errors.push(`${path} ${e.message ?? "is invalid"}`);
    }
    return errors; // shape is wrong; skip semantic checks
  }

  const c = coin as Coin;
  try {
    normalizeCoinType(c.coin_type);
  } catch (err) {
    errors.push((err as Error).message);
  }

  const seenAddresses = new Set<string>();
  for (const t of c.treasury_addresses ?? []) {
    let normalized: string;
    try {
      normalized = normalizeSuiAddress(t.address);
    } catch (err) {
      errors.push((err as Error).message);
      continue;
    }
    if (seenAddresses.has(normalized)) {
      errors.push(`duplicate treasury address ${t.address}`);
    }
    seenAddresses.add(normalized);
  }

  return errors;
}

/** Canonicalize a coin for publishing: expand addresses to their full form. */
export function normalizeCoin(coin: Coin): Coin {
  const { address, module, name } = parseCoinType(coin.coin_type);
  const out: Coin = {
    ...coin,
    coin_type: `${address}::${module}::${name}`,
  };
  if (coin.treasury_addresses) {
    out.treasury_addresses = coin.treasury_addresses.map((t) => ({
      ...t,
      address: normalizeSuiAddress(t.address),
    }));
  }
  return out;
}
