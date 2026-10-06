// Post-build smoke test: confirms each built dual-format entry point exposes
// the same named runtime exports from ESM and CJS. Entries are loaded by
// package specifier (self-reference), so resolution goes through the
// `exports` map; catches a broken `exports` map, a missing subdir marker, or a
// CJS default-unwrap regression. Run by `bun run build:smoke` (chained after
// the build).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// A representative slice of each entry's public value exports that must always resolve.
// Keyed by package specifier; resolved via package.json `exports`.
const entries = {
  "@lifi/intent": [
    "Intent",
    "IntentApi",
    "VALIDATION_ERRORS",
    "ResetPeriod",
    "validateOrder",
    "orderToIntent",
    "isStandardOrder",
    "toId",
    "addressToBytes32",
    "compactTypes",
    "signStandardCompact",
    "getOutputHash",
    "encodeFillDescription",
    "encodeNotFilledDescription",
    "getFillDescriptionHash",
    "getNotFilledDescriptionHash",
    "FILL_MAGIC",
    "NOT_FILLED_MAGIC",
    "findSolanaProgramAddress",
  ],
  "@lifi/intent/axelar": [
    "AXELAR_ORACLE_PROGRAM",
    "axelarSubmitInstruction",
    "axelarTransferOwnershipInstruction",
    "axelarRenounceOwnershipInstruction",
    "axelarApprovalSteps",
    "axelarReceiveSteps",
    "checkSolanaAxelarAdmission",
  ],
};

for (const [entry, expected] of Object.entries(entries)) {
  const esmKeys = Object.keys(await import(entry)).sort();
  const cjsKeys = Object.keys(require(entry)).sort();
  const missing = expected.filter(
    (k) => !esmKeys.includes(k) || !cjsKeys.includes(k),
  );
  if (missing.length) {
    console.error(`smoke FAILED — ${entry} missing expected exports:`, missing);
    process.exit(1);
  }
  if (esmKeys.join(",") !== cjsKeys.join(",")) {
    console.error(`smoke FAILED — ${entry} ESM and CJS exports differ.`);
    console.error("  esm:", esmKeys.join(", "));
    console.error("  cjs:", cjsKeys.join(", "));
    process.exit(1);
  }
  console.log(
    `smoke ok — ${entry}: ${esmKeys.length} named exports match across ESM and CJS`,
  );
}
