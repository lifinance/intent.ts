import type { SolanaStandardOrder } from "../types";

export class SolanaStandardOrderIntent {
  private readonly _order: SolanaStandardOrder;

  constructor(order: SolanaStandardOrder) {
    this._order = order;
  }

  asOrder(): SolanaStandardOrder {
    return this._order;
  }
}
