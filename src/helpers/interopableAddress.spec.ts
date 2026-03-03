import { describe, expect, it } from "bun:test";
import { getInteropableAddress } from "./interopableAddress";

describe("interopable address", () => {
  it("encodes version, chain type, and chain reference metadata", () => {
    const address = "0x1111111111111111111111111111111111111111" as const;
    const encoded = getInteropableAddress(address, 1n).slice(2);

    expect(encoded.slice(0, 4)).toBe("0001");
    expect(encoded.slice(4, 8)).toBe("0000");
    expect(encoded.slice(8, 10)).toBe("01");
    expect(encoded.slice(10, 12)).toBe("01");
    expect(encoded.slice(12, 14)).toBe("14");
    expect(encoded.endsWith(address.slice(2))).toBe(true);
  });

  it("supports multibyte chain references", () => {
    const address = "0x2222222222222222222222222222222222222222" as const;
    const encoded = getInteropableAddress(address, 42161n).slice(2);

    expect(encoded.slice(8, 10)).toBe("02");
    expect(encoded.slice(10, 14)).toBe("a4b1");
    expect(encoded.endsWith(address.slice(2))).toBe(true);
  });
});
