// ──────────────────────────────────────────────────────────────────────────
// tests/warnings.test.ts — Unit tests for warning detection
// ──────────────────────────────────────────────────────────────────────────

import { generateWarnings } from '../src/warnings';

describe('Warnings', () => {
  test('SEND_ALL warning when no change', () => {
    const w = generateWarnings({
      fee_sats: 500,
      fee_rate_sat_vb: 5,
      change_value: null,
      rbf_signaling: false,
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('SEND_ALL');
  });

  test('no SEND_ALL warning when change exists', () => {
    const w = generateWarnings({
      fee_sats: 500,
      fee_rate_sat_vb: 5,
      change_value: 1000,
      rbf_signaling: false,
    });
    const codes = w.map((x) => x.code);
    expect(codes).not.toContain('SEND_ALL');
  });

  test('HIGH_FEE when fee_sats > 1,000,000', () => {
    const w = generateWarnings({
      fee_sats: 1_500_000,
      fee_rate_sat_vb: 10,
      change_value: 50000,
      rbf_signaling: false,
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('HIGH_FEE');
  });

  test('HIGH_FEE when fee_rate > 200', () => {
    const w = generateWarnings({
      fee_sats: 50000,
      fee_rate_sat_vb: 250,
      change_value: 10000,
      rbf_signaling: false,
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('HIGH_FEE');
  });

  test('RBF_SIGNALING when rbf_signaling is true', () => {
    const w = generateWarnings({
      fee_sats: 500,
      fee_rate_sat_vb: 5,
      change_value: 1000,
      rbf_signaling: true,
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('RBF_SIGNALING');
  });

  test('DUST_CHANGE when change < 546', () => {
    const w = generateWarnings({
      fee_sats: 500,
      fee_rate_sat_vb: 5,
      change_value: 200,
      rbf_signaling: false,
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('DUST_CHANGE');
  });

  test('no warnings for normal transaction', () => {
    const w = generateWarnings({
      fee_sats: 500,
      fee_rate_sat_vb: 5,
      change_value: 10000,
      rbf_signaling: false,
    });
    expect(w.length).toBe(0);
  });
});
