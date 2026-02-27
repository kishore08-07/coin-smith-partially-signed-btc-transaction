// ──────────────────────────────────────────────────────────────────────────
// parser.ts — Defensive fixture parsing and validation
// ──────────────────────────────────────────────────────────────────────────

import { Fixture, UTXO, Payment, ChangeTemplate, ScriptType, BuilderError } from './types';

const VALID_SCRIPT_TYPES: ScriptType[] = ['p2wpkh', 'p2tr', 'p2pkh', 'p2sh-p2wpkh', 'p2wsh'];

/** Validate a hex string */
function isValidHex(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]*$/.test(s) && s.length > 0 && s.length % 2 === 0;
}

/** Validate a txid (64 hex chars) */
function isValidTxid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
}

/** Validate script type */
function isValidScriptType(s: unknown): s is ScriptType {
  return typeof s === 'string' && VALID_SCRIPT_TYPES.includes(s as ScriptType);
}

/** Infer script type from scriptPubKey hex (fallback) */
function inferScriptType(spk: string): ScriptType | null {
  const len = spk.length / 2; // byte length
  // P2WPKH: OP_0 <20-byte-hash> = 0014{40hex}
  if (len === 22 && spk.startsWith('0014')) return 'p2wpkh';
  // P2WSH: OP_0 <32-byte-hash> = 0020{64hex}
  if (len === 34 && spk.startsWith('0020')) return 'p2wsh';
  // P2TR: OP_1 <32-byte-key> = 5120{64hex}
  if (len === 34 && spk.startsWith('5120')) return 'p2tr';
  // P2PKH: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG = 76a914{40hex}88ac
  if (len === 25 && spk.startsWith('76a914') && spk.endsWith('88ac')) return 'p2pkh';
  // P2SH: OP_HASH160 <20-byte-hash> OP_EQUAL = a914{40hex}87
  if (len === 23 && spk.startsWith('a914') && spk.endsWith('87')) return 'p2sh-p2wpkh';
  return null;
}

/** Parse and validate a single UTXO */
function validateUTXO(u: Record<string, unknown>, index: number): UTXO {
  if (!isValidTxid(u.txid)) {
    throw new BuilderError('INVALID_FIXTURE', `utxos[${index}].txid is invalid or missing`);
  }
  if (typeof u.vout !== 'number' || !Number.isInteger(u.vout) || u.vout < 0 || u.vout > 0xFFFFFFFF) {
    throw new BuilderError('INVALID_FIXTURE', `utxos[${index}].vout must be a uint32 integer`);
  }
  if (typeof u.value_sats !== 'number' || !Number.isInteger(u.value_sats) || u.value_sats <= 0) {
    throw new BuilderError('INVALID_FIXTURE', `utxos[${index}].value_sats must be a positive integer`);
  }
  if (!isValidHex(u.script_pubkey_hex)) {
    throw new BuilderError('INVALID_FIXTURE', `utxos[${index}].script_pubkey_hex is invalid`);
  }

  // Determine script type: infer from scriptPubKey (authoritative per README) and cross-validate
  const spkLower = (u.script_pubkey_hex as string).toLowerCase();
  const inferred = inferScriptType(spkLower);
  let scriptType: ScriptType;
  if (isValidScriptType(u.script_type)) {
    // Cross-validate: scriptPubKey is authoritative; prefer inferred if it disagrees
    scriptType = inferred && inferred !== u.script_type ? inferred : u.script_type;
  } else if (inferred) {
    scriptType = inferred;
  } else {
    throw new BuilderError('INVALID_FIXTURE', `utxos[${index}].script_type is invalid: ${u.script_type}`);
  }

  return {
    txid: u.txid,
    vout: u.vout,
    value_sats: u.value_sats,
    script_pubkey_hex: spkLower,
    script_type: scriptType,
    address: typeof u.address === 'string' ? u.address : '',
  };
}

/** Parse and validate a single payment */
function validatePayment(p: Record<string, unknown>, index: number): Payment {
  if (!isValidHex(p.script_pubkey_hex)) {
    throw new BuilderError('INVALID_FIXTURE', `payments[${index}].script_pubkey_hex is invalid`);
  }
  if (typeof p.value_sats !== 'number' || !Number.isInteger(p.value_sats) || p.value_sats <= 0) {
    throw new BuilderError('INVALID_FIXTURE', `payments[${index}].value_sats must be a positive integer`);
  }

  // Determine script type: infer from scriptPubKey (authoritative) and cross-validate
  const spkLower = (p.script_pubkey_hex as string).toLowerCase();
  const inferred = inferScriptType(spkLower);
  let scriptType: ScriptType;
  if (isValidScriptType(p.script_type)) {
    scriptType = inferred && inferred !== p.script_type ? inferred : p.script_type;
  } else if (inferred) {
    scriptType = inferred;
  } else {
    throw new BuilderError('INVALID_FIXTURE', `payments[${index}].script_type is invalid: ${p.script_type}`);
  }

  return {
    address: typeof p.address === 'string' ? p.address : '',
    script_pubkey_hex: spkLower,
    script_type: scriptType,
    value_sats: p.value_sats,
  };
}

