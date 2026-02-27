// ──────────────────────────────────────────────────────────────────────────
// tests/rbf_locktime.test.ts — Unit tests for RBF/locktime module
// ──────────────────────────────────────────────────────────────────────────

import {
  computeRbfLocktime,
  SEQUENCE_RBF,
  SEQUENCE_LOCKTIME,
  SEQUENCE_FINAL,
  LOCKTIME_THRESHOLD,
} from '../src/rbf_locktime';

describe('RBF/Locktime', () => {
  // ── Row 1: rbf=false, no locktime ────────────────────────────────────
  test('rbf=false, no locktime → nSequence=0xFFFFFFFF, nLockTime=0', () => {
    const result = computeRbfLocktime(false, undefined, undefined);
    expect(result.nSequence).toBe(SEQUENCE_FINAL);
    expect(result.nLockTime).toBe(0);
    expect(result.locktime_type).toBe('none');
    expect(result.rbf_signaling).toBe(false);
  });

  // ── Row 2: rbf=false, locktime present ───────────────────────────────
  test('rbf=false, locktime=900000 → nSequence=0xFFFFFFFE, nLockTime=900000', () => {
    const result = computeRbfLocktime(false, 900000, undefined);
    expect(result.nSequence).toBe(SEQUENCE_LOCKTIME);
    expect(result.nLockTime).toBe(900000);
    expect(result.locktime_type).toBe('block_height');
    expect(result.rbf_signaling).toBe(false);
  });

  // ── Row 3: rbf=true, no locktime, current_height present ────────────
  test('rbf=true, no locktime, current_height=860000 → anti-fee-sniping', () => {
    const result = computeRbfLocktime(true, undefined, 860000);
    expect(result.nSequence).toBe(SEQUENCE_RBF);
    expect(result.nLockTime).toBe(860000); // anti-fee-sniping
    expect(result.locktime_type).toBe('block_height');
    expect(result.rbf_signaling).toBe(true);
  });

  // ── Row 4: rbf=true, locktime present ────────────────────────────────
  test('rbf=true, locktime=870000 → nSequence=0xFFFFFFFD, nLockTime=870000', () => {
    const result = computeRbfLocktime(true, 870000, undefined);
    expect(result.nSequence).toBe(SEQUENCE_RBF);
    expect(result.nLockTime).toBe(870000);
    expect(result.locktime_type).toBe('block_height');
    expect(result.rbf_signaling).toBe(true);
  });

  // ── Row 5: rbf=true, no locktime, no current_height ─────────────────
  test('rbf=true, no locktime, no current_height → nLockTime=0', () => {
    const result = computeRbfLocktime(true, undefined, undefined);
    expect(result.nSequence).toBe(SEQUENCE_RBF);
    expect(result.nLockTime).toBe(0);
    expect(result.locktime_type).toBe('none');
    expect(result.rbf_signaling).toBe(true);
  });

  // ── Locktime boundary tests ──────────────────────────────────────────
  test('locktime=499999999 → block_height', () => {
    const result = computeRbfLocktime(false, 499999999, undefined);
    expect(result.locktime_type).toBe('block_height');
  });

  test('locktime=500000000 → unix_timestamp', () => {
    const result = computeRbfLocktime(false, 500000000, undefined);
    expect(result.locktime_type).toBe('unix_timestamp');
  });

  test('locktime=1700000000 → unix_timestamp', () => {
    const result = computeRbfLocktime(false, 1700000000, undefined);
    expect(result.nLockTime).toBe(1700000000);
    expect(result.locktime_type).toBe('unix_timestamp');
  });

  // ── rbf absent treated as false ──────────────────────────────────────
  test('rbf=undefined treated as false', () => {
    const result = computeRbfLocktime(undefined, undefined, undefined);
    expect(result.nSequence).toBe(SEQUENCE_FINAL);
    expect(result.rbf_signaling).toBe(false);
  });

  // ── rbf=true with both locktime and current_height → locktime wins ──
  test('rbf=true + locktime + current_height → locktime takes precedence', () => {
    const result = computeRbfLocktime(true, 870000, 860000);
    expect(result.nLockTime).toBe(870000); // explicit locktime wins
    expect(result.nSequence).toBe(SEQUENCE_RBF);
  });

  // ── locktime=0 explicitly present edge cases ─────────────────────────
  test('locktime=0 explicitly, rbf=false → nSequence=0xFFFFFFFE (locktime enabled)', () => {
    const result = computeRbfLocktime(false, 0, undefined);
    expect(result.nSequence).toBe(SEQUENCE_LOCKTIME); // 0xFFFFFFFE, not 0xFFFFFFFF
    expect(result.nLockTime).toBe(0);
    expect(result.locktime_type).toBe('none');
    expect(result.rbf_signaling).toBe(false);
  });

  test('locktime=0 explicitly, rbf=true → nSequence=0xFFFFFFFD, nLockTime=0', () => {
    const result = computeRbfLocktime(true, 0, 860000);
    expect(result.nSequence).toBe(SEQUENCE_RBF); // 0xFFFFFFFD
    expect(result.nLockTime).toBe(0); // explicit locktime=0 wins over anti-fee-sniping
    expect(result.locktime_type).toBe('none');
    expect(result.rbf_signaling).toBe(true);
  });
});
