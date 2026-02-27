// ──────────────────────────────────────────────────────────────────────────
// warnings.ts — Warning detection module
// ──────────────────────────────────────────────────────────────────────────

import { Warning } from './types';

/**
 * Generate warnings based on transaction report fields.
 *
 * Required warning codes (from README):
 *  - HIGH_FEE:       fee_sats > 1,000,000 OR fee_rate > 200
 *  - DUST_CHANGE:    change output exists with value < 546
 *  - SEND_ALL:       no change output was created (leftover consumed as fee)
 *  - RBF_SIGNALING:  rbf_signaling is true
 */
export function generateWarnings(params: {
  fee_sats: number;
  fee_rate_sat_vb: number;
  change_value: number | null;
  rbf_signaling: boolean;
}): Warning[] {
  const warnings: Warning[] = [];

  // SEND_ALL: no change output created
  if (params.change_value === null) {
    warnings.push({
      code: 'SEND_ALL',
      message: 'No change output created; leftover consumed as fee',
    });
  }

  // HIGH_FEE: fee_sats > 1,000,000 OR fee_rate > 200
  if (params.fee_sats > 1_000_000 || params.fee_rate_sat_vb > 200) {
    warnings.push({
      code: 'HIGH_FEE',
      message: params.fee_sats > 1_000_000
        ? `Fee of ${params.fee_sats} sats exceeds 1,000,000 threshold`
        : `Fee rate of ${params.fee_rate_sat_vb.toFixed(2)} sat/vB exceeds 200 threshold`,
    });
  }

  // DUST_CHANGE: change output exists with value < 546
  if (params.change_value !== null && params.change_value < 546) {
    warnings.push({
      code: 'DUST_CHANGE',
      message: `Change output of ${params.change_value} sats is below dust threshold (546)`,
    });
  }

  // RBF_SIGNALING: transaction opts into Replace-By-Fee
  if (params.rbf_signaling) {
    warnings.push({
      code: 'RBF_SIGNALING',
      message: 'Transaction signals Replace-By-Fee (BIP-125)',
    });
  }

  return warnings;
}
