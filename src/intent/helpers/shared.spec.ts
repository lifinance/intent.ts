import { describe, expect, it } from "bun:test";
import { ResetPeriod } from "../../compact/idLib";
import {
  INPUT_SETTLER_COMPACT_LIFI,
  INPUT_SETTLER_ESCROW_LIFI,
  MULTICHAIN_INPUT_SETTLER_COMPACT,
  MULTICHAIN_INPUT_SETTLER_ESCROW,
} from "../../constants";
import type { CompactLock, EscrowLock } from "../../types";
import {
  inputSettlerForLock,
  ONE_DAY,
  ONE_HOUR,
  ONE_MINUTE,
  selectAllBut,
} from "./shared";

describe("intent shared helpers", () => {
  it("exports expected time constants", () => {
    expect(ONE_MINUTE).toBe(60);
    expect(ONE_HOUR).toBe(3600);
    expect(ONE_DAY).toBe(86400);
  });

  it("selectAllBut removes the item at the provided index", () => {
    expect(selectAllBut([1, 2, 3], 0)).toEqual([2, 3]);
    expect(selectAllBut([1, 2, 3], 1)).toEqual([1, 3]);
    expect(selectAllBut([1, 2, 3], 2)).toEqual([1, 2]);
  });

  it("maps lock type and scope to the expected input settler", () => {
    const escrowLock: EscrowLock = { type: "escrow" };
    const compactLock: CompactLock = {
      type: "compact",
      resetPeriod: ResetPeriod.OneMinute,
      allocatorId: "1",
    };

    expect(inputSettlerForLock(escrowLock, false)).toBe(
      INPUT_SETTLER_ESCROW_LIFI,
    );
    expect(inputSettlerForLock(escrowLock, true)).toBe(
      MULTICHAIN_INPUT_SETTLER_ESCROW,
    );
    expect(inputSettlerForLock(compactLock, false)).toBe(
      INPUT_SETTLER_COMPACT_LIFI,
    );
    expect(inputSettlerForLock(compactLock, true)).toBe(
      MULTICHAIN_INPUT_SETTLER_COMPACT,
    );
  });
});
