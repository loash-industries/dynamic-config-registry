/**
 * Minimal, dependency-free helpers for validating and normalizing Sui
 * addresses and coin types. Keeping this in-repo avoids pulling the full
 * @mysten/sui SDK into CI just for a couple of regexes.
 */

/** Length of a fully-expanded Sui address in hex characters (32 bytes). */
export const SUI_ADDRESS_HEX_LENGTH = 64;

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const MOVE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidSuiAddress(address: string): boolean {
  return ADDRESS_RE.test(address);
}

/**
 * Normalize a Sui address to its canonical `0x` + 64 lowercase hex form.
 * Throws if the input is not a valid address.
 */
export function normalizeSuiAddress(address: string): string {
  if (!isValidSuiAddress(address)) {
    throw new Error(`invalid Sui address: ${JSON.stringify(address)}`);
  }
  const hex = address.slice(2).toLowerCase();
  return `0x${hex.padStart(SUI_ADDRESS_HEX_LENGTH, "0")}`;
}

export interface ParsedCoinType {
  address: string;
  module: string;
  name: string;
}

/**
 * Parse a `0x<address>::<module>::<STRUCT>` coin type into its parts,
 * validating the address and Move identifiers. Throws on malformed input.
 */
export function parseCoinType(coinType: string): ParsedCoinType {
  const parts = coinType.split("::");
  if (parts.length !== 3) {
    throw new Error(
      `coin_type must have the form 0x<address>::<module>::<STRUCT>: ${JSON.stringify(coinType)}`,
    );
  }
  const [address, module, name] = parts as [string, string, string];
  if (!isValidSuiAddress(address)) {
    throw new Error(`coin_type has an invalid address part: ${JSON.stringify(coinType)}`);
  }
  if (!MOVE_IDENTIFIER_RE.test(module)) {
    throw new Error(`coin_type has an invalid module name: ${JSON.stringify(coinType)}`);
  }
  if (!MOVE_IDENTIFIER_RE.test(name)) {
    throw new Error(`coin_type has an invalid struct name: ${JSON.stringify(coinType)}`);
  }
  return { address: normalizeSuiAddress(address), module, name };
}

/**
 * Canonical form of a coin type: address expanded to 64 hex chars, module
 * and struct names preserved as-is (they are case-sensitive in Move).
 */
export function normalizeCoinType(coinType: string): string {
  const { address, module, name } = parseCoinType(coinType);
  return `${address}::${module}::${name}`;
}
