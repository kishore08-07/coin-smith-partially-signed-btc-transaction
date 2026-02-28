// ──────────────────────────────────────────────────────────────────────────
// warnings.ts — Warning detection module
// ──────────────────────────────────────────────────────────────────────────

import { Warning } from './types';

/** Extended params for richer warning detection */
export interface WarningParams {
  fee_sats: number;
  fee_rate_sat_vb: number;
  change_value: number | null;
  rbf_signaling: boolean;
  /** Nominal payment values for dust payment detection */
  payment_values?: number[];
  /** Network string for unknown-network detection */
  network?: string;
  /** Number of selected inputs for large-input-count detection */
  input_count?: number;
}

const KNOWN_NETWORKS = ['mainnet', 'bitcoin', 'testnet', 'testnet3', 'testnet4', 'regtest', 'signet'];

/**
 * Generate warnings based on transaction report fields.
 *
 * Required warning codes (from README):
 *  - HIGH_FEE:       fee_sats > 1,000,000 OR fee_rate > 200
 *  - DUST_CHANGE:    change output exists with value < 546
 *  - SEND_ALL:       no change output was created (leftover consumed as fee)
 *  - RBF_SIGNALING:  rbf_signaling is true
 *
 * Additional safety warnings:
 *  - DUST_PAYMENT:   a payment output value < 546 sats
 *  - UNKNOWN_NETWORK: fixture network is not a recognized Bitcoin network
 *  - LARGE_INPUT_COUNT: more than 20 inputs selected (high fee overhead)
 */
export function generateWarnings(params: WarningParams): Warning[] {
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

  // DUST_PAYMENT: any payment output below dust threshold
  if (params.payment_values) {
    const dustPayments = params.payment_values.filter((v) => v < 546);
    if (dustPayments.length > 0) {
      warnings.push({
        code: 'DUST_PAYMENT',
        message: `${dustPayments.length} payment output(s) below dust threshold (546 sats)`,
      });
    }
  }

  // UNKNOWN_NETWORK: network is not recognized
  if (params.network && !KNOWN_NETWORKS.includes(params.network.toLowerCase())) {
    warnings.push({
      code: 'UNKNOWN_NETWORK',
      message: `Network "${params.network}" is not a recognized Bitcoin network`,
    });
  }

  // LARGE_INPUT_COUNT: many inputs means high overhead
  if (params.input_count !== undefined && params.input_count > 20) {
    warnings.push({
      code: 'LARGE_INPUT_COUNT',
      message: `Transaction uses ${params.input_count} inputs, which adds significant fee overhead`,
    });
  }

  return warnings;
}
