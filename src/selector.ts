// ──────────────────────────────────────────────────────────────────────────
// selector.ts — Deterministic coin selection (greedy largest-first)
// ──────────────────────────────────────────────────────────────────────────

import { UTXO, BuilderError } from './types';

/**
 * Sort UTXOs deterministically:
 *  1. Descending by value_sats (prefer larger coins)
 *  2. Ascending by txid (lexicographic tiebreaker)
 *  3. Ascending by vout (secondary tiebreaker)
 */
function sortUTXOs(utxos: UTXO[]): UTXO[] {
  return [...utxos].sort((a, b) => {
    if (b.value_sats !== a.value_sats) return b.value_sats - a.value_sats;
    if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;
    return a.vout - b.vout;
  });
}

/**
 * Select UTXOs to cover the target amount.
 *
 * Strategy: Greedy largest-first.
 * - Sort UTXOs descending by value
 * - Select until cumulative >= target OR max_inputs reached
 * - If target not met, throw INSUFFICIENT_FUNDS
 *
 * @param utxos     Available UTXO pool
 * @param target    Minimum value to cover (payments + estimated fee)
 * @param maxInputs Maximum number of inputs allowed (from policy)
 * @returns         Selected UTXOs in deterministic order
 */
export function selectCoins(
  utxos: UTXO[],
  target: number,
  maxInputs?: number
): UTXO[] {
  const sorted = sortUTXOs(utxos);
  const limit = maxInputs ?? sorted.length;
  const selected: UTXO[] = [];
  let sum = 0;

  for (const utxo of sorted) {
    if (selected.length >= limit) break;
    selected.push(utxo);
    sum += utxo.value_sats;
    if (sum >= target) break;
  }

  if (sum < target) {
    // Check if it's a max_inputs problem or total funds problem
    const totalPool = utxos.reduce((s, u) => s + u.value_sats, 0);
    if (totalPool < target) {
      throw new BuilderError(
        'INSUFFICIENT_FUNDS',
        `Total UTXO pool (${totalPool} sats) is less than required (${target} sats)`
      );
    } else {
      throw new BuilderError(
        'INSUFFICIENT_FUNDS',
        `Cannot cover ${target} sats within ${limit} inputs (selected ${sum} sats from ${selected.length} inputs)`
      );
    }
  }

  return selected;
}

export { sortUTXOs };
