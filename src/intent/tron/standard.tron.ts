import { encodePacked, keccak256 } from "viem";
import { encodeOutputs } from "../helpers/output-encoding";
import type { StandardOrder, StandardTron } from "../../types/index";
import type { OrderIntent } from "../types";

export function computeStandardTronId(
  inputSettler: `0x${string}`,
  order: StandardTron,
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

export function standardOrderToTronOrder(order: StandardOrder): StandardTron {
  return {
    user: order.user,
    nonce: order.nonce,
    originChainId: order.originChainId,
    expires: order.expires,
    fillDeadline: order.fillDeadline,
    inputOracle: order.inputOracle,
    inputs: order.inputs as [bigint, bigint][],
    outputs: order.outputs,
  };
}

export class StandardTronIntent implements OrderIntent<StandardTron> {
  inputSettler: `0x${string}`;
  readonly namespace = "tron" as const;
  private readonly order: StandardTron;

  constructor(inputSettler: `0x${string}`, order: StandardTron) {
    this.inputSettler = inputSettler;
    this.order = order;
  }

  asOrder(): StandardTron {
    return this.order;
  }

  inputChains(): bigint[] {
    return [this.order.originChainId];
  }

  orderId(): `0x${string}` {
    return computeStandardTronId(this.inputSettler, this.order);
  }
}
