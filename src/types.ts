// ──────────────────────────────────────────────────────────────────────────
// types.ts — Core type definitions for Coin Smith PSBT builder
// ──────────────────────────────────────────────────────────────────────────

/** Supported Bitcoin script types */
export type ScriptType = 'p2wpkh' | 'p2tr' | 'p2pkh' | 'p2sh-p2wpkh' | 'p2wsh';

/** A UTXO from the fixture */
export interface UTXO {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_type: ScriptType;
  address?: string;
}

/** A payment output from the fixture */
export interface Payment {
  address?: string;
  script_pubkey_hex: string;
  script_type: ScriptType;
  value_sats: number;
}

/** Change template from the fixture */
export interface ChangeTemplate {
  address?: string;
  script_pubkey_hex: string;
  script_type: ScriptType;
}

/** Policy constraints */
export interface Policy {
  max_inputs?: number;
}

/** Complete fixture input */
export interface Fixture {
  network: string;
  utxos: UTXO[];
  payments: Payment[];
  change: ChangeTemplate;
  fee_rate_sat_vb: number;
  rbf?: boolean;
  locktime?: number;
  current_height?: number;
  policy?: Policy;
  [key: string]: unknown; // Allow extra fields
}

/** Output in the report */
export interface ReportOutput {
  n: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_type: string;
  address: string;
  is_change: boolean;
}

/** Selected input in the report */
export interface SelectedInput {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_type: string;
  address: string;
}

/** Warning entry */
export interface Warning {
  code: string;
  message?: string;
}

/** Successful report output */
export interface SuccessReport {
  ok: true;
  network: string;
  strategy: string;
  selected_inputs: SelectedInput[];
  outputs: ReportOutput[];
  change_index: number | null;
  fee_sats: number;
  fee_rate_sat_vb: number;
  vbytes: number;
  rbf_signaling: boolean;
  locktime: number;
  locktime_type: 'none' | 'block_height' | 'unix_timestamp';
  psbt_base64: string;
  warnings: Warning[];
}

/** Error report output */
export interface ErrorReport {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

/** Union report type */
export type Report = SuccessReport | ErrorReport;

/** RBF/locktime computation result */
export interface RbfLocktimeResult {
  nSequence: number;
  nLockTime: number;
  locktime_type: 'none' | 'block_height' | 'unix_timestamp';
  rbf_signaling: boolean;
}

/** Fee/change computation result */
export interface FeeChangeResult {
  fee_sats: number;
  vbytes: number;
  change_value: number | null; // null means no change (SEND_ALL)
  fee_rate_actual: number;
}

/** Builder error with structured code */
export class BuilderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BuilderError';
  }
}
