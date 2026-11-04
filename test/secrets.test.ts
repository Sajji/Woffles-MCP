import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { isSecretRef, redactSecrets, resolveSecretRef, resolveSecretRefs } from '../src/utils/secrets.js';

describe('secret references', () => {
  afterEach(() => {
    delete process.env.WOFFLES_TEST_SECRET;
  });

  it('recognises only whole-value references', () => {
    expect(isSecretRef('${env:X}')).toBe(true);
    expect(isSecretRef('${file:/run/secrets/pw}')).toBe(true);
    expect(isSecretRef('${keychain:woffles/prod}')).toBe(true);
    expect(isSecretRef('prefix ${env:X}')).toBe(false);
    expect(isSecretRef('plain-password')).toBe(false);
    expect(isSecretRef(42)).toBe(false);
  });

  it('resolves env references', () => {
    process.env.WOFFLES_TEST_SECRET = 'from-env';
    expect(resolveSecretRef('${env:WOFFLES_TEST_SECRET}', 'x')).toBe('from-env');
  });

  it('fails clearly on a missing env var', () => {
    expect(() => resolveSecretRef('${env:WOFFLES_TEST_SECRET}', 'config.instances[0].password')).toThrow(
      /config.instances\[0\].password: \$\{env:WOFFLES_TEST_SECRET\} resolved to an empty value/,
    );
  });

  it('resolves file references and trims one trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woffles-'));
    try {
      const f = join(dir, 'pw');
      writeFileSync(f, 'from-file\n');
      expect(resolveSecretRef(`\${file:${f}}`, 'x')).toBe('from-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deep-resolves a config object and leaves literals alone', () => {
    process.env.WOFFLES_TEST_SECRET = 'pw';
    const cfg = resolveSecretRefs({
      readOnly: true,
      instances: [{ name: 'A', username: 'u', password: '${env:WOFFLES_TEST_SECRET}' }, { name: 'B', password: 'literal' }],
    });
    expect(cfg.instances[0].password).toBe('pw');
    expect(cfg.instances[1].password).toBe('literal');
    expect(cfg.readOnly).toBe(true);
  });

  it('never includes the secret value in resolution errors', () => {
    expect(() => resolveSecretRef('${keychain:woffles-test-does-not-exist-9f3}', 'x')).toThrow(/could not resolve/);
  });

  it.runIf(process.platform === 'win32')('reads a Windows Credential Manager generic credential', () => {
    const target = `woffles-test-${process.pid}`;
    execFileSync('cmdkey', [`/generic:${target}`, '/user:svc', '/pass:k3ych@in-pw'], { stdio: 'ignore' });
    try {
      expect(resolveSecretRef(`\${keychain:${target}}`, 'x')).toBe('k3ych@in-pw');
    } finally {
      execFileSync('cmdkey', [`/delete:${target}`], { stdio: 'ignore' });
    }
  }, 30000);
});

describe('redactSecrets', () => {
  it('masks every occurrence of each secret', () => {
    expect(redactSecrets('pw=hunter22, again hunter22', ['hunter22'])).toBe('pw=***, again ***');
  });

  it('ignores very short or empty secrets to avoid mangling output', () => {
    expect(redactSecrets('a b c', ['', 'a'])).toBe('a b c');
  });
});
