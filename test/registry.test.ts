import { describe, expect, it } from "vitest";
import { normalizeCoin, validateAll } from "../src/registry.js";

describe("validateAll (repo fixtures)", () => {
  it("validates the committed coins/ directory with no errors", () => {
    const { coins, errors } = validateAll();
    expect(errors).toEqual([]);
    expect(coins.length).toBeGreaterThan(0);
  });
});

describe("normalizeCoin", () => {
  it("expands the coin_type address and treasury addresses", () => {
    const out = normalizeCoin({
      chain_id: "sui:mainnet",
      coin_type: "0x2::cred::CRED",
      symbol: "CRED",
      name: "Credits",
      decimals: 9,
      treasury_addresses: [{ address: "0xab", type: "treasury" }],
    });
    expect(out.coin_type).toBe(`0x${"0".repeat(63)}2::cred::CRED`);
    expect(out.treasury_addresses?.[0]?.address).toBe(`0x${"0".repeat(62)}ab`);
  });
});
