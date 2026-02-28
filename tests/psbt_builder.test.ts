// ──────────────────────────────────────────────────────────────────────────
// tests/psbt_builder.test.ts — Unit tests for PSBT construction
// ──────────────────────────────────────────────────────────────────────────

import { buildPSBT, getNetwork } from '../src/psbt_builder';
import { UTXO, Payment, ChangeTemplate } from '../src/types';
import * as bitcoin from 'bitcoinjs-lib';

const makeUTXO = (scriptType: string = 'p2wpkh'): UTXO => ({
  txid: '1111111111111111111111111111111111111111111111111111111111111111',
  vout: 0,
  value_sats: 100000,
  script_pubkey_hex: scriptType === 'p2wpkh'
    ? '00141111111111111111111111111111111111111111'
    : scriptType === 'p2tr'
    ? '51201111111111111111111111111111111111111111111111111111111111111111'
    : scriptType === 'p2pkh'
    ? '76a914111111111111111111111111111111111111111188ac'
    : '00141111111111111111111111111111111111111111',
  script_type: scriptType as any,
  address: 'bc1test',
});

const makePayment = (): Payment => ({
  address: 'bc1pay',
  script_pubkey_hex: '00142222222222222222222222222222222222222222',
  script_type: 'p2wpkh',
  value_sats: 70000,
});

const makeChange = (): ChangeTemplate => ({
  address: 'bc1change',
  script_pubkey_hex: '00143333333333333333333333333333333333333333',
  script_type: 'p2wpkh',
});

describe('PSBT Builder', () => {
  test('produces valid base64 PSBT with magic bytes', () => {
    const psbt = buildPSBT(
      [makeUTXO()],
      [makePayment()],
      makeChange(),
      29000,
      0xffffffff,
      0,
      bitcoin.networks.bitcoin
    );
    expect(typeof psbt).toBe('string');
    // Decode base64 and check magic bytes
    const buf = Buffer.from(psbt, 'base64');
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff');
  });

  test('PSBT can be parsed back', () => {
    const psbt64 = buildPSBT(
      [makeUTXO()],
      [makePayment()],
      makeChange(),
      29000,
      0xffffffff,
      0,
      bitcoin.networks.bitcoin
    );
    const psbt = bitcoin.Psbt.fromBase64(psbt64);
    expect(psbt.txInputs.length).toBe(1);
    expect(psbt.txOutputs.length).toBe(2); // payment + change
  });

  test('PSBT with no change output', () => {
    const psbt64 = buildPSBT(
      [makeUTXO()],
      [makePayment()],
      null,
      null,
      0xffffffff,
      0,
      bitcoin.networks.bitcoin
    );
    const psbt = bitcoin.Psbt.fromBase64(psbt64);
    expect(psbt.txOutputs.length).toBe(1); // payment only
  });

  test('PSBT sets correct nSequence', () => {
    const psbt64 = buildPSBT(
      [makeUTXO()],
      [makePayment()],
      null,
      null,
      0xfffffffd, // RBF
      850000,
      bitcoin.networks.bitcoin
    );
    const psbt = bitcoin.Psbt.fromBase64(psbt64);
    expect(psbt.txInputs[0].sequence).toBe(0xfffffffd);
  });

  test('PSBT sets correct nLockTime', () => {
    const psbt64 = buildPSBT(
      [makeUTXO()],
      [makePayment()],
      null,
      null,
      0xfffffffd,
      850000,
      bitcoin.networks.bitcoin
    );
    const psbt = bitcoin.Psbt.fromBase64(psbt64);
    expect(psbt.locktime).toBe(850000);
  });

  test('network resolution works correctly', () => {
    expect(getNetwork('mainnet')).toBe(bitcoin.networks.bitcoin);
    expect(getNetwork('testnet')).toBe(bitcoin.networks.testnet);
    expect(getNetwork('testnet4')).toBe(bitcoin.networks.testnet);
    expect(getNetwork('signet')).toBe(bitcoin.networks.testnet);
    expect(getNetwork('regtest')).toBe(bitcoin.networks.regtest);
    expect(getNetwork('unknown')).toBe(bitcoin.networks.bitcoin); // default
  });
});
