// ──────────────────────────────────────────────────────────────────────────
// tests/selector.test.ts — Unit tests for coin selection
// ──────────────────────────────────────────────────────────────────────────

import { selectCoins, sortUTXOs } from '../src/selector';
import { UTXO, BuilderError } from '../src/types';

function makeUTXO(value: number, txid?: string, vout = 0): UTXO {
  return {
    txid: txid || 'a'.repeat(64),
    vout,
    value_sats: value,
    script_pubkey_hex: '00141111111111111111111111111111111111111111',
    script_type: 'p2wpkh',
    address: 'bc1test',
  };
}

describe('Coin Selector', () => {
  test('selects minimum inputs to cover target (greedy largest-first)', () => {
    const utxos = [makeUTXO(5000, 'a'.repeat(64)), makeUTXO(10000, 'b'.repeat(64)), makeUTXO(3000, 'c'.repeat(64))];
    const selected = selectCoins(utxos, 8000);
    // Should select the 10000 UTXO first (largest), which covers 8000
    expect(selected.length).toBe(1);
    expect(selected[0].value_sats).toBe(10000);
  });

  test('selects multiple inputs when single is insufficient', () => {
    const utxos = [makeUTXO(5000, 'a'.repeat(64)), makeUTXO(4000, 'b'.repeat(64)), makeUTXO(3000, 'c'.repeat(64))];
    const selected = selectCoins(utxos, 8000);
    // 5000 + 4000 = 9000 >= 8000
    expect(selected.length).toBe(2);
  });

  test('respects max_inputs policy', () => {
    const utxos = [makeUTXO(2000, 'a'.repeat(64)), makeUTXO(2000, 'b'.repeat(64)), makeUTXO(2000, 'c'.repeat(64))];
    // Each UTXO is 2000, target is 5000, need at least 3 inputs
    // But max_inputs is 2, so only 4000 available
    expect(() => selectCoins(utxos, 5000, 2)).toThrow(BuilderError);
  });

  test('throws INSUFFICIENT_FUNDS when pool total < target', () => {
    const utxos = [makeUTXO(1000), makeUTXO(2000)];
    expect(() => selectCoins(utxos, 10000)).toThrow(BuilderError);
    try {
      selectCoins(utxos, 10000);
    } catch (e) {
      expect((e as BuilderError).code).toBe('INSUFFICIENT_FUNDS');
    }
  });

  test('sorts UTXOs deterministically: descending value, asc txid', () => {
    const utxos = [
      makeUTXO(1000, 'b'.repeat(64)),
      makeUTXO(3000, 'a'.repeat(64)),
      makeUTXO(3000, 'c'.repeat(64)),
      makeUTXO(2000, 'd'.repeat(64)),
    ];
    const sorted = sortUTXOs(utxos);
    expect(sorted[0].value_sats).toBe(3000);
    expect(sorted[0].txid).toBe('a'.repeat(64)); // same value, lower txid first
    expect(sorted[1].value_sats).toBe(3000);
    expect(sorted[1].txid).toBe('c'.repeat(64));
    expect(sorted[2].value_sats).toBe(2000);
    expect(sorted[3].value_sats).toBe(1000);
  });
});
