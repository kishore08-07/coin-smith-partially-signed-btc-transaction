// ──────────────────────────────────────────────────────────────────────────
// reporter.ts — JSON report assembly with all 14 required fields
// ──────────────────────────────────────────────────────────────────────────

import {
  Fixture,
  UTXO,
  Payment,
  ChangeTemplate,
  FeeChangeResult,
  RbfLocktimeResult,
  SuccessReport,
  ErrorReport,
  Report,
  ReportOutput,
  SelectedInput,
  Warning,
} from './types';

/**
 * Build a success report from all computed fields.
 */
export function buildSuccessReport(params: {
  fixture: Fixture;
  selectedInputs: UTXO[];
  payments: Payment[];
  change: ChangeTemplate;
  feeChange: FeeChangeResult;
  rbfLocktime: RbfLocktimeResult;
  psbtBase64: string;
  warnings: Warning[];
  strategy?: string;
}): SuccessReport {
  const {
    fixture,
    selectedInputs,
    payments,
    change,
    feeChange,
    rbfLocktime,
    psbtBase64,
    warnings,
    strategy = 'greedy_effective_value',
  } = params;

  // Build selected_inputs array
  const selected_inputs: SelectedInput[] = selectedInputs.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value_sats: u.value_sats,
    script_pubkey_hex: u.script_pubkey_hex,
    script_type: u.script_type,
    address: u.address || '',
  }));

  // Build outputs array (payments first, then optional change)
  const outputs: ReportOutput[] = [];
  let outputIndex = 0;

  for (const p of payments) {
    outputs.push({
      n: outputIndex++,
      value_sats: p.value_sats,
      script_pubkey_hex: p.script_pubkey_hex,
      script_type: p.script_type,
      address: p.address || '',
      is_change: false,
    });
  }

  let change_index: number | null = null;

  if (feeChange.change_value !== null && feeChange.change_value > 0) {
    change_index = outputIndex;
    outputs.push({
      n: outputIndex++,
      value_sats: feeChange.change_value,
      script_pubkey_hex: change.script_pubkey_hex,
      script_type: change.script_type,
      address: change.address || '',
      is_change: true,
    });
  }

  return {
    ok: true,
    network: fixture.network,
    strategy,
    selected_inputs,
    outputs,
    change_index,
    fee_sats: feeChange.fee_sats,
    fee_rate_sat_vb: parseFloat((feeChange.fee_sats / feeChange.vbytes).toFixed(4)),
    vbytes: feeChange.vbytes,
    rbf_signaling: rbfLocktime.rbf_signaling,
    locktime: rbfLocktime.nLockTime,
    locktime_type: rbfLocktime.locktime_type,
    psbt_base64: psbtBase64,
    warnings,
  };
}

/**
 * Build an error report.
 */
export function buildErrorReport(code: string, message: string): ErrorReport {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}
