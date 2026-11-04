import { describe, expect, it } from 'vitest';
import { checkCompliance, fipsEnabled } from '../src/utils/compliance.js';
import type { CollibraConfig } from '../src/types.js';

const instance = (extra: object = {}) => ({
  name: 'Gov',
  baseUrl: 'https://collibra.agency.example',
  username: 'svc',
  password: 'resolved-secret',
  ...extra,
});

describe('checkCompliance', () => {
  it('is a no-op without complianceMode', () => {
    const r = checkCompliance({ instances: [instance({ insecure: true, baseUrl: 'http://x' })] } as CollibraConfig, ['Gov']);
    expect(r.errors).toEqual([]);
  });

  it('accepts a hardened fedramp configuration', () => {
    const r = checkCompliance(
      { complianceMode: 'fedramp', instances: [instance({ tls: { caFile: 'ca.pem' } })] } as CollibraConfig,
      [],
    );
    expect(r.errors).toEqual([]);
  });

  it('lists every fedramp violation at once', () => {
    const r = checkCompliance(
      {
        complianceMode: 'fedramp',
        instances: [instance({ baseUrl: 'http://collibra.local' }), instance({ name: 'Lab', insecure: true })],
        externalSources: { starWars: { enabled: true } },
      } as CollibraConfig,
      ['Gov'],
    );
    expect(r.errors.join('\n')).toMatch(/"Gov": baseUrl must use https/);
    expect(r.errors.join('\n')).toMatch(/"Lab": "insecure": true is not allowed/);
    expect(r.errors.join('\n')).toMatch(/"Gov": plaintext password/);
    expect(r.errors.join('\n')).toMatch(/externalSources.starWars must be disabled/);
  });

  it('rejects unknown compliance modes', () => {
    const r = checkCompliance({ complianceMode: 'hipaa' as any, instances: [instance()] } as CollibraConfig, []);
    expect(r.errors[0]).toMatch(/Unsupported complianceMode "hipaa"/);
  });

  it('treats missing FIPS as a warning by default and an error with requireFips', () => {
    const base = { complianceMode: 'fedramp', instances: [instance()] } as CollibraConfig;
    const soft = checkCompliance(base, []);
    const hard = checkCompliance({ ...base, requireFips: true }, []);
    if (fipsEnabled()) {
      expect(soft.warnings).toEqual([]);
      expect(hard.errors).toEqual([]);
    } else {
      expect(soft.warnings.join()).toMatch(/FIPS mode/);
      expect(hard.errors.join()).toMatch(/FIPS mode/);
    }
  });

  it('warns that audit cannot be disabled', () => {
    const r = checkCompliance({ complianceMode: 'fedramp', audit: { enabled: false }, instances: [instance()] } as CollibraConfig, []);
    expect(r.warnings.join()).toMatch(/auditing is mandatory/);
  });
});
