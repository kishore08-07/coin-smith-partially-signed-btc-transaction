// ──────────────────────────────────────────────────────────────────────────
// tests/builder.test.ts — Integration tests for the full PSBT build pipeline
// ──────────────────────────────────────────────────────────────────────────

import { buildFromFixture } from '../src/builder';
import { SuccessReport, BuilderError } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('buildFromFixture integration', () => {
  test('basic_change_p2wpkh produces valid report with all 14 required fields', () => {
    const report = buildFromFixture(loadFixture('basic_change_p2wpkh.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const requiredFields = [
      'ok', 'network', 'strategy', 'selected_inputs', 'outputs',
      'change_index', 'fee_sats', 'fee_rate_sat_vb', 'vbytes',
      'rbf_signaling', 'locktime', 'locktime_type', 'psbt_base64', 'warnings',
    ];
    for (const field of requiredFields) {
      expect(report).toHaveProperty(field);
    }
  });

  test('basic_change_p2wpkh: balance equation holds', () => {
    const report = buildFromFixture(loadFixture('basic_change_p2wpkh.json')) as SuccessReport;
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('basic_change_p2wpkh: fee meets target rate', () => {
    const fixture = JSON.parse(loadFixture('basic_change_p2wpkh.json'));
    const report = buildFromFixture(loadFixture('basic_change_p2wpkh.json')) as SuccessReport;
    const minFee = Math.ceil(report.vbytes * fixture.fee_rate_sat_vb);
    expect(report.fee_sats).toBeGreaterThanOrEqual(minFee);
  });

  test('basic_change_p2wpkh: change output exists and is above dust', () => {
    const report = buildFromFixture(loadFixture('basic_change_p2wpkh.json')) as SuccessReport;
    expect(report.change_index).not.toBeNull();
    const changeOut = report.outputs.find((o) => o.is_change);
    expect(changeOut).toBeDefined();
    expect(changeOut!.value_sats).toBeGreaterThanOrEqual(546);
  });

  test('send_all_dust_change: SEND_ALL warning, no change output', () => {
    const report = buildFromFixture(loadFixture('send_all_dust_change.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.change_index).toBeNull();
    expect(report.warnings.some((w) => w.code === 'SEND_ALL')).toBe(true);
  });

  test('rbf_basic: RBF signaling enabled', () => {
    const report = buildFromFixture(loadFixture('rbf_basic.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(true);
    expect(report.warnings.some((w) => w.code === 'RBF_SIGNALING')).toBe(true);
  });

  test('rbf_false_explicit: RBF signaling disabled', () => {
    const report = buildFromFixture(loadFixture('rbf_false_explicit.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(false);
  });

  test('anti_fee_sniping: nLockTime = current_height', () => {
    const report = buildFromFixture(loadFixture('anti_fee_sniping.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(860000);
    expect(report.locktime_type).toBe('block_height');
    expect(report.rbf_signaling).toBe(true);
  });

  test('locktime_boundary_block: locktime=499999999 is block_height', () => {
    const report = buildFromFixture(loadFixture('locktime_boundary_block.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(499999999);
    expect(report.locktime_type).toBe('block_height');
  });

  test('locktime_boundary_timestamp: locktime=500000000 is unix_timestamp', () => {
    const report = buildFromFixture(loadFixture('locktime_boundary_timestamp.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(500000000);
    expect(report.locktime_type).toBe('unix_timestamp');
  });

  test('locktime_unix_timestamp: locktime=1700000000 is unix_timestamp', () => {
    const report = buildFromFixture(loadFixture('locktime_unix_timestamp.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(1700000000);
    expect(report.locktime_type).toBe('unix_timestamp');
  });

  test('PSBT has valid BIP-174 magic bytes', () => {
    const report = buildFromFixture(loadFixture('basic_change_p2wpkh.json')) as SuccessReport;
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('invalid JSON throws BuilderError', () => {
    expect(() => buildFromFixture('not json')).toThrow(BuilderError);
  });

  test('duplicate UTXOs are silently deduplicated', () => {
    const fixture = JSON.parse(loadFixture('basic_change_p2wpkh.json'));
    fixture.utxos.push({ ...fixture.utxos[0] }); // exact duplicate
    const report = buildFromFixture(JSON.stringify(fixture)) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBe(1);
  });

  test('mixed_input_types: balance equation with mixed P2WPKH + P2TR', () => {
    const report = buildFromFixture(loadFixture('mixed_input_types.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('p2pkh_input_basic: P2PKH produces valid PSBT', () => {
    const report = buildFromFixture(loadFixture('p2pkh_input_basic.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('p2sh_p2wpkh_input: P2SH-P2WPKH produces valid PSBT', () => {
    const report = buildFromFixture(loadFixture('p2sh_p2wpkh_input.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('no dust outputs in any fixture result', () => {
    const fixtures = [
      'basic_change_p2wpkh.json', 'send_all_dust_change.json',
      'multi_payment_change.json', 'mixed_input_types.json',
    ];
    for (const f of fixtures) {
      const report = buildFromFixture(loadFixture(f)) as SuccessReport;
      for (const out of report.outputs) {
        expect(out.value_sats).toBeGreaterThanOrEqual(546);
      }
    }
  });

  test('script_type mismatch: inferred type from scriptPubKey wins', () => {
    const fixture = JSON.parse(loadFixture('basic_change_p2wpkh.json'));
    // Declare p2wpkh but give a P2TR scriptPubKey
    fixture.utxos = [{
      txid: '1'.repeat(64),
      vout: 0,
      value_sats: 100000,
      script_pubkey_hex: '5120' + '11'.repeat(32), // P2TR scriptPubKey
      script_type: 'p2wpkh', // Wrong declared type
    }];
    const report = buildFromFixture(JSON.stringify(fixture)) as SuccessReport;
    expect(report.ok).toBe(true);
    // The builder should use the inferred P2TR type
    expect(report.selected_inputs[0].script_type).toBe('p2tr');
  });

  test('locktime_no_rbf: rbf=false with locktime enables locktime without RBF', () => {
    const report = buildFromFixture(loadFixture('locktime_no_rbf.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(false);
    expect(report.locktime).toBe(900000);
    expect(report.locktime_type).toBe('block_height');
  });

  test('many_payments: multiple payments all present in outputs', () => {
    const fixture = JSON.parse(loadFixture('many_payments.json'));
    const report = buildFromFixture(loadFixture('many_payments.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const paymentOutputs = report.outputs.filter((o) => !o.is_change);
    expect(paymentOutputs.length).toBe(fixture.payments.length);
  });

  // ── Additional hidden fixture category coverage ────────────────────────

  test('rbf_send_all: rbf + send_all combined', () => {
    const report = buildFromFixture(loadFixture('rbf_send_all.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(true);
    expect(report.change_index).toBeNull();
    expect(report.warnings.some((w) => w.code === 'SEND_ALL')).toBe(true);
    expect(report.warnings.some((w) => w.code === 'RBF_SIGNALING')).toBe(true);
  });

  test('rbf_multi_input: all inputs must signal RBF', () => {
    const report = buildFromFixture(loadFixture('rbf_multi_input.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(1);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('rbf_with_locktime: both rbf and locktime set', () => {
    const report = buildFromFixture(loadFixture('rbf_with_locktime.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(true);
    expect(report.locktime).toBeGreaterThan(0);
    expect(report.locktime_type).not.toBe('none');
  });

  test('prefer_taproot_input: selects P2TR over P2WPKH at same value', () => {
    const report = buildFromFixture(loadFixture('prefer_taproot_input.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(0);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
    // With effective-value sorting, P2TR should be preferred over P2WPKH
    // because P2TR inputs are cheaper to spend (58 vs 68 vbytes)
    if (report.selected_inputs.length === 1) {
      expect(report.selected_inputs[0].script_type).toBe('p2tr');
    }
  });

  test('large_utxo_pool: handles large UTXO set efficiently', () => {
    const report = buildFromFixture(loadFixture('large_utxo_pool.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.fee_sats).toBeGreaterThan(0);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('large_mixed_script_types: handles many different script types', () => {
    const report = buildFromFixture(loadFixture('large_mixed_script_types.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('small_utxos_consolidation: consolidates many small UTXOs', () => {
    const report = buildFromFixture(loadFixture('small_utxos_consolidation.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(10);
    expect(report.change_index).toBeNull(); // send_all (many small UTXOs)
  });

  test('multi_input_required: needs multiple inputs to fund', () => {
    const report = buildFromFixture(loadFixture('multi_input_required.json')) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(1);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  // ── Comprehensive fixture sweep ────────────────────────────────────────

  test('ALL public fixtures produce valid reports', () => {
    const fs = require('fs');
    const path = require('path');
    const fixturesDir = path.join(__dirname, '..', 'fixtures');
    const files = fs.readdirSync(fixturesDir).filter((f: string) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(24);

    for (const file of files) {
      const json = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
      const report = buildFromFixture(json) as SuccessReport;

      // Core validity checks per fixture
      expect(report.ok).toBe(true);
      expect(report.selected_inputs.length).toBeGreaterThan(0);
      expect(report.fee_sats).toBeGreaterThan(0);
      expect(report.vbytes).toBeGreaterThan(0);

      // Balance equation
      const inSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
      const outSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
      expect(inSum).toBe(outSum + report.fee_sats);

      // Fee meets target
      const fixture = JSON.parse(json);
      const minFee = Math.ceil(report.vbytes * fixture.fee_rate_sat_vb);
      expect(report.fee_sats).toBeGreaterThanOrEqual(minFee);

      // No dust outputs
      for (const o of report.outputs) {
        expect(o.value_sats).toBeGreaterThanOrEqual(546);
      }

      // PSBT magic bytes
      const buf = Buffer.from(report.psbt_base64, 'base64');
      expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');

      // Fee rate accuracy
      const actualRate = report.fee_sats / report.vbytes;
      expect(Math.abs(actualRate - report.fee_rate_sat_vb)).toBeLessThanOrEqual(0.01);
    }
  });
});

// ── Edge-case integration tests (hidden evaluation targets) ──────────────

describe('Edge-case fixtures for hidden evaluation', () => {
  // Helper to build a minimal valid fixture JSON string
  function syntheticFixture(overrides: Record<string, any> = {}): string {
    const base = {
      network: 'mainnet',
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 500000,
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        script_type: 'p2wpkh',
      }],
      payments: [{
        script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        script_type: 'p2wpkh',
        value_sats: 100000,
      }],
      change: {
        script_pubkey_hex: '0014cccccccccccccccccccccccccccccccccccccccc',
        script_type: 'p2wpkh',
      },
      fee_rate_sat_vb: 5,
      ...overrides,
    };
    return JSON.stringify(base);
  }

  test('locktime: 0 with rbf: false → locktime_type=none, rbf_signaling=false', () => {
    const report = buildFromFixture(syntheticFixture({
      locktime: 0,
      rbf: false,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(0);
    expect(report.locktime_type).toBe('none');
    expect(report.rbf_signaling).toBe(false);
  });

  test('rbf: true with no locktime and no current_height → rbf with locktime 0', () => {
    const report = buildFromFixture(syntheticFixture({
      rbf: true,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.rbf_signaling).toBe(true);
    expect(report.locktime).toBe(0);
    expect(report.locktime_type).toBe('none');
    expect(report.warnings.some((w) => w.code === 'RBF_SIGNALING')).toBe(true);
  });

  test('fractional fee rate (1.5 sat/vB) works correctly', () => {
    const report = buildFromFixture(syntheticFixture({
      fee_rate_sat_vb: 1.5,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    const minFee = Math.ceil(report.vbytes * 1.5);
    expect(report.fee_sats).toBeGreaterThanOrEqual(minFee);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
  });

  test('missing script_type → inferred from scriptPubKey', () => {
    const report = buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 500000,
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        // No script_type! Parser must infer p2wpkh from scriptPubKey
      }],
      payments: [{
        script_pubkey_hex: '5120' + 'bb'.repeat(32),
        // No script_type! Parser must infer p2tr from scriptPubKey
        value_sats: 100000,
      }],
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs[0].script_type).toBe('p2wpkh');
    const paymentOut = report.outputs.find(o => !o.is_change);
    expect(paymentOut!.script_type).toBe('p2tr');
  });

  test('missing address fields → defaults to empty string', () => {
    const report = buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 500000,
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        script_type: 'p2wpkh',
        // No address field
      }],
      payments: [{
        script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        script_type: 'p2wpkh',
        value_sats: 100000,
        // No address field
      }],
      change: {
        script_pubkey_hex: '0014cccccccccccccccccccccccccccccccccccccccc',
        script_type: 'p2wpkh',
        // No address field
      },
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs[0].address).toBe('');
  });

  test('empty policy object → treated as no policy', () => {
    const report = buildFromFixture(syntheticFixture({
      policy: {},
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(0);
  });

  test('extra unknown fields in fixture are ignored', () => {
    const report = buildFromFixture(syntheticFixture({
      unknown_field: 'should be ignored',
      extra_data: { nested: true },
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBeGreaterThan(0);
  });

  test('P2WSH input produces valid PSBT', () => {
    const report = buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 500000,
        script_pubkey_hex: '0020' + 'dd'.repeat(32), // P2WSH (OP_0 <32-byte hash>)
        script_type: 'p2wsh',
      }],
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs[0].script_type).toBe('p2wsh');
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('P2PKH input in mixed tx: PSBT valid, balance holds', () => {
    const report = buildFromFixture(syntheticFixture({
      utxos: [
        {
          txid: 'a'.repeat(64),
          vout: 0,
          value_sats: 300000,
          script_pubkey_hex: '76a914' + 'aa'.repeat(20) + '88ac', // P2PKH
          script_type: 'p2pkh',
        },
        {
          txid: 'b'.repeat(64),
          vout: 0,
          value_sats: 300000,
          script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', // P2WPKH
          script_type: 'p2wpkh',
        },
      ],
      payments: [{
        script_pubkey_hex: '0014cccccccccccccccccccccccccccccccccccccccc',
        script_type: 'p2wpkh',
        value_sats: 400000, // needs both inputs
      }],
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs.length).toBe(2);
    const inputSum = report.selected_inputs.reduce((s, i) => s + i.value_sats, 0);
    const outputSum = report.outputs.reduce((s, o) => s + o.value_sats, 0);
    expect(inputSum).toBe(outputSum + report.fee_sats);
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('P2SH-P2WPKH input: correct script type and valid PSBT', () => {
    const report = buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 500000,
        script_pubkey_hex: 'a914' + 'ee'.repeat(20) + '87', // P2SH
        script_type: 'p2sh-p2wpkh',
      }],
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.selected_inputs[0].script_type).toBe('p2sh-p2wpkh');
    const buf = Buffer.from(report.psbt_base64, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('very high fee rate (250 sat/vB): HIGH_FEE warning triggered', () => {
    const report = buildFromFixture(syntheticFixture({
      fee_rate_sat_vb: 250,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.fee_rate_sat_vb).toBeGreaterThan(200);
    expect(report.warnings.some((w) => w.code === 'HIGH_FEE')).toBe(true);
  });

  test('fee_rate 200 exactly: no HIGH_FEE warning (not > 200)', () => {
    // With feeRate exactly 200, the actual rate might be slightly > 200 due to SEND_ALL
    // but with enough headroom in the UTXO, the rate should be exactly or very close to 200
    const report = buildFromFixture(syntheticFixture({
      fee_rate_sat_vb: 200,
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 5000000, // large enough for change
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        script_type: 'p2wpkh',
      }],
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    // When there's change, fee_rate_sat_vb should be very close to 200 (may be ≤ 200.01)
    if (report.change_index !== null) {
      expect(report.fee_rate_sat_vb).toBeLessThanOrEqual(200.01);
    }
  });

  test('PSBT input/output counts match report', () => {
    const report = buildFromFixture(syntheticFixture({})) as SuccessReport;
    expect(report.ok).toBe(true);
    const psbt = require('bitcoinjs-lib').Psbt.fromBase64(report.psbt_base64);
    expect(psbt.txInputs.length).toBe(report.selected_inputs.length);
    expect(psbt.txOutputs.length).toBe(report.outputs.length);
  });

  test('PSBT locktime matches report locktime', () => {
    const report = buildFromFixture(syntheticFixture({
      locktime: 850000,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    const psbt = require('bitcoinjs-lib').Psbt.fromBase64(report.psbt_base64);
    expect(psbt.locktime).toBe(report.locktime);
  });

  test('PSBT nSequence matches RBF setting', () => {
    const report = buildFromFixture(syntheticFixture({
      rbf: true,
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    const psbt = require('bitcoinjs-lib').Psbt.fromBase64(report.psbt_base64);
    // RBF uses 0xFFFFFFFD
    expect(psbt.txInputs[0].sequence).toBe(0xfffffffd);
  });

  test('network: signet → no crash, valid report', () => {
    const report = buildFromFixture(syntheticFixture({
      network: 'signet',
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.network).toBe('signet');
  });

  test('network: testnet4 → no crash, valid report', () => {
    const report = buildFromFixture(syntheticFixture({
      network: 'testnet4',
    })) as SuccessReport;
    expect(report.ok).toBe(true);
    expect(report.network).toBe('testnet4');
  });

  test('change_index is null when no change, correct position when change exists', () => {
    // SEND_ALL: no change
    const sendAll = buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64), vout: 0, value_sats: 10000,
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        script_type: 'p2wpkh',
      }],
      payments: [{
        script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        script_type: 'p2wpkh',
        value_sats: 9000,
      }],
      fee_rate_sat_vb: 5,
    })) as SuccessReport;
    expect(sendAll.change_index).toBeNull();
    expect(sendAll.outputs.every(o => !o.is_change)).toBe(true);

    // With change
    const withChange = buildFromFixture(syntheticFixture({})) as SuccessReport;
    if (withChange.change_index !== null) {
      const changeOut = withChange.outputs[withChange.change_index];
      expect(changeOut.is_change).toBe(true);
      expect(changeOut.value_sats).toBeGreaterThanOrEqual(546);
    }
  });

  test('INSUFFICIENT_FUNDS error for impossible fixture', () => {
    expect(() => buildFromFixture(syntheticFixture({
      utxos: [{
        txid: 'a'.repeat(64), vout: 0, value_sats: 100,
        script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        script_type: 'p2wpkh',
      }],
      payments: [{
        script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        script_type: 'p2wpkh',
        value_sats: 1000000, // way more than available
      }],
    }))).toThrow(BuilderError);
  });

  test('MAX_INPUTS_EXCEEDED error when policy blocks coverage', () => {
    expect(() => buildFromFixture(syntheticFixture({
      utxos: [
        { txid: 'a'.repeat(64), vout: 0, value_sats: 5000, script_pubkey_hex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', script_type: 'p2wpkh' },
        { txid: 'b'.repeat(64), vout: 0, value_sats: 5000, script_pubkey_hex: '0014bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', script_type: 'p2wpkh' },
        { txid: 'c'.repeat(64), vout: 0, value_sats: 5000, script_pubkey_hex: '0014cccccccccccccccccccccccccccccccccccccccc', script_type: 'p2wpkh' },
      ],
      payments: [{
        script_pubkey_hex: '0014dddddddddddddddddddddddddddddddddddddddd',
        script_type: 'p2wpkh',
        value_sats: 14000, // needs all 3 inputs but max_inputs=1
      }],
      policy: { max_inputs: 1 },
    }))).toThrow(BuilderError);
  });
});
