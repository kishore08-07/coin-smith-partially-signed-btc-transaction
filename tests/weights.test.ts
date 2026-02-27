// ──────────────────────────────────────────────────────────────────────────
// tests/weights.test.ts — Unit tests for vbyte weight estimator
// ──────────────────────────────────────────────────────────────────────────

import { estimateVbytes, inputVbytes, getOutputSize, INPUT_WEIGHTS, OUTPUT_SIZES } from '../src/weights';
import { ScriptType } from '../src/types';

describe('Weight Estimator', () => {
  // ── Per-input vbytes ─────────────────────────────────────────────────
  test('P2WPKH input vbytes is 68', () => {
    const vb = inputVbytes('p2wpkh');
    expect(vb).toBe(68);
  });

  test('P2TR input vbytes is approximately 58', () => {
    const vb = inputVbytes('p2tr');
    // P2TR: nonWitness=41, witness=66 → weight=41*4+66=230 → vbytes=ceil(230/4)=58
    expect(vb).toBe(58);
  });

  test('P2PKH input vbytes is 148', () => {
    const vb = inputVbytes('p2pkh');
    // P2PKH: nonWitness=148, witness=0 → weight=148*4=592 → vbytes=148
    expect(vb).toBe(148);
  });

  test('P2SH-P2WPKH input vbytes is 91', () => {
    const vb = inputVbytes('p2sh-p2wpkh');
    // P2SH-P2WPKH: nonWitness=64, witness=108 → weight=64*4+108=364 → vbytes=91
    expect(vb).toBe(91);
  });

  // ── Per-output sizes ─────────────────────────────────────────────────
  test('P2WPKH output size is 31', () => {
    expect(getOutputSize('p2wpkh')).toBe(31);
  });

  test('P2TR output size is 43', () => {
    expect(getOutputSize('p2tr')).toBe(43);
  });

  test('P2PKH output size is 34', () => {
    expect(getOutputSize('p2pkh')).toBe(34);
  });

  // ── Full transaction estimates ───────────────────────────────────────
  test('1 P2WPKH input, 2 P2WPKH outputs yields correct vbytes', () => {
    const vbytes = estimateVbytes(['p2wpkh'], ['p2wpkh', 'p2wpkh']);
    // Non-witness: 4 + 1 + 41 + 1 + 31 + 31 + 4 = 113
    // Witness: 2 + 108 = 110
    // Weight: 113 * 4 + 110 = 562, vbytes = ceil(562/4) = 141
    expect(vbytes).toBe(141);
  });

  test('1 P2WPKH input, 1 P2WPKH output (no change)', () => {
    const vbytes = estimateVbytes(['p2wpkh'], ['p2wpkh']);
    // Non-witness: 4 + 1 + 41 + 1 + 31 + 4 = 82
    // Witness: 2 + 108 = 110
    // Weight: 82 * 4 + 110 = 438, vbytes = ceil(438/4) = 110
    expect(vbytes).toBe(110);
  });

  test('Mixed inputs: P2WPKH + P2TR, 1 P2WPKH output + 1 P2WPKH change', () => {
    const vbytes = estimateVbytes(['p2wpkh', 'p2tr'], ['p2wpkh', 'p2wpkh']);
    // Non-witness: 4 + 1 + (41+41) + 1 + (31+31) + 4 = 154
    // Witness: 2 + 108 + 66 = 176
    // Weight: 154*4 + 176 = 792, vbytes = ceil(792/4) = 198
    expect(vbytes).toBe(198);
  });

  test('P2PKH input (no witness), 1 P2WPKH output', () => {
    const vbytes = estimateVbytes(['p2pkh'], ['p2wpkh']);
    // No segwit witness (all inputs are legacy)
    // Non-witness: 4 + 1 + 148 + 1 + 31 + 4 = 189
    // Witness: 0 (no segwit inputs)
    // Weight: 189*4 = 756, vbytes = ceil(756/4) = 189
    expect(vbytes).toBe(189);
  });
});
