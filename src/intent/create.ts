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
  StandardStellar,
  TokenContext,
} from "../types/index";
import { MultichainOrderIntent } from "./evm/multichain.evm";
import { StandardEVMIntent } from "./evm/standard.evm";
import { buildMandateOutputs } from "./helpers/output-encoding";
import {
  ONE_DAY,
  ONE_HOUR,
  ONE_MINUTE,
  inputSettlerForLock,
  inputSettlerForSolana,
  inputSettlerForStellar,
  outputSettlerForSolana,
  outputSettlerForTron,
  inputSettlerForTron,
} from "./helpers/shared";
import { addressToBytes32 } from "../helpers/convert";
import { StandardSolanaIntent } from "./solana/standard.solana";
import { StandardStellarIntent } from "./stellar/standard.stellar";

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
  /** Expiry duration in seconds, relative to intent creation time. Defaults to 48 hours. */
  private expiry = 2 * ONE_DAY;
  /** Fill-deadline duration in seconds, relative to intent creation time. Defaults to 44 hours. */
  private fillDeadline = 44 * ONE_HOUR;
  /** Exclusivity window in seconds, relative to intent creation time. Defaults to 1 minute. */
  private exclusivity = ONE_MINUTE;

  constructor(opts: CreateIntentOptions, deps: IntentDeps) {
    this.lock = opts.lock;
    this.walletUser = opts.account;
    this.inputs = opts.inputTokens;
    this.outputs = opts.outputTokens;
    this.verifier = opts.verifier;
    this.getOracle = deps.getOracle;
    this.exclusiveFor = opts.exclusiveFor;
    this.outputRecipient = opts.outputRecipient;
    if (opts.expiry !== undefined) this.expiry = opts.expiry;
    if (opts.fillDeadline !== undefined) this.fillDeadline = opts.fillDeadline;
    if (opts.exclusivity !== undefined) this.exclusivity = opts.exclusivity;
  }

  /**
   * Override the expiry duration (seconds from creation time) for this intent.
   * Returns `this` for chaining.
   */
  setExpiry(seconds: number) {
    this.expiry = seconds;
    return this;
  }

  /**
   * Override the fill-deadline duration (seconds from creation time) for this intent.
   * Returns `this` for chaining.
   */
  setFillDeadline(seconds: number) {
    this.fillDeadline = seconds;
    return this;
  }

  /**
   * Override the exclusivity window (seconds from creation time) for this
   * intent. Only takes effect when `exclusiveFor` is set. Returns `this` for
   * chaining.
   */
  setExclusivity(seconds: number) {
    this.exclusivity = seconds;
    return this;
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

  private get recipient(): `0x${string}` {
    return addressToBytes32(this.outputRecipient ?? this.walletUser);
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
    const sameChain = this.isSameChain();
    const { recipient } = this;

    // The first input's namespace selects the whole branch below — a mixed
    // array would silently encode the rest of the inputs wrong.
    const mixedInput = this.inputs.find(
      ({ token }) => token.chainNamespace !== firstInput.token.chainNamespace,
    );
    if (mixedInput) {
      throw new Error(
        `All inputs must share one chain namespace; got "${firstInput.token.chainNamespace}" and "${mixedInput.token.chainNamespace}"`,
      );
    }

    // Cross-namespace orders must name their recipient explicitly. The
    // default recipient is the source-chain account, and reusing those 20
    // bytes on a different namespace only works for plain EOA keys — a smart
    // wallet (Safe), exchange deposit address, or non-exportable signer has
    // no key on the destination chain, so the output would be unrecoverable.
    const inputNamespace = firstInput.token.chainNamespace ?? "eip155";
    const crossNamespaceOutput = this.outputs.find(
      ({ token }) => (token.chainNamespace ?? "eip155") !== inputNamespace,
    );
    if (crossNamespaceOutput && this.outputRecipient === undefined) {
      throw new Error(
        `Orders with outputs on a different chain namespace ("${crossNamespaceOutput.token.chainNamespace}") than the inputs ("${inputNamespace}") require an explicit output recipient`,
      );
    }

    switch (firstInput.token.chainNamespace) {
      case "solana": {
        if (this.inputs.length > 1) {
          throw new Error("SolanaStandardOrder only supports a single input");
        }
        // Same-chain fills mirror the EVM and Tron behavior: the fill creates
        // a LocalAttestation directly, and `validate_fill` takes a branch that
        // never reads `input_oracle` (input_settler_base/src/base.rs:88-111).
        // Pointing it at the output settler keeps the encoding canonical
        // across namespaces; no cross-chain oracle is required.
        let solanaInputOracle: `0x${string}`;
        if (sameChain) {
          solanaInputOracle = outputSettlerForSolana(inputChain);
        } else {
          const oracle = this.getOracle(this.verifier, inputChain);
          if (!oracle)
            throw new Error(
              `No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`,
            );
          solanaInputOracle = oracle;
        }
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
            inputChainId: inputChain,
            inputNamespace,
            sameChain,
            recipient,
            currentTime,
            exclusivity: this.exclusivity,
          }),
        };
        return new StandardSolanaIntent(
          inputSettlerForSolana(inputChain),
          solanaStandardOrder,
        );
      }
      case "tron": {
        const tronInputs: [bigint, bigint][] = this.inputs.map(
          ({ token, amount }) => [BigInt(token.address), amount],
        );
        // Same-chain fills mirror the EVM behavior: the output settler doubles
        // as the input oracle (attested via `setAttestation` after the fill),
        // so no cross-chain oracle is required.
        let tronInputOracle: `0x${string}`;
        if (sameChain) {
          tronInputOracle = outputSettlerForTron(inputChain);
        } else {
          const oracle = this.getOracle(this.verifier, inputChain);
          if (!oracle)
            throw new Error(
              `No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`,
            );
          tronInputOracle = oracle;
        }
        const tronOrder: StandardEVM = {
          user: this.walletUser,
          nonce: this.nonce(),
          originChainId: inputChain,
          fillDeadline: currentTime + this.fillDeadline,
          expires: currentTime + this.expiry,
          inputOracle: tronInputOracle,
          inputs: tronInputs,
          outputs: buildMandateOutputs({
            exclusiveFor: this.exclusiveFor,
            outputTokens: this.outputs,
            getOracle: this.getOracle,
            verifier: this.verifier,
            inputChainId: inputChain,
            inputNamespace,
            sameChain,
            recipient,
            currentTime,
            exclusivity: this.exclusivity,
          }),
        };
        return new StandardEVMIntent(
          inputSettlerForTron(inputChain),
          tronOrder,
          "tron",
        );
      }
      case "stellar": {
        // The OutputSettler on Stellar has no local attestation path, so an
        // output on the input chain cannot be settled — whether it is the only
        // output or one of several spanning chains.
        if (
          this.outputs.some(
            ({ token }) =>
              token.chainId === inputChain &&
              (token.chainNamespace ?? "eip155") === inputNamespace,
          )
        )
          throw new Error("Same-chain Stellar orders are not supported");
        if (this.verifier !== "axelar")
          throw new Error("Stellar orders require the axelar verifier");
        if (this.inputs.length > 4)
          throw new Error("Stellar orders support at most 4 inputs");
        if (!/^0x[0-9a-fA-F]{64}$/.test(this.walletUser))
          throw new Error("Stellar orders need the user's 32-byte account key");
        const stellarInputOracle = this.getOracle(this.verifier, inputChain);
        if (!stellarInputOracle)
          throw new Error(
            `No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`,
          );
        const stellarOrder: StandardStellar = {
          user: this.walletUser,
          nonce: this.nonce(),
          originChainId: inputChain,
          fillDeadline: currentTime + this.fillDeadline,
          expires: currentTime + this.expiry,
          inputOracle: stellarInputOracle,
          inputs: this.inputs.map(({ token, amount }) => [
            BigInt(token.address),
            amount,
          ]),
          outputs: buildMandateOutputs({
            exclusiveFor: this.exclusiveFor,
            outputTokens: this.outputs,
            getOracle: this.getOracle,
            verifier: this.verifier,
            inputChainId: inputChain,
            inputNamespace,
            sameChain,
            recipient,
            currentTime,
            exclusivity: this.exclusivity,
          }),
        };
        return new StandardStellarIntent(
          inputSettlerForStellar(inputChain),
          stellarOrder,
        );
      }
      default: {
        const inputs: [bigint, bigint][] = this.inputs.map(
          ({ token, amount }) => [
            this.lock.type === "compact"
              ? toId(
                  true,
                  this.lock.resetPeriod,
                  this.lock.allocatorId,
                  token.address,
                )
              : BigInt(token.address),
            amount,
          ],
        );
        let evmInputOracle: `0x${string}`;

        if (sameChain) {
          evmInputOracle = COIN_FILLER;
        } else {
          const oracle = this.getOracle(this.verifier, inputChain);
          if (!oracle)
            throw new Error(
              `No oracle configured for verifier "${this.verifier}" on chain ${inputChain}`,
            );
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
            inputChainId: inputChain,
            inputNamespace,
            sameChain,
            recipient,
            currentTime,
            exclusivity: this.exclusivity,
          }),
        };
        return new StandardEVMIntent(
          inputSettlerForLock(this.lock, false),
          order,
        );
      }
    }
  }

  multichain() {
    const [firstInput] = this.inputs;
    if (!firstInput) {
      throw new Error("Intent requires at least one input token");
    }
    // Multichain orders encode every input for the EVM lock path; a Solana or
    // Tron input would be silently mis-encoded rather than rejected.
    const nonEvm = this.inputs.find(
      ({ token }) => (token.chainNamespace ?? "eip155") !== "eip155",
    );
    if (nonEvm) {
      throw new Error(
        `Multichain orders only support eip155 inputs; got "${nonEvm.token.chainNamespace}" input on chain ${nonEvm.token.chainId}`,
      );
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const inputOracle = this.getOracle(this.verifier, firstInput.token.chainId);
    if (!inputOracle)
      throw new Error(
        `No oracle configured for verifier "${this.verifier}" on chain ${firstInput.token.chainId}`,
      );
    const { recipient } = this;
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
        inputChainId: firstInput.token.chainId,
        // Multichain orders are EVM-only: a Solana or Tron input is rejected
        // upstream, so the input namespace is always eip155 here.
        inputNamespace: "eip155",
        sameChain: false,
        recipient,
        currentTime,
        exclusivity: this.exclusivity,
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
