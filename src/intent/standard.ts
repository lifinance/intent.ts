import { encodePacked, keccak256 } from "viem";
import { INPUT_SETTLER_COMPACT_LIFI } from "../constants";
import { compactClaimHash } from "./compact/claims";
import { toStandardBatchCompact } from "./compact/conversions";
import { encodeOutputs } from "./helpers/output-encoding";
import type { BatchCompact, StandardEVM } from "../types/index";
import type { EvmOrderIntent } from "./types";

export function computeStandardEVMId(
  inputSettler: `0x${string}`,
  order: StandardEVM,
): `0x${string}` {
  return keccak256(
    encodePacked(
      [
        "uint256",
        "address",
        "address",
        "uint256",
        "uint32",
        "uint32",
        "address",
        "bytes32",
        "bytes",
      ],
      [
        order.originChainId,
        inputSettler,
        order.user,
        order.nonce,
        order.expires,
        order.fillDeadline,
        order.inputOracle,
        keccak256(encodePacked(["uint256[2][]"], [order.inputs])),
        encodeOutputs(order.outputs),
      ],
    ),
  );
}

export class StandardEVMIntent implements EvmOrderIntent<StandardEVM> {
  inputSettler: `0x${string}`;
  private readonly order: StandardEVM;

  constructor(inputSetter: `0x${string}`, order: StandardEVM) {
    this.inputSettler = inputSetter;
    this.order = order;
  }

  asOrder(): StandardEVM {
    return this.order;
  }

  asBatchCompact(): BatchCompact {
    return toStandardBatchCompact(this.order, INPUT_SETTLER_COMPACT_LIFI);
  }

  inputChains(): bigint[] {
    return [this.order.originChainId];
  }

  orderId(): `0x${string}` {
    return computeStandardEVMId(this.inputSettler, this.order);
  }

  compactClaimHash(): `0x${string}` {
    return compactClaimHash(this.asBatchCompact());
  }
}
