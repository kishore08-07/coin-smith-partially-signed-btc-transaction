// ──────────────────────────────────────────────────────────────────────────
// builder.ts — Main CLI entry point for Coin Smith PSBT builder
// ──────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { parseFixture } from './parser';
import { computeFeeAndChange } from './fee_engine';
import { computeRbfLocktime } from './rbf_locktime';
import { buildPSBT, getNetwork } from './psbt_builder';
import { generateWarnings } from './warnings';
import { buildSuccessReport, buildErrorReport } from './reporter';
import { BuilderError, Report } from './types';

/**
 * Build a PSBT from a fixture file and write the JSON report.
 */
export function buildFromFixture(fixtureJson: string): Report {
  // 1. Parse and validate fixture
  const fixture = parseFixture(fixtureJson);

  // 2. Compute RBF / locktime
  const rbfLocktime = computeRbfLocktime(
    fixture.rbf,
    fixture.locktime,
    fixture.current_height
  );

  // 3. Compute fee, change, and select coins
  const { selected, result: feeChange } = computeFeeAndChange(
    fixture.utxos,
    fixture.payments,
    fixture.change,
    fixture.fee_rate_sat_vb,
    fixture.policy?.max_inputs
  );

  // 4. Build PSBT
  const network = getNetwork(fixture.network);
  const psbtBase64 = buildPSBT(
    selected,
    fixture.payments,
    feeChange.change_value !== null ? fixture.change : null,
    feeChange.change_value,
    rbfLocktime.nSequence,
    rbfLocktime.nLockTime,
    network
  );

  // 5. Generate warnings
  const warnings = generateWarnings({
    fee_sats: feeChange.fee_sats,
    fee_rate_sat_vb: feeChange.fee_sats / feeChange.vbytes,
    change_value: feeChange.change_value,
    rbf_signaling: rbfLocktime.rbf_signaling,
  });

  // 6. Build report
  return buildSuccessReport({
    fixture,
    selectedInputs: selected,
    payments: fixture.payments,
    change: fixture.change,
    feeChange,
    rbfLocktime,
    psbtBase64,
    warnings,
  });
}

// ── CLI execution ────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node builder.js <fixture.json> <output.json>');
    process.exit(1);
  }

  const fixturePath = args[0];
  const outputPath = args[1];

  // Ensure output directory exists
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let report: Report;
  try {
    // Read fixture
    if (!fs.existsSync(fixturePath)) {
      report = buildErrorReport('FILE_NOT_FOUND', `Fixture file not found: ${fixturePath}`);
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
      process.exit(1);
    }

    const fixtureJson = fs.readFileSync(fixturePath, 'utf-8');
    report = buildFromFixture(fixtureJson);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (e) {
    if (e instanceof BuilderError) {
      report = buildErrorReport(e.code, e.message);
    } else if (e instanceof Error) {
      report = buildErrorReport('INTERNAL_ERROR', e.message);
    } else {
      report = buildErrorReport('INTERNAL_ERROR', 'Unknown error occurred');
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

// Only run main if this is the CLI entry point
if (require.main === module) {
  main();
}
