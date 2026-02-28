// ──────────────────────────────────────────────────────────────────────────
// tests/selector.test.ts — Unit tests for coin selection
// ──────────────────────────────────────────────────────────────────────────

import { selectCoins, sortUTXOs, sortByEffectiveValue, effectiveValue } from '../src/selector';
import { UTXO, BuilderError } from '../src/types';

function makeUTXO(value: number, txid?: string, vout = 0, scriptType: string = 'p2wpkh'): UTXO {
  const spkByType: Record<string, string> = {
    'p2wpkh': '00141111111111111111111111111111111111111111',
    'p2tr': '51201111111111111111111111111111111111111111111111111111111111111111',
    'p2pkh': '76a914111111111111111111111111111111111111111188ac',
    'p2sh-p2wpkh': 'a914111111111111111111111111111111111111111187',
  };
  return {
    txid: txid || 'a'.repeat(64),
    vout,
    value_sats: value,
    script_pubkey_hex: spkByType[scriptType] || spkByType['p2wpkh'],
    script_type: scriptType as any,
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

  test('respects max_inputs policy with MAX_INPUTS_EXCEEDED error', () => {
    const utxos = [makeUTXO(2000, 'a'.repeat(64)), makeUTXO(2000, 'b'.repeat(64)), makeUTXO(2000, 'c'.repeat(64))];
    // Each UTXO is 2000, target is 5000, need at least 3 inputs
    // But max_inputs is 2, so only 4000 available
    try {
      selectCoins(utxos, 5000, 2);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BuilderError);
      expect((e as BuilderError).code).toBe('MAX_INPUTS_EXCEEDED');
    }
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

describe('Effective Value Sorting', () => {
  test('P2TR has higher effective value than P2WPKH at same nominal value', () => {
    const p2tr = makeUTXO(60000, 'a'.repeat(64), 0, 'p2tr');
    const p2wpkh = makeUTXO(60000, 'b'.repeat(64), 0, 'p2wpkh');
    // P2TR: 58 vbytes, P2WPKH: 68 vbytes at 5 sat/vB
    expect(effectiveValue(p2tr, 5)).toBeGreaterThan(effectiveValue(p2wpkh, 5));
  });

  test('P2WPKH has higher effective value than P2PKH at same nominal value', () => {
    const p2wpkh = makeUTXO(60000, 'a'.repeat(64), 0, 'p2wpkh');
    const p2pkh = makeUTXO(60000, 'b'.repeat(64), 0, 'p2pkh');
    // P2WPKH: 68 vbytes, P2PKH: 148 vbytes
    expect(effectiveValue(p2wpkh, 5)).toBeGreaterThan(effectiveValue(p2pkh, 5));
  });

  test('sortByEffectiveValue prefers cheaper-to-spend at equal nominal value', () => {
    const utxos = [
      makeUTXO(50000, 'c'.repeat(64), 0, 'p2pkh'),
      makeUTXO(50000, 'a'.repeat(64), 0, 'p2tr'),
      makeUTXO(50000, 'b'.repeat(64), 0, 'p2wpkh'),
    ];
    const sorted = sortByEffectiveValue(utxos, 5);
    expect(sorted[0].script_type).toBe('p2tr');     // cheapest
    expect(sorted[1].script_type).toBe('p2wpkh');   // middle
    expect(sorted[2].script_type).toBe('p2pkh');     // most expensive
  });

  test('higher nominal value wins over cheaper script type', () => {
    const utxos = [
      makeUTXO(100000, 'a'.repeat(64), 0, 'p2pkh'),   // expensive but large
      makeUTXO(30000, 'b'.repeat(64), 0, 'p2tr'),     // cheap but small
    ];
    const sorted = sortByEffectiveValue(utxos, 5);
    // P2PKH: 100000 - 148*5 = 99260
    // P2TR: 30000 - 58*5 = 29710
    expect(sorted[0].value_sats).toBe(100000);
    expect(sorted[1].value_sats).toBe(30000);
  });

  test('negative effective value UTXOs are sorted last', () => {
    const utxos = [
      makeUTXO(100, 'a'.repeat(64), 0, 'p2pkh'),  // effective: 100 - 148*50 = -7300
      makeUTXO(5000, 'b'.repeat(64), 0, 'p2wpkh'), // effective: 5000 - 68*50 = 1600
    ];
    const sorted = sortByEffectiveValue(utxos, 50);
    expect(sorted[0].value_sats).toBe(5000);  // positive first
    expect(sorted[1].value_sats).toBe(100);   // negative last
  });
});
