// ──────────────────────────────────────────────────────────────────────────
// rbf_locktime.ts — RBF and locktime computation (5-row interaction matrix)
// ──────────────────────────────────────────────────────────────────────────

import { RbfLocktimeResult } from './types';

/** nSequence value for RBF signaling (BIP-125) */
export const SEQUENCE_RBF = 0xfffffffd;

/** nSequence value for locktime-enabled without RBF */
export const SEQUENCE_LOCKTIME = 0xfffffffe;

/** nSequence value for finalized (no RBF, no locktime) */
export const SEQUENCE_FINAL = 0xffffffff;

/** Locktime threshold: values below are block heights, at or above are unix timestamps */
export const LOCKTIME_THRESHOLD = 500_000_000;

/**
 * Compute nSequence, nLockTime, locktime_type, and rbf_signaling
 * based on the fixture's rbf, locktime, and current_height fields.
 *
 * Interaction matrix (from README):
 *
 * | rbf      | locktime present | current_height | nSequence  | nLockTime      |
 * |----------|-----------------|----------------|------------|----------------|
 * | false/no | no              | —              | 0xFFFFFFFF | 0              |
 * | false/no | yes             | —              | 0xFFFFFFFE | locktime       |
 * | true     | no              | yes            | 0xFFFFFFFD | current_height |
 * | true     | yes             | —              | 0xFFFFFFFD | locktime       |
 * | true     | no              | no             | 0xFFFFFFFD | 0              |
 */
export function computeRbfLocktime(
  rbf?: boolean,
  locktime?: number,
  currentHeight?: number
): RbfLocktimeResult {
  const rbfEnabled = rbf === true;
  const locktimePresent = locktime !== undefined && locktime !== null;
  const heightPresent = currentHeight !== undefined && currentHeight !== null;

  // ── Compute nLockTime ──────────────────────────────────────────────────
  let nLockTime: number;
  if (locktimePresent) {
    nLockTime = locktime!;
  } else if (rbfEnabled && heightPresent) {
    // Anti-fee-sniping: set nLockTime to current chain tip height
    nLockTime = currentHeight!;
  } else {
    nLockTime = 0;
  }

  // ── Compute nSequence ──────────────────────────────────────────────────
  // Per interaction matrix: if locktime field is present (even if value is 0), enable locktime
  let nSequence: number;
  if (rbfEnabled) {
    nSequence = SEQUENCE_RBF; // 0xFFFFFFFD
  } else if (locktimePresent) {
    nSequence = SEQUENCE_LOCKTIME; // 0xFFFFFFFE — enables locktime without RBF
  } else {
    nSequence = SEQUENCE_FINAL; // 0xFFFFFFFF
  }

  // ── Classify locktime type ─────────────────────────────────────────────
  let locktime_type: 'none' | 'block_height' | 'unix_timestamp';
  if (nLockTime === 0) {
    locktime_type = 'none';
  } else if (nLockTime < LOCKTIME_THRESHOLD) {
    locktime_type = 'block_height';
  } else {
    locktime_type = 'unix_timestamp';
  }

  // ── RBF signaling ──────────────────────────────────────────────────────
  // A transaction signals RBF if any input has nSequence <= 0xFFFFFFFD
  const rbf_signaling = nSequence <= SEQUENCE_RBF;

  return {
    nSequence,
    nLockTime,
    locktime_type,
    rbf_signaling,
  };
}
