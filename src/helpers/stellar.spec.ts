import { describe, expect, it } from "bun:test";
import fixture from "../../tests/vectors/stellarClientOrder.json";
import {
  bytes32ToStellarAccount,
  bytes32ToStellarContract,
  isStellarAccount,
  isStellarContract,
  stellarAddressCommitment,
  stellarStrkeyToBytes32,
} from "./stellar";

// Mainnet deployment of intent-soroban (contracts/DEPLOYMENTS.md).
const CONTRACTS: [string, `0x${string}`][] = [
  [
    "CA5GTK5U5LYGWIJSAG6LD724NUDFONHVEHYOHOH5KWCKCX5I442QYLUN",
    "0x3a69abb4eaf06b213201bcb1ff5c6d065734f521f0e3b8fd5584a15fa8e7350c",
  ],
  [
    "CAVJORXN3EOHH5GGHOK66YTPBUFNICWGSAO3UBUG6SS75VSMGWIEQX4V",
    "0x2a9746edd91c73f4c63b95ef626f0d0ad40ac6901dba0686f4a5fed64c359048",
  ],
];
const ACCOUNT = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const ACCOUNT_RAW = `0x${"01".repeat(32)}` as const;

describe("Stellar strkeys", () => {
  it("round-trips contract ids", () => {
    for (const [strkey, raw] of CONTRACTS) {
      expect(stellarStrkeyToBytes32(strkey)).toBe(raw);
      expect(bytes32ToStellarContract(raw)).toBe(strkey);
      expect(isStellarContract(strkey)).toBe(true);
      expect(isStellarAccount(strkey)).toBe(false);
    }
  });

  it("round-trips account keys", () => {
    expect(stellarStrkeyToBytes32(ACCOUNT)).toBe(ACCOUNT_RAW);
    expect(bytes32ToStellarAccount(ACCOUNT_RAW)).toBe(ACCOUNT);
    expect(isStellarAccount(ACCOUNT)).toBe(true);
    expect(isStellarContract(ACCOUNT)).toBe(false);
  });

  it("rejects a corrupted checksum", () => {
    const corrupted = `${ACCOUNT.slice(0, 55)}A`;
    expect(() => stellarStrkeyToBytes32(corrupted)).toThrow(
      "Invalid Stellar address",
    );
    expect(isStellarAccount(corrupted)).toBe(false);
  });

  it("rejects muxed accounts", () => {
    expect(() => stellarStrkeyToBytes32(fixture.muxed_recipient)).toThrow(
      "Invalid Stellar address",
    );
  });
});

describe("stellarAddressCommitment", () => {
  it("matches the intent-soroban client vector", () => {
    expect(stellarAddressCommitment(fixture.claimant)).toBe(
      `0x${fixture.claimant_commitment}`,
    );
  });
});
