// ──────────────────────────────────────────────────────────────────────────
// weights.ts — Per-script-type vbyte weight estimation
// ──────────────────────────────────────────────────────────────────────────
//
// Bitcoin transaction weight is measured in weight units (WU).
// vbytes = ceil(weight / 4)
//
// Weight = base_size * 3 + total_size   (where base_size excludes witness data)
// Or equivalently: weight = non_witness_bytes * 4 + witness_bytes
//
// For estimating unsigned transaction size, we use expected
// signed sizes for each script type.
// ──────────────────────────────────────────────────────────────────────────

import { ScriptType } from './types';

/**
 * Input weight contribution per script type (in weight units).
 *
 * Each input has:
 *  - outpoint (txid + vout): 32 + 4 = 36 bytes
 *  - scriptSig length varint: 1 byte (for segwit pure, scriptSig is empty)
 *  - scriptSig: variable
 *  - nSequence: 4 bytes
 *
 * Non-witness portion of input (base): counted at 4x
 * Witness portion: counted at 1x
 */

/** Input weight in weight units */
interface InputWeight {
  /** Non-witness bytes for the input (outpoint + scriptSig + sequence) */
  nonWitness: number;
  /** Witness bytes for the input (witness stack items) */
  witness: number;
}

/**
 * Input sizes (in bytes) before witness discount.
 *
 * P2WPKH input:
 *   non-witness: 36 (outpoint) + 1 (scriptSig len = 0) + 0 (scriptSig) + 4 (nSequence) = 41
 *   witness: 1 (items count) + 1 (sig len) + 72 (sig avg) + 1 (pubkey len) + 33 (pubkey) = 108
 *
 * P2TR key-path input:
 *   non-witness: 36 + 1 + 0 + 4 = 41
 *   witness: 1 (items count) + 1 (sig len) + 64 (schnorr sig) = 66
 *   (sometimes 65 when sighash byte appended; we use 66 for safety)
 *
 * P2PKH input:
 *   non-witness: 36 + 1 (scriptSig len varint) + 107 (scriptSig: sig + pubkey) + 4 (nSequence) = 148
 *   witness: 0
 *
 * P2SH-P2WPKH input:
 *   non-witness: 36 + 1 (scriptSig len varint) + 23 (scriptSig: push of redeemScript) + 4 = 64
 *   witness: 1 + 1 + 72 + 1 + 33 = 108
 */
const INPUT_WEIGHTS: Record<ScriptType, InputWeight> = {
  'p2wpkh': { nonWitness: 41, witness: 108 },
  'p2tr': { nonWitness: 41, witness: 66 },
  'p2pkh': { nonWitness: 148, witness: 1 }, // 1 byte for empty witness stack in segwit txs
  'p2sh-p2wpkh': { nonWitness: 64, witness: 108 },
  'p2wsh': { nonWitness: 41, witness: 108 }, // approximation; varies with script
};

/**
 * Output sizes (in bytes) — no witness discount, counted at 4x in weight.
 *
 * Each output = 8 (value) + varint(scriptPubKey.len) + scriptPubKey
 *
 * P2WPKH: 8 + 1 + 22 = 31
 * P2TR: 8 + 1 + 34 = 43
 * P2PKH: 8 + 1 + 25 = 34
 * P2SH(-P2WPKH): 8 + 1 + 23 = 32
 * P2WSH: 8 + 1 + 34 = 43
 */
const OUTPUT_SIZES: Record<ScriptType, number> = {
  'p2wpkh': 31,
  'p2tr': 43,
  'p2pkh': 34,
  'p2sh-p2wpkh': 32,
  'p2wsh': 43,
};

/**
 * Fallback: compute output size from raw scriptPubKey hex length.
 * output_size = 8 (value) + compactSize(scriptPubKey.length) + scriptPubKey.length
 */
function outputSizeFromScript(scriptPubKeyHex: string): number {
  const scriptLen = scriptPubKeyHex.length / 2;
  const varIntLen = scriptLen < 0xfd ? 1 : scriptLen < 0xffff ? 3 : 5;
  return 8 + varIntLen + scriptLen;
}

/**
 * Get the output size for a given script type.
 * Falls back to computing from raw scriptPubKey hex.
 */
export function getOutputSize(scriptType: ScriptType, scriptPubKeyHex?: string): number {
  if (OUTPUT_SIZES[scriptType] !== undefined) {
    return OUTPUT_SIZES[scriptType];
  }
  if (scriptPubKeyHex) {
    return outputSizeFromScript(scriptPubKeyHex);
  }
  return 34; // safe default
}

/**
 * Compute the varint length for a count.
 */
function compactSizeLen(n: number): number {
  if (n < 0xfd) return 1;
  if (n < 0xffff) return 3;
  if (n < 0xffffffff) return 5;
  return 9;
}

/**
 * Estimate virtual bytes (vbytes) for a transaction.
 *
 * Transaction structure:
 *   [non-witness]
 *     version:     4 bytes
 *     vin count:   compactSize
 *     vin[]:       per-input non-witness bytes
 *     vout count:  compactSize
 *     vout[]:      per-output bytes
 *     locktime:    4 bytes
 *
 *   [witness] (if any segwit input)
 *     marker+flag: 2 bytes
 *     per-input witness data
 *
 * weight = non_witness_bytes * 4 + witness_bytes
 * vbytes = ceil(weight / 4)
 */
export function estimateVbytes(
  inputTypes: ScriptType[],
  outputTypes: ScriptType[],
  outputScriptHexes?: string[]
): number {
  const hasWitness = inputTypes.some(
    (t) => t === 'p2wpkh' || t === 'p2tr' || t === 'p2sh-p2wpkh' || t === 'p2wsh'
  );

  // Non-witness base bytes
  let nonWitnessBytes = 0;
  nonWitnessBytes += 4; // version
  nonWitnessBytes += compactSizeLen(inputTypes.length); // vin count
  for (const t of inputTypes) {
    nonWitnessBytes += INPUT_WEIGHTS[t]?.nonWitness ?? INPUT_WEIGHTS['p2wpkh'].nonWitness;
  }
  nonWitnessBytes += compactSizeLen(outputTypes.length); // vout count
  for (let i = 0; i < outputTypes.length; i++) {
    const t = outputTypes[i];
    const hex = outputScriptHexes ? outputScriptHexes[i] : undefined;
    nonWitnessBytes += getOutputSize(t, hex);
  }
  nonWitnessBytes += 4; // locktime

  // Witness bytes
  let witnessBytes = 0;
  if (hasWitness) {
    witnessBytes += 2; // segwit marker + flag
    for (const t of inputTypes) {
      witnessBytes += INPUT_WEIGHTS[t]?.witness ?? 0;
    }
  }

  // Weight = non_witness * 4 + witness
  const weight = nonWitnessBytes * 4 + witnessBytes;
  return Math.ceil(weight / 4);
}

/**
 * Get the per-input vbytes contribution for a script type.
 * Useful for estimating marginal cost of adding an input.
 */
export function inputVbytes(scriptType: ScriptType): number {
  const w = INPUT_WEIGHTS[scriptType] ?? INPUT_WEIGHTS['p2wpkh'];
  return Math.ceil((w.nonWitness * 4 + w.witness) / 4);
}

export { INPUT_WEIGHTS, OUTPUT_SIZES };