/** Parse and validate change template */
function validateChange(c: Record<string, unknown>): ChangeTemplate {
  if (!isValidHex(c.script_pubkey_hex)) {
    throw new BuilderError('INVALID_FIXTURE', 'change.script_pubkey_hex is invalid');
  }

  // Determine script type: infer from scriptPubKey (authoritative) and cross-validate
  const spkLower = (c.script_pubkey_hex as string).toLowerCase();
  const inferred = inferScriptType(spkLower);
  let scriptType: ScriptType;
  if (isValidScriptType(c.script_type)) {
    scriptType = inferred && inferred !== c.script_type ? inferred : c.script_type;
  } else if (inferred) {
    scriptType = inferred;
  } else {
    throw new BuilderError('INVALID_FIXTURE', `change.script_type is invalid: ${c.script_type}`);
  }

  return {
    address: typeof c.address === 'string' ? c.address : '',
    script_pubkey_hex: spkLower,
    script_type: scriptType,
  };
}

/** Parse raw JSON string into a validated Fixture */
export function parseFixture(jsonStr: string): Fixture {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonStr);
  } catch (e) {
    throw new BuilderError('INVALID_FIXTURE', 'Fixture is not valid JSON');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BuilderError('INVALID_FIXTURE', 'Fixture must be a JSON object');
  }

  // Network
  if (typeof raw.network !== 'string' || raw.network.length === 0) {
    throw new BuilderError('INVALID_FIXTURE', 'network must be a non-empty string');
  }

  // UTXOs
  if (!Array.isArray(raw.utxos) || raw.utxos.length === 0) {
    throw new BuilderError('INVALID_FIXTURE', 'utxos must be a non-empty array');
  }
  const rawUtxos = (raw.utxos as Record<string, unknown>[]).map((u, i) => validateUTXO(u, i));

  // Deduplicate UTXOs by txid:vout (keep first occurrence; prevents double-spend in PSBT)
  const seenUtxoKeys = new Set<string>();
  const utxos: UTXO[] = [];
  for (const u of rawUtxos) {
    const key = `${u.txid}:${u.vout}`;
    if (!seenUtxoKeys.has(key)) {
      seenUtxoKeys.add(key);
      utxos.push(u);
    }
  }

  // Payments
  if (!Array.isArray(raw.payments) || raw.payments.length === 0) {
    throw new BuilderError('INVALID_FIXTURE', 'payments must be a non-empty array');
  }
  const payments = (raw.payments as Record<string, unknown>[]).map((p, i) => validatePayment(p, i));

  // Change
  if (typeof raw.change !== 'object' || raw.change === null || Array.isArray(raw.change)) {
    throw new BuilderError('INVALID_FIXTURE', 'change must be an object');
  }
  const change = validateChange(raw.change as Record<string, unknown>);

  // Fee rate
  if (typeof raw.fee_rate_sat_vb !== 'number' || !isFinite(raw.fee_rate_sat_vb) || raw.fee_rate_sat_vb <= 0) {
    throw new BuilderError('INVALID_FIXTURE', 'fee_rate_sat_vb must be a finite positive number');
  }

  // Optional fields
  const rbf = typeof raw.rbf === 'boolean' ? raw.rbf : undefined;

  let locktime: number | undefined = undefined;
  if (typeof raw.locktime === 'number') {
    if (!Number.isInteger(raw.locktime) || raw.locktime < 0 || raw.locktime > 0xFFFFFFFF) {
      throw new BuilderError('INVALID_FIXTURE', 'locktime must be a uint32 integer (0 to 4294967295)');
    }
    locktime = raw.locktime;
  }

  let current_height: number | undefined = undefined;
  if (typeof raw.current_height === 'number') {
    if (!Number.isInteger(raw.current_height) || raw.current_height < 0 || raw.current_height > 0xFFFFFFFF) {
      throw new BuilderError('INVALID_FIXTURE', 'current_height must be a uint32 integer (0 to 4294967295)');
    }
    current_height = raw.current_height;
  }

  let policy: { max_inputs?: number } = {};
  if (typeof raw.policy === 'object' && raw.policy !== null && !Array.isArray(raw.policy)) {
    const p = raw.policy as Record<string, unknown>;
    if (typeof p.max_inputs === 'number' && Number.isInteger(p.max_inputs) && p.max_inputs > 0) {
      policy.max_inputs = p.max_inputs;
    }
  }

  return {
    network: raw.network as string,
    utxos,
    payments,
    change,
    fee_rate_sat_vb: raw.fee_rate_sat_vb as number,
    rbf,
    locktime,
    current_height,
    policy: Object.keys(policy).length > 0 ? policy : undefined,
  };
}
