import { describe, expect, it } from "vitest";
import {
  isValidSuiAddress,
  normalizeCoinType,
  normalizeSuiAddress,
  parseCoinType,
} from "../src/sui.js";

describe("isValidSuiAddress", () => {
  it("accepts short and full-length hex addresses", () => {
    expect(isValidSuiAddress("0x2")).toBe(true);
    expect(isValidSuiAddress(`0x${"a".repeat(64)}`)).toBe(true);
  });

  it("rejects missing prefix, bad chars, and over-length", () => {
    expect(isValidSuiAddress("2")).toBe(false);
    expect(isValidSuiAddress("0xg")).toBe(false);
    expect(isValidSuiAddress(`0x${"a".repeat(65)}`)).toBe(false);
    expect(isValidSuiAddress("0x")).toBe(false);
  });
});

describe("normalizeSuiAddress", () => {
  it("left-pads to 64 hex chars and lowercases", () => {
    expect(normalizeSuiAddress("0x2")).toBe(`0x${"0".repeat(63)}2`);
    expect(normalizeSuiAddress("0xAB")).toBe(`0x${"0".repeat(62)}ab`);
  });

  it("throws on invalid input", () => {
    expect(() => normalizeSuiAddress("nope")).toThrow();
  });
});

describe("parseCoinType", () => {
  it("parses and normalizes the address, preserving module/struct case", () => {
    expect(parseCoinType("0x2::sui::SUI")).toEqual({
      address: `0x${"0".repeat(63)}2`,
      module: "sui",
      name: "SUI",
    });
  });

  it("rejects malformed coin types", () => {
    expect(() => parseCoinType("0x2::sui")).toThrow();
    expect(() => parseCoinType("0x2::sui::SUI::extra")).toThrow();
    expect(() => parseCoinType("0xg::sui::SUI")).toThrow();
    expect(() => parseCoinType("0x2::1bad::SUI")).toThrow();
  });
});

describe("normalizeCoinType", () => {
  it("produces a canonical, fully-expanded coin type", () => {
    expect(normalizeCoinType("0x2::sui::SUI")).toBe(`0x${"0".repeat(63)}2::sui::SUI`);
  });
});
