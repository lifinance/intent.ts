import { COIN_FILLER } from "../constants";
import { toId } from "../compact/idLib";
import type { IntentDeps } from "../deps";
import type {
  CompactLock,
  CreateIntentOptions,
  EscrowLock,
  MultichainOrder,
  StandardEVM,
  StandardSolana,
  TokenContext,
} from "../types/index";
import { MultichainOrderIntent } from "./multichain";
import { StandardEVMIntent } from "./standard";
import { buildMandateOutputs } from "./helpers/output-encoding";
import { ONE_DAY, ONE_HOUR, inputSettlerForLock, inputSettlerForSolana } from "./helpers/shared";
import { addressToBytes32 } from "../helpers/convert";
import { StandardSolanaIntent } from "./solanaStandard";

/**
 * @notice Class representing a Li.Fi Intent. Contains intent abstractions and helpers.
 */
export class Intent {
  private lock: EscrowLock | CompactLock;

  private walletUser: `0x${string}`;
  private inputs: TokenContext[];
  private outputs: TokenContext[];
  private getOracle: IntentDeps["getOracle"];
  private verifier: string;
  private exclusiveFor?: `0x${string}`;
  private outputRecipient?: `0x${string}`;

  private _nonce?: bigint;
  private expiry = ONE_DAY;
  private fillDeadline = 2 * ONE_HOUR;

  constructor(opts: CreateIntentOptions, deps: IntentDeps) {
    this.lock = opts.lock;
    this.walletUser = opts.account;
    this.inputs = opts.inputTokens;
    this.outputs = opts.outputTokens;
    this.verifier = opts.verifier;
    this.getOracle = deps.getOracle;
    this.exclusiveFor = opts.exclusiveFor;
    this.outputRecipient = opts.outputRecipient;
  }

  numInputChains() {
    const tokenChains = this.inputs.map(({ token }) => token.chainId);
    return [...new Set(tokenChains)].length;
  }

  isMultichain() {
    return this.numInputChains() > 1;
  }

  isSameChain() {
    if (this.isMultichain()) return false;
    const [firstInput] = this.inputs;
    const [firstOutput] = this.outputs;
    if (!firstInput || !firstOutput) {
      throw new Error(
        "Intent requires at least one input and one output token",
      );
    }
    const inputChain = firstInput.token.chainId;
    const outputChains = this.outputs.map((o) => o.token.chainId);
    const numOutputChains = [...new Set(outputChains)].length;
    if (numOutputChains > 1) return false;
    const outputChain = firstOutput.token.chainId;
    return inputChain === outputChain;
  }

  nonce() {
    if (this._nonce !== undefined) return this._nonce;
    this._nonce = BigInt(1 + Math.floor(Math.random() * (2 ** 32 - 1)));
    return this._nonce;
  }

  singlechain() {
    if (this.isMultichain()) {
      throw new Error(
        `Not supported as single chain with ${this.numInputChains()} chains`,
      );
    }

    const [firstInput] = this.inputs;
    if (!firstInput) {
      throw new Error("Intent requires at least one input token");
    }
    const inputChain = firstInput.token.chainId;
    const currentTime = Math.floor(Date.now() / 1000);
    // bytes32-padded address used as the mandate output recipient
    const recipient = this.outputRecipient ? addressToBytes32(this.outputRecipient) : addressToBytes32(this.walletUser);

    switch (firstInput.token.chainNameSpace) {
      case "solana": {
        if (this.inputs.length > 1) {
          throw new Error("SolanaStandardOrder only supports a single input");
        }
        const solanaInputOracle = this.getOracle(this.verifier, inputChain);
        if (!solanaInputOracle)
          throw new Error(`No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`);
        const solanaStandardOrder: StandardSolana = {
          user: this.walletUser,
          nonce: this.nonce(),
          originChainId: inputChain,
          fillDeadline: currentTime + this.fillDeadline,
          expires: currentTime + this.expiry,
          inputOracle: solanaInputOracle,
          inputs: [[BigInt(firstInput.token.address), firstInput.amount]],
          outputs: buildMandateOutputs({
            exclusiveFor: this.exclusiveFor,
            outputTokens: this.outputs,
            getOracle: this.getOracle,
            verifier: this.verifier,
            sameChain: this.isSameChain(),
            recipient,
            currentTime,
          }),
        };
        return new StandardSolanaIntent(inputSettlerForSolana(inputChain), solanaStandardOrder);
      }
      default: {
        const inputs: [bigint, bigint][] = this.inputs.map(({ token, amount }) => [
          this.lock.type === "compact"
            ? toId(true, this.lock.resetPeriod, this.lock.allocatorId, token.address)
            : BigInt(token.address),
          amount,
        ]);
        let evmInputOracle: `0x${string}`;

        if (this.isSameChain()) {
          evmInputOracle = COIN_FILLER;
        } else {
          const oracle = this.getOracle(this.verifier, inputChain);
          if (!oracle)
            throw new Error(`No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`);
          evmInputOracle = oracle;
        }
        
        const order: StandardEVM = {
          user: this.walletUser,
          nonce: this.nonce(),
          originChainId: inputChain,
          fillDeadline: currentTime + this.fillDeadline,
          expires: currentTime + this.expiry,
          inputOracle: evmInputOracle,
          inputs,
          outputs: buildMandateOutputs({
            exclusiveFor: this.exclusiveFor,
            outputTokens: this.outputs,
            getOracle: this.getOracle,
            verifier: this.verifier,
            sameChain: this.isSameChain(),
            recipient,
            currentTime,
          }),
        };
        return new StandardEVMIntent(inputSettlerForLock(this.lock, false), order);
      }
    }
  }

  multichain() {
    const [firstInput] = this.inputs;
    if (!firstInput) {
      throw new Error("Intent requires at least one input token");
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const inputOracle = this.getOracle(this.verifier, firstInput.token.chainId);
    if (!inputOracle)
      throw new Error(`No oracle configured for verifier "${this.verifier}" on chain ${firstInput.token.chainId}`);
    const recipient = this.outputRecipient ? addressToBytes32(this.outputRecipient) : addressToBytes32(this.walletUser);
    const inputs: { chainId: bigint; inputs: [bigint, bigint][] }[] = [
      ...new Set(this.inputs.map(({ token }) => token.chainId)),
    ].map((chain) => {
      const chainInputs = this.inputs.filter(
        ({ token }) => token.chainId === chain,
      );
      return {
        chainId: chain,
        inputs: chainInputs.map(({ token, amount }) => [
          this.lock.type === "compact"
            ? toId(
                true,
                this.lock.resetPeriod,
                this.lock.allocatorId,
                token.address,
              )
            : BigInt(token.address),
          amount,
        ]),
      };
    });

    const order: MultichainOrder = {
      user: this.walletUser,
      nonce: this.nonce(),
      fillDeadline: currentTime + this.fillDeadline,
      expires: currentTime + this.expiry,
      inputOracle,
      outputs: buildMandateOutputs({
        exclusiveFor: this.exclusiveFor,
        outputTokens: this.outputs,
        getOracle: this.getOracle,
        verifier: this.verifier,
        sameChain: false,
        recipient,
        currentTime,
      }),
      inputs,
    };

    return new MultichainOrderIntent(
      inputSettlerForLock(this.lock, true),
      order,
      this.lock as EscrowLock | CompactLock,
    );
  }

  order() {
    if (this.isMultichain()) return this.multichain();
    return this.singlechain();
  }
}

export type { CreateIntentOptions };
