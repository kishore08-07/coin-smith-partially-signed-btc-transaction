// ──────────────────────────────────────────────────────────────────────────
// tests/parser.test.ts — Unit tests for fixture parser
// ──────────────────────────────────────────────────────────────────────────

import { parseFixture } from '../src/parser';
import { BuilderError } from '../src/types';

describe('Fixture Parser', () => {
  const validFixture = JSON.stringify({
    network: 'mainnet',
    utxos: [
      {
        txid: '1111111111111111111111111111111111111111111111111111111111111111',
        vout: 0,
        value_sats: 100000,
        script_pubkey_hex: '00141111111111111111111111111111111111111111',
        script_type: 'p2wpkh',
        address: 'bc1test',
      },
    ],
    payments: [
      {
        address: 'bc1pay',
        script_pubkey_hex: '00142222222222222222222222222222222222222222',
        script_type: 'p2wpkh',
        value_sats: 50000,
      },
    ],
    change: {
      address: 'bc1change',
      script_pubkey_hex: '00143333333333333333333333333333333333333333',
      script_type: 'p2wpkh',
    },
    fee_rate_sat_vb: 5,
  });

  test('parses valid fixture successfully', () => {
    const f = parseFixture(validFixture);
    expect(f.network).toBe('mainnet');
    expect(f.utxos.length).toBe(1);
    expect(f.payments.length).toBe(1);
    expect(f.fee_rate_sat_vb).toBe(5);
  });

  test('rejects invalid JSON', () => {
    expect(() => parseFixture('not json')).toThrow(BuilderError);
  });

  test('rejects missing utxos', () => {
    const bad = JSON.stringify({ network: 'mainnet', payments: [], change: {}, fee_rate_sat_vb: 1 });
    expect(() => parseFixture(bad)).toThrow(BuilderError);
  });

  test('rejects invalid txid', () => {
    const bad = JSON.stringify({
      network: 'mainnet',
      utxos: [{ txid: 'short', vout: 0, value_sats: 100, script_pubkey_hex: '0014aabb', script_type: 'p2wpkh' }],
      payments: [{ script_pubkey_hex: '0014ccdd', script_type: 'p2wpkh', value_sats: 50 }],
      change: { script_pubkey_hex: '0014eeff', script_type: 'p2wpkh' },
      fee_rate_sat_vb: 1,
    });
    expect(() => parseFixture(bad)).toThrow(BuilderError);
  });

  test('parses optional rbf and locktime fields', () => {
    const withOptional = JSON.stringify({
      ...JSON.parse(validFixture),
      rbf: true,
      locktime: 850000,
      current_height: 850000,
    });
    const f = parseFixture(withOptional);
    expect(f.rbf).toBe(true);
    expect(f.locktime).toBe(850000);
    expect(f.current_height).toBe(850000);
  });

  test('ignores extra unknown fields', () => {
    const withExtra = JSON.stringify({
      ...JSON.parse(validFixture),
      _internal_metadata: 'ignore me',
      version: 42,
    });
    const f = parseFixture(withExtra);
    expect(f.network).toBe('mainnet');
  });

  test('parses policy.max_inputs', () => {
    const withPolicy = JSON.stringify({
      ...JSON.parse(validFixture),
      policy: { max_inputs: 3 },
    });
    const f = parseFixture(withPolicy);
    expect(f.policy?.max_inputs).toBe(3);
  });

  test('deduplicates UTXOs with same txid:vout', () => {
    const fixture = {
      ...JSON.parse(validFixture),
      utxos: [
        { txid: '1'.repeat(64), vout: 0, value_sats: 100000, script_pubkey_hex: '00141111111111111111111111111111111111111111', script_type: 'p2wpkh' },
        { txid: '1'.repeat(64), vout: 0, value_sats: 100000, script_pubkey_hex: '00141111111111111111111111111111111111111111', script_type: 'p2wpkh' },
      ],
    };
    const f = parseFixture(JSON.stringify(fixture));
    expect(f.utxos.length).toBe(1);
  });

  test('cross-validates script_type against scriptPubKey (prefers inferred)', () => {
    const fixture = {
      ...JSON.parse(validFixture),
      utxos: [
        {
          txid: '1'.repeat(64),
          vout: 0,
          value_sats: 100000,
          script_pubkey_hex: '5120' + '11'.repeat(32),
          script_type: 'p2wpkh',
        },
      ],
    };
    const f = parseFixture(JSON.stringify(fixture));
    expect(f.utxos[0].script_type).toBe('p2tr');
  });

  test('rejects locktime outside uint32 range', () => {
    const bad1 = JSON.stringify({ ...JSON.parse(validFixture), locktime: -1 });
    expect(() => parseFixture(bad1)).toThrow(BuilderError);
    const bad2 = JSON.stringify({ ...JSON.parse(validFixture), locktime: 4294967296 });
    expect(() => parseFixture(bad2)).toThrow(BuilderError);
  });

  test('rejects vout outside uint32 range', () => {
    const fixture = {
      ...JSON.parse(validFixture),
      utxos: [
        { txid: '1'.repeat(64), vout: 4294967296, value_sats: 100000, script_pubkey_hex: '00141111111111111111111111111111111111111111', script_type: 'p2wpkh' },
      ],
    };
    expect(() => parseFixture(JSON.stringify(fixture))).toThrow(BuilderError);
  });

  test('accepts locktime: 0 as present (not undefined)', () => {
    const fixture = JSON.stringify({ ...JSON.parse(validFixture), locktime: 0 });
    const f = parseFixture(fixture);
    expect(f.locktime).toBe(0);
  });

  test('rejects NaN fee_rate_sat_vb', () => {
    const bad = JSON.stringify({ ...JSON.parse(validFixture), fee_rate_sat_vb: NaN });
    expect(() => parseFixture(bad)).toThrow(BuilderError);
  });

  test('rejects Infinity fee_rate_sat_vb', () => {
    const bad = JSON.stringify({ ...JSON.parse(validFixture), fee_rate_sat_vb: Infinity });
    expect(() => parseFixture(bad)).toThrow(BuilderError);
  });
});
