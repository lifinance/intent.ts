import { describe, expect, it } from "bun:test";
import {
  ADDRESS_ZERO,
  BYTES32_ZERO,
  COMPACT,
  COIN_FILLER,
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
} from "./constants";

describe("constants", () => {
  it("exports canonical zero constants", () => {
    expect(ADDRESS_ZERO).toBe("0x0000000000000000000000000000000000000000");
    expect(BYTES32_ZERO).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("exports address-like constants", () => {
    const addresses = [
      COMPACT,
      COIN_FILLER,
      INPUT_SETTLER_COMPACT_LIFI,
      INPUT_SETTLER_ESCROW_LIFI,
      MULTICHAIN_INPUT_SETTLER_ESCROW,
      MULTICHAIN_INPUT_SETTLER_COMPACT,
    ];
    for (const address of addresses) {
      expect(address.startsWith("0x")).toBe(true);
      expect(address).toHaveLength(42);
    }
  });
});
