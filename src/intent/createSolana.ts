import type { SolanaIntentDeps } from "../deps";
import { addressToBytes32 } from "../helpers/convert";
import type {
  CreateSolanaIntentOptions,
  SolanaStandardOrder,
} from "../types/index";
import { buildMandateOutputs } from "./helpers/output-encoding";
import { ONE_DAY, ONE_HOUR } from "./helpers/shared";
import { SolanaStandardOrderIntent } from "./solana";

/**
 * @notice Class for creating Solana-originated intents (Solana→EVM).
 * Produces a SolanaStandardOrderIntent with a single SPL token input.
 */
export class SolanaIntent {
  private walletUser: `0x${string}`;
  private inputToken: CreateSolanaIntentOptions["inputToken"];
  private outputs: CreateSolanaIntentOptions["outputTokens"];
  private getOracle: SolanaIntentDeps["getOracle"];
  private inputOracle: `0x${string}`;
  private verifier: string;
  private exclusiveFor?: `0x${string}`;
  private outputRecipient?: `0x${string}`;

  private _nonce?: bigint;
  private expiry = ONE_DAY;
  private fillDeadline = 2 * ONE_HOUR;

  constructor(opts: CreateSolanaIntentOptions, deps: SolanaIntentDeps) {
    this.walletUser = opts.account;
    this.inputToken = opts.inputToken;
    this.outputs = opts.outputTokens;
    this.verifier = opts.verifier;
    this.getOracle = deps.getOracle;
    this.inputOracle = deps.inputOracle;
    this.exclusiveFor = opts.exclusiveFor;
    this.outputRecipient = opts.outputRecipient;
  }

  nonce(): bigint {
    if (this._nonce !== undefined) return this._nonce;
    this._nonce = BigInt(1 + Math.floor(Math.random() * (2 ** 32 - 1)));
    return this._nonce;
  }

  order(): SolanaStandardOrderIntent {
    const currentTime = Math.floor(Date.now() / 1000);
    const { token, amount } = this.inputToken;

    const solanaOrder: SolanaStandardOrder = {
      user: this.walletUser,
      nonce: this.nonce(),
      originChainId: token.chainId,
      expires: currentTime + this.expiry,
      fillDeadline: currentTime + this.fillDeadline,
      inputOracle: this.inputOracle,
      input: {
        token: token.address,
        amount,
      },
      outputs: buildMandateOutputs({
        exclusiveFor: this.exclusiveFor,
        outputTokens: this.outputs,
        getOracle: this.getOracle,
        verifier: this.verifier,
        sameChain: false,
        bytes32Recipient: this.outputRecipient ? addressToBytes32(this.outputRecipient) : addressToBytes32(this.walletUser),
        currentTime,
      }),
    };

    return new SolanaStandardOrderIntent(solanaOrder);
  }
}
