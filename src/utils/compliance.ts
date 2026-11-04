/**
 * `complianceMode: "fedramp"` — one switch that turns the server's
 * deployment posture into hard startup checks for FedRAMP and other
 * restricted environments (also appropriate for hardened self-hosted/CPSH).
 *
 * Enforced (startup fails with every violation listed):
 *   - every instance uses https and verifies certificates (no `insecure`; use tls.caFile)
 *   - no plaintext passwords (secret references only: env / file / keychain)
 *   - no external (non-Collibra) sources
 * Forced on:
 *   - the tamper-evident audit trail, including reads unless audit.logReads is false
 * Checked:
 *   - FIPS mode in Node's crypto (`node --enable-fips` with a FIPS-validated
 *     OpenSSL provider): a warning by default, an error with `requireFips: true`.
 */
import { getFips } from 'crypto';
import type { CollibraConfig } from '../types.js';

export const COMPLIANCE_MODES = ['fedramp'] as const;
export type ComplianceMode = (typeof COMPLIANCE_MODES)[number];

export interface ComplianceReport {
  errors: string[];
  warnings: string[];
}

export function fipsEnabled(): boolean {
  try {
    return getFips() === 1;
  } catch {
    return false;
  }
}

export function checkCompliance(config: CollibraConfig, plaintextPasswordInstances: string[]): ComplianceReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const mode = config.complianceMode;

  if (mode === undefined) {
    if (config.requireFips && !fipsEnabled()) {
      errors.push('requireFips is true but Node is not running in FIPS mode (start with --enable-fips and a FIPS-validated OpenSSL provider).');
    }
    return { errors, warnings };
  }
  if (!COMPLIANCE_MODES.includes(mode)) {
    return { errors: [`Unsupported complianceMode "${mode}". Use one of: ${COMPLIANCE_MODES.join(', ')}.`], warnings };
  }

  for (const i of config.instances) {
    if (!/^https:\/\//i.test(i.baseUrl)) errors.push(`Instance "${i.name}": baseUrl must use https.`);
    if (i.insecure) errors.push(`Instance "${i.name}": "insecure": true is not allowed. Trust the CA with tls.caFile instead.`);
  }
  for (const name of plaintextPasswordInstances) {
    errors.push(`Instance "${name}": plaintext password. Use "\${env:NAME}", "\${file:/path}" or "\${keychain:target}".`);
  }
  if (config.externalSources?.starWars?.enabled === true) {
    errors.push('externalSources.starWars must be disabled: external sources call public internet APIs.');
  }
  if (config.audit?.enabled === false) {
    warnings.push('audit.enabled=false is ignored: auditing is mandatory in compliance mode.');
  }
  if (!fipsEnabled()) {
    const msg = 'Node is not running in FIPS mode (start with --enable-fips and a FIPS-validated OpenSSL provider).';
    if (config.requireFips) errors.push(msg);
    else warnings.push(msg);
  }
  return { errors, warnings };
}

export interface CompliancePosture {
  mode: ComplianceMode | null;
  fips: boolean;
  audit: { enabled: boolean; logReads: boolean };
  externalSources: boolean;
  tls: { name: string; verifyCertificates: boolean; customCa: boolean; mutualTls: boolean }[];
}
