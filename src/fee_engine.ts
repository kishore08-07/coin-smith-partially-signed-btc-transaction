// ──────────────────────────────────────────────────────────────────────────
// fee_engine.ts — Iterative fee/change engine with effective-value selection
// ──────────────────────────────────────────────────────────────────────────

import { UTXO, Payment, ChangeTemplate, ScriptType, FeeChangeResult, BuilderError } from './types';
import { estimateVbytes } from './weights';
import { sortByEffectiveValue } from './selector';

/** Dust threshold in satoshis */
export const DUST_THRESHOLD = 546;

/**
 * Decide fee and change for a fixed set of inputs.
 *
 * Two-pass logic:
 *  1. Estimate fee WITHOUT a change output
 *  2. If leftover ≥ dust threshold, re-estimate WITH a change output
 *  3. If adding the change output pushes change below dust, absorb as fee
 *
 * @returns FeeChangeResult, or null if inputs cannot cover payments + minimum fee
 */
export function decideFeeChange(
  inputSum: number,
  paymentSum: number,
  inputTypes: ScriptType[],
  paymentOutputTypes: ScriptType[],
  paymentOutputHexes: string[],
  change: ChangeTemplate,
  feeRate: number
): FeeChangeResult | null {
  // ── Pass 1: fee WITHOUT change ─────────────────────────────────────────
  const vbytesNoChange = estimateVbytes(inputTypes, paymentOutputTypes, paymentOutputHexes);
  const feeNoChange = Math.ceil(vbytesNoChange * feeRate);

  if (inputSum < paymentSum + feeNoChange) {
    return null; // Cannot cover payments + minimum fee
  }

  const leftover = inputSum - paymentSum - feeNoChange;

  if (leftover < DUST_THRESHOLD) {
    // SEND_ALL: leftover too small for a viable change output
    const actualFee = inputSum - paymentSum;
    return {
      fee_sats: actualFee,
      vbytes: vbytesNoChange,
      change_value: null,
      fee_rate_actual: actualFee / vbytesNoChange,
    };
  }

  // ── Pass 2: fee WITH change ────────────────────────────────────────────
  const allOutputTypes = [...paymentOutputTypes, change.script_type];
  const allOutputHexes = [...paymentOutputHexes, change.script_pubkey_hex];
  const vbytesWithChange = estimateVbytes(inputTypes, allOutputTypes, allOutputHexes);
  const feeWithChange = Math.ceil(vbytesWithChange * feeRate);
  const changeValue = inputSum - paymentSum - feeWithChange;

  if (changeValue >= DUST_THRESHOLD) {
    // Change is viable — minimum fee, change gets the rest
    return {
      fee_sats: feeWithChange,
      vbytes: vbytesWithChange,
      change_value: changeValue,
      fee_rate_actual: feeWithChange / vbytesWithChange,
    };
  }

  // Change dropped below dust after accounting for change output weight.
  // Absorb the full leftover as fee (SEND_ALL).
  const actualFee = inputSum - paymentSum;
  return {
    fee_sats: actualFee,
    vbytes: vbytesNoChange,
    change_value: null,
    fee_rate_actual: actualFee / vbytesNoChange,
  };
}

/**
 * Compute fee and change with iterative effective-value greedy selection.
 *
 * Improvements over naive value-descending greedy:
 *  1. Sorts by effective value (prefers cheaper-to-spend UTXOs like P2TR)
 *  2. Uses extracted decideFeeChange helper (no duplicated logic)
 *  3. Separates MAX_INPUTS_EXCEEDED from INSUFFICIENT_FUNDS
 *
 * @returns selected UTXOs and the fee/change result
 */
export function computeFeeAndChange(
  utxos: UTXO[],
  payments: Payment[],
  change: ChangeTemplate,
  feeRate: number,
  maxInputs?: number
): { selected: UTXO[]; result: FeeChangeResult } {
  const paymentSum = payments.reduce((s, p) => s + p.value_sats, 0);
  const paymentOutputTypes: ScriptType[] = payments.map((p) => p.script_type);
  const paymentOutputHexes: string[] = payments.map((p) => p.script_pubkey_hex);

  const totalPool = utxos.reduce((s, u) => s + u.value_sats, 0);

  // Fail fast if payment sum alone exceeds total UTXO pool
  if (paymentSum > totalPool) {
    throw new BuilderError(
      'INSUFFICIENT_FUNDS',
      `Total UTXO pool (${totalPool} sats) cannot cover payments (${paymentSum} sats)`
    );
  }

  // Sort by effective value: prefers high-value + cheap-to-spend inputs
  const sortedUtxos = sortByEffectiveValue(utxos, feeRate);
  const limit = maxInputs ?? sortedUtxos.length;

  // ── Iterative greedy coin selection ────────────────────────────────────
  const selected: UTXO[] = [];
  let inputSum = 0;

  for (let i = 0; i < Math.min(sortedUtxos.length, limit); i++) {
    selected.push(sortedUtxos[i]);
    inputSum += sortedUtxos[i].value_sats;

    const inputTypes = selected.map((u) => u.script_type);
    const result = decideFeeChange(
      inputSum, paymentSum, inputTypes,
      paymentOutputTypes, paymentOutputHexes,
      change, feeRate
    );

    if (result !== null) {
      return { selected, result };
    }
  }

  // ── Exhausted all coins within the limit ───────────────────────────────
  if (selected.length === 0) {
    throw new BuilderError('INSUFFICIENT_FUNDS', 'No UTXOs available');
  }

  // Distinguish: was it the max_inputs limit or genuinely insufficient funds?
  if (maxInputs !== undefined && selected.length >= limit && limit < sortedUtxos.length) {
    throw new BuilderError(
      'MAX_INPUTS_EXCEEDED',
      `Cannot cover payments + fee within ${limit} inputs (selected ${inputSum} sats from ${selected.length} inputs, need at least ${paymentSum} + fee)`
    );
  }

  throw new BuilderError(
    'INSUFFICIENT_FUNDS',
    `Selected ${selected.length} inputs (${inputSum} sats) cannot cover payments (${paymentSum}) + fee`
  );
}
