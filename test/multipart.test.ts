import { describe, expect, it } from 'vitest';
import { buildMultipartBody } from '../src/utils/multipart.js';

describe('buildMultipartBody', () => {
  it('uses a random boundary per call', () => {
    const a = buildMultipartBody({ x: '1' }).contentType;
    const b = buildMultipartBody({ x: '1' }).contentType;
    expect(a).not.toBe(b);
  });

  it('encodes fields and an optional file part', () => {
    const { body, contentType } = buildMultipartBody(
      { manifestId: 'm-1' },
      { field: 'manifest', filename: 'contract.yaml', contentType: 'application/yaml', content: 'a: 1' },
    );
    const boundary = contentType.split('boundary=')[1];
    const text = body.toString('utf8');
    expect(text).toContain(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"; filename="contract.yaml"`);
    expect(text).toContain('name="manifestId"\r\n\r\nm-1\r\n');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('rejects header injection through field names', () => {
    expect(() => buildMultipartBody({ 'a"\r\nX-Evil: 1': 'v' })).toThrow(/must not contain/);
  });

  it('allows line breaks inside values (they cannot escape the random boundary)', () => {
    expect(() => buildMultipartBody({ description: 'line 1\r\nline 2' })).not.toThrow();
  });
});
