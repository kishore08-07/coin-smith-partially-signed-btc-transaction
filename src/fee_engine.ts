// ──────────────────────────────────────────────────────────────────────────
// fee_engine.ts — Two-pass fee/change calculation engine
// ──────────────────────────────────────────────────────────────────────────

import { UTXO, Payment, ChangeTemplate, ScriptType, FeeChangeResult, BuilderError } from './types';
import { estimateVbytes } from './weights';
import { sortUTXOs } from './selector';

/** Dust threshold in satoshis */
export const DUST_THRESHOLD = 546;

/**
 * Compute fee and change with an iterative two-pass algorithm.
 *
 * Critical insight: We cannot know the fee without knowing the inputs,
 * and we cannot know the inputs without knowing the fee. This chicken-and-egg
 * problem is solved by greedily adding coins one by one (largest first)
 * until coverage is achieved.
 *
 *  1. Sort UTXOs descending by value (deterministic tiebreaker)
 *  2. Add coins one by one; after each addition, check if coverage is met
 *  3. Once covered, decide if change is viable or SEND_ALL
 *  4. Adding a change output may increase fee, causing change to drop below dust
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

  // Build output types for payments
  const paymentOutputTypes: ScriptType[] = payments.map((p) => p.script_type);
  const paymentOutputHexes: string[] = payments.map((p) => p.script_pubkey_hex);

  // Sort UTXOs deterministically (shared sort from selector.ts — single source of truth)
  const sortedUtxos = sortUTXOs(utxos);

  const limit = maxInputs ?? sortedUtxos.length;
  const totalPool = utxos.reduce((s, u) => s + u.value_sats, 0);

  // If payment sum alone exceeds total pool, fail fast
  if (paymentSum > totalPool) {
    throw new BuilderError(
      'INSUFFICIENT_FUNDS',
      `Total UTXO pool (${totalPool} sats) cannot cover payments (${paymentSum} sats)`
    );
  }

  // ── Iterative greedy coin selection ────────────────────────────────────
  const selected: UTXO[] = [];
  let inputSum = 0;

  for (let i = 0; i < Math.min(sortedUtxos.length, limit); i++) {
    selected.push(sortedUtxos[i]);
    inputSum += sortedUtxos[i].value_sats;

    const inputTypes = selected.map((u) => u.script_type);

    // ── No-change fee estimate ─────────────────────────────────────────
    const vbytesNoChange = estimateVbytes(inputTypes, paymentOutputTypes, paymentOutputHexes);
    const feeNoChange = Math.ceil(vbytesNoChange * feeRate);

    if (inputSum < paymentSum + feeNoChange) {
      // Not enough yet, add more inputs
      continue;
    }

    // ── We can cover payments + fee. Decide on change. ─────────────────
    const leftover = inputSum - paymentSum - feeNoChange;

    if (leftover < DUST_THRESHOLD) {
      // SEND_ALL: leftover too small for change (or exactly 0)
      const actualFee = inputSum - paymentSum;
      return {
        selected,
        result: {
          fee_sats: actualFee,
          vbytes: vbytesNoChange,
          change_value: null,
          fee_rate_actual: actualFee / vbytesNoChange,
        },
      };
    }

    // ── With-change fee estimate ───────────────────────────────────────
    const allOutputTypes = [...paymentOutputTypes, change.script_type];
    const allOutputHexes = [...paymentOutputHexes, change.script_pubkey_hex];
    const vbytesWithChange = estimateVbytes(inputTypes, allOutputTypes, allOutputHexes);
    const feeWithChange = Math.ceil(vbytesWithChange * feeRate);
    const changeValue = inputSum - paymentSum - feeWithChange;

    if (changeValue >= DUST_THRESHOLD) {
      // Change is viable — use minimum fee
      return {
        selected,
        result: {
          fee_sats: feeWithChange,
          vbytes: vbytesWithChange,
          change_value: changeValue,
          fee_rate_actual: feeWithChange / vbytesWithChange,
        },
      };
    }

    // Change dropped below dust after accounting for change output weight.
    // Absorb the full leftover as fee (SEND_ALL).
    const actualFee = inputSum - paymentSum;
    return {
      selected,
      result: {
        fee_sats: actualFee,
        vbytes: vbytesNoChange,
        change_value: null,
        fee_rate_actual: actualFee / vbytesNoChange,
      },
    };
  }

  // Exhausted all coins (within limit) but still can't cover
  if (selected.length === 0) {
    throw new BuilderError('INSUFFICIENT_FUNDS', 'No UTXOs available');
  }

  // Final check: maybe the last addition actually covers
  const inputTypes = selected.map((u) => u.script_type);
  const vbytesNoChange = estimateVbytes(inputTypes, paymentOutputTypes, paymentOutputHexes);
  const feeNoChange = Math.ceil(vbytesNoChange * feeRate);

  if (inputSum >= paymentSum + feeNoChange) {
    const leftover = inputSum - paymentSum - feeNoChange;
    if (leftover < DUST_THRESHOLD) {
      return {
        selected,
        result: {
          fee_sats: inputSum - paymentSum,
          vbytes: vbytesNoChange,
          change_value: null,
          fee_rate_actual: (inputSum - paymentSum) / vbytesNoChange,
        },
      };
    }
    const allOutputTypes = [...paymentOutputTypes, change.script_type];
    const allOutputHexes = [...paymentOutputHexes, change.script_pubkey_hex];
    const vbytesWithChange = estimateVbytes(inputTypes, allOutputTypes, allOutputHexes);
    const feeWithChange = Math.ceil(vbytesWithChange * feeRate);
    const changeValue = inputSum - paymentSum - feeWithChange;
    if (changeValue >= DUST_THRESHOLD) {
      return {
        selected,
        result: {
          fee_sats: feeWithChange,
          vbytes: vbytesWithChange,
          change_value: changeValue,
          fee_rate_actual: feeWithChange / vbytesWithChange,
        },
      };
    }
    return {
      selected,
      result: {
        fee_sats: inputSum - paymentSum,
        vbytes: vbytesNoChange,
        change_value: null,
        fee_rate_actual: (inputSum - paymentSum) / vbytesNoChange,
      },
    };
  }

  throw new BuilderError(
    'INSUFFICIENT_FUNDS',
    `Selected ${selected.length} inputs (${inputSum} sats) cannot cover payments (${paymentSum}) + fee (${feeNoChange})`
  );
}
