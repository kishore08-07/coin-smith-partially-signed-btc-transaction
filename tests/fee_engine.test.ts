// ──────────────────────────────────────────────────────────────────────────
// tests/fee_engine.test.ts — Unit tests for fee/change engine
// ──────────────────────────────────────────────────────────────────────────

import { computeFeeAndChange, DUST_THRESHOLD, decideFeeChange } from '../src/fee_engine';
import { UTXO, Payment, ChangeTemplate, BuilderError } from '../src/types';

function makeUTXO(value: number, txid?: string): UTXO {
  return {
    txid: txid || 'a'.repeat(64),
    vout: 0,
    value_sats: value,
    script_pubkey_hex: '00141111111111111111111111111111111111111111',
    script_type: 'p2wpkh',
    address: 'bc1test',
  };
}

const DEFAULT_CHANGE: ChangeTemplate = {
  address: 'bc1change',
  script_pubkey_hex: '00142222222222222222222222222222222222222222',
  script_type: 'p2wpkh',
};

function makePayment(value: number): Payment {
  return {
    address: 'bc1pay',
    script_pubkey_hex: '00143333333333333333333333333333333333333333',
    script_type: 'p2wpkh',
    value_sats: value,
  };
}

describe('Fee/Change Engine', () => {
  test('creates change output when leftover is above dust', () => {
    // 100k input, 70k payment at 5 sat/vB
    const utxos = [makeUTXO(100000)];
    const payments = [makePayment(70000)];
    const { result } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5);

    expect(result.change_value).not.toBeNull();
    expect(result.change_value!).toBeGreaterThanOrEqual(DUST_THRESHOLD);
    // Balance check: 100000 = 70000 + change + fee
    expect(100000).toBe(70000 + result.change_value! + result.fee_sats);
  });

  test('SEND_ALL when change would be below dust', () => {
    // 10000 input, 9000 payment at 5 sat/vB
    // No-change fee ≈ 550 sats, leftover = 10000 - 9000 - 550 = 450 < 546
    const utxos = [makeUTXO(10000)];
    const payments = [makePayment(9000)];
    const { result } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5);

    expect(result.change_value).toBeNull(); // SEND_ALL
    expect(result.fee_sats).toBe(1000); // 10000 - 9000
  });

  test('fee meets target rate: fee >= ceil(vbytes * rate)', () => {
    const utxos = [makeUTXO(100000)];
    const payments = [makePayment(50000)];
    const feeRate = 10;
    const { result } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, feeRate);

    const minFee = Math.ceil(result.vbytes * feeRate);
    expect(result.fee_sats).toBeGreaterThanOrEqual(minFee);
  });

  test('balance equation holds: inputs = outputs + fee', () => {
    const utxos = [makeUTXO(50000, 'a'.repeat(64)), makeUTXO(30000, 'b'.repeat(64))];
    const payments = [makePayment(40000)];
    const { selected, result } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 3);

    const inputSum = selected.reduce((s, u) => s + u.value_sats, 0);
    const outputSum = 40000 + (result.change_value || 0);
    expect(inputSum).toBe(outputSum + result.fee_sats);
  });

  test('throws INSUFFICIENT_FUNDS when pool is too small', () => {
    const utxos = [makeUTXO(1000)];
    const payments = [makePayment(5000)];
    expect(() => computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5)).toThrow(BuilderError);
  });

  test('throws MAX_INPUTS_EXCEEDED when limit blocks coverage', () => {
    const utxos = [
      makeUTXO(3000, 'a'.repeat(64)),
      makeUTXO(3000, 'b'.repeat(64)),
      makeUTXO(3000, 'c'.repeat(64)),
    ];
    const payments = [makePayment(7000)];
    // Need all 3 inputs but max_inputs is 2
    try {
      computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5, 2);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BuilderError);
      expect((e as BuilderError).code).toBe('MAX_INPUTS_EXCEEDED');
    }
  });

  test('handles send-all where all inputs go to fee (tight margins)', () => {
    // 50000 input, 49400 payment at 5 sat/vB
    // fee ~= 550 for 1-in 1-out, leftover = 600 > 546 → might create change
    // But with change: fee ~= 705, leftover = 50000-49400-705 = -105 → no, leftover 600-155=~445 < 546
    const utxos = [makeUTXO(50000)];
    const payments = [makePayment(49400)];
    const { result } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5);

    // Balance check
    expect(50000).toBe(49400 + (result.change_value || 0) + result.fee_sats);
    // Either SEND_ALL or change >= 546
    if (result.change_value !== null) {
      expect(result.change_value).toBeGreaterThanOrEqual(DUST_THRESHOLD);
    }
  });

  test('prefers cheaper-to-spend inputs (P2TR over P2WPKH at same value)', () => {
    const utxos = [
      {
        txid: 'b'.repeat(64), vout: 0, value_sats: 60000,
        script_pubkey_hex: '00141111111111111111111111111111111111111111',
        script_type: 'p2wpkh' as const, address: 'bc1test',
      },
      {
        txid: 'a'.repeat(64), vout: 0, value_sats: 60000,
        script_pubkey_hex: '51201111111111111111111111111111111111111111111111111111111111111111',
        script_type: 'p2tr' as const, address: 'bc1ptest',
      },
    ];
    const payments = [makePayment(50000)];
    const { selected } = computeFeeAndChange(utxos, payments, DEFAULT_CHANGE, 5);
    // With effective-value sorting, P2TR should be selected first (cheaper to spend)
    expect(selected[0].script_type).toBe('p2tr');
  });
});

describe('decideFeeChange helper', () => {
  test('returns null when inputs cannot cover payments + fee', () => {
    const result = decideFeeChange(
      5000, 10000,
      ['p2wpkh'], ['p2wpkh'], ['00142222222222222222222222222222222222222222'],
      DEFAULT_CHANGE, 5
    );
    expect(result).toBeNull();
  });

  test('returns SEND_ALL when leftover < dust', () => {
    // inputSum covers payments + fee, but leftover is below dust threshold
    // Use feeRate=1 so feeNoChange is small (~110), leaving a small non-dust leftover impossible
    const result = decideFeeChange(
      10000, 9700,
      ['p2wpkh'], ['p2wpkh'], ['00142222222222222222222222222222222222222222'],
      DEFAULT_CHANGE, 1
    );
    expect(result).not.toBeNull();
    expect(result!.change_value).toBeNull();
    expect(result!.fee_sats).toBe(300); // 10000 - 9700
  });

  test('returns change when leftover is viable', () => {
    const result = decideFeeChange(
      100000, 70000,
      ['p2wpkh'], ['p2wpkh'], ['00142222222222222222222222222222222222222222'],
      DEFAULT_CHANGE, 5
    );
    expect(result).not.toBeNull();
    expect(result!.change_value).not.toBeNull();
    expect(result!.change_value!).toBeGreaterThanOrEqual(DUST_THRESHOLD);
    expect(100000).toBe(70000 + result!.change_value! + result!.fee_sats);
  });
});
