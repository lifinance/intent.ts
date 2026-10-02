// Post-build smoke test: confirms each built dual-format entry point exposes
// the same named runtime exports from ESM and CJS. Catches a broken `exports`
// map, a missing subdir marker, or a CJS default-unwrap regression. Run by
// `bun run build:smoke` (chained after the build).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// A representative slice of each entry's public value exports that must always resolve.
const entries = {
  index: [
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
  "axelar/index": [
    "AXELAR_ORACLE_PROGRAM",
    "axelarSubmitInstruction",
    "axelarApprovalSteps",
    "axelarReceiveSteps",
    "checkSolanaAxelarAdmission",
  ],
};

for (const [entry, expected] of Object.entries(entries)) {
  const esmKeys = Object.keys(await import(`../_esm/${entry}.js`)).sort();
  const cjsKeys = Object.keys(require(`../_cjs/${entry}.js`)).sort();
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
