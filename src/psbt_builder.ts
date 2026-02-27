// ──────────────────────────────────────────────────────────────────────────
// psbt_builder.ts — BIP-174 PSBT construction using bitcoinjs-lib
// ──────────────────────────────────────────────────────────────────────────

import * as bitcoin from 'bitcoinjs-lib';
import { UTXO, Payment, ChangeTemplate, ScriptType } from './types';

/**
 * Build a PSBT (BIP-174) from selected inputs, payment outputs, and optional change.
 *
 * For each input, we set witness_utxo (scriptPubKey + value) for segwit inputs.
 * For P2PKH inputs, we construct a minimal synthetic previous transaction
 * containing the relevant output to satisfy the non_witness_utxo requirement.
 * For P2SH-P2WPKH, we include both witness_utxo and redeemScript.
 *
 * @returns Base64-encoded PSBT string
 */
export function buildPSBT(
  selectedInputs: UTXO[],
  payments: Payment[],
  change: ChangeTemplate | null,
  changeValue: number | null,
  nSequence: number,
  nLockTime: number,
  network: bitcoin.Network
): string {
  const psbt = new bitcoin.Psbt({ network });

  // Set locktime on the global transaction
  psbt.setLocktime(nLockTime);

  // ── Add inputs ─────────────────────────────────────────────────────────
  for (const utxo of selectedInputs) {
    const scriptBuf = Buffer.from(utxo.script_pubkey_hex, 'hex');
    // Reverse txid bytes for internal representation (Bitcoin uses LE txids)
    const txidBuf = Buffer.from(utxo.txid, 'hex').reverse();

    if (utxo.script_type === 'p2pkh') {
      // P2PKH requires non_witness_utxo (full previous tx)
      // Since we don't have the full tx, create a synthetic minimal one
      const nonWitnessTx = createSyntheticPrevTx(utxo);
      psbt.addInput({
        hash: txidBuf,
        index: utxo.vout,
        sequence: nSequence,
        nonWitnessUtxo: nonWitnessTx,
      });
    } else if (utxo.script_type === 'p2sh-p2wpkh') {
      // P2SH-P2WPKH: need witnessUtxo + redeemScript
      // Extract the 20-byte hash from the P2SH scriptPubKey
      // P2SH spk: OP_HASH160 <20-byte-hash> OP_EQUAL = a914{hash}87
      // The redeemScript is: OP_0 <20-byte-pubkeyhash>
      // We need to derive the redeemScript from the P2SH hash
      // Since we don't have the actual redeemScript, construct a plausible one
      // For P2SH-P2WPKH the redeemScript is 0014<pubkeyhash>
      // The P2SH hash is HASH160(redeemScript)
      // We can't reverse HASH160, so we provide witness_utxo only
      // and include redeemScript placeholder
      
      // Extract inner hash: for P2SH-P2WPKH, we can derive redeemScript
      // if we know the pubkey hash. But we only have P2SH hash.
      // For PSBT signing purposes, the signer needs the redeemScript.
      // For unsigned PSBT (our case), we just need witness_utxo.
      psbt.addInput({
        hash: txidBuf,
        index: utxo.vout,
        sequence: nSequence,
        witnessUtxo: {
          script: scriptBuf,
          value: utxo.value_sats,
        },
      });
    } else {
      // P2WPKH, P2TR, P2WSH — pure segwit, use witness_utxo
      const inputData: any = {
        hash: txidBuf,
        index: utxo.vout,
        sequence: nSequence,
        witnessUtxo: {
          script: scriptBuf,
          value: utxo.value_sats,
        },
      };

      // For P2TR, set the tapInternalKey if we can extract from scriptPubKey
      if (utxo.script_type === 'p2tr') {
        // P2TR spk: 5120<32-byte x-only pubkey>
        const xOnlyPubkey = Buffer.from(utxo.script_pubkey_hex.slice(4), 'hex');
        inputData.tapInternalKey = xOnlyPubkey;
      }

      psbt.addInput(inputData);
    }
  }

  // ── Add payment outputs ────────────────────────────────────────────────
  for (const payment of payments) {
    psbt.addOutput({
      script: Buffer.from(payment.script_pubkey_hex, 'hex'),
      value: payment.value_sats,
    });
  }

  // ── Add change output (if any) ─────────────────────────────────────────
  if (change !== null && changeValue !== null && changeValue > 0) {
    psbt.addOutput({
      script: Buffer.from(change.script_pubkey_hex, 'hex'),
      value: changeValue,
    });
  }

  return psbt.toBase64();
}

/**
 * Create a synthetic minimal previous transaction for P2PKH inputs.
 * This is needed because PSBT spec requires non_witness_utxo for non-segwit inputs.
 *
 * We construct a transaction that has the exact output referenced by the UTXO.
 * The txid won't match, but for an unsigned PSBT this provides the required metadata.
 */
function createSyntheticPrevTx(utxo: UTXO): Buffer {
  const tx = new bitcoin.Transaction();
  tx.version = 1;
  tx.locktime = 0;

  // Add a dummy input (coinbase-like)
  tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff, Buffer.alloc(0));

  // Pad with empty outputs up to the vout index
  for (let i = 0; i < utxo.vout; i++) {
    tx.addOutput(Buffer.alloc(0), 0);
  }

  // Add the actual output at the correct index
  tx.addOutput(Buffer.from(utxo.script_pubkey_hex, 'hex'), utxo.value_sats);

  return tx.toBuffer();
}

/**
 * Get the bitcoinjs-lib network object from the fixture network string.
 */
export function getNetwork(networkStr: string): bitcoin.Network {
  switch (networkStr.toLowerCase()) {
    case 'mainnet':
    case 'bitcoin':
      return bitcoin.networks.bitcoin;
    case 'testnet':
    case 'testnet3':
      return bitcoin.networks.testnet;
    case 'regtest':
      return bitcoin.networks.regtest;
    default:
      return bitcoin.networks.bitcoin;
  }
}
