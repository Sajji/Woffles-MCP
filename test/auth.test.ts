import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { authFetch, getAuthProvider, getHttpsAgent, resetAuthCaches, resolveAuthType } from '../src/utils/auth.js';
import type { CollibraInstance } from '../src/types.js';

// Minimal mock of the Collibra endpoints the auth layer touches.
let server: Server;
let baseUrl: string;
let logins = 0;
let validSession = '';
const seen: IncomingMessage['headers'][] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === '/rest/2.0/auth/sessions' && req.method === 'POST') {
      logins++;
      validSession = `JSESSIONID=s${logins}`;
      res.setHeader('Set-Cookie', `${validSession}; Path=/; HttpOnly`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ csrfToken: `csrf${logins}` }));
      return;
    }
    if (req.url === '/basic') {
      res.end(req.headers.authorization ?? 'none');
      return;
    }
    if (req.url === '/session') {
      const ok = req.headers.cookie === validSession && req.headers['x-csrf-token'] === `csrf${logins}`;
      res.statusCode = ok ? 200 : 401;
      res.end(ok ? 'ok' : 'expired');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  resetAuthCaches();
  logins = 0;
  validSession = '';
  seen.length = 0;
});

const inst = (extra: Partial<CollibraInstance> = {}): CollibraInstance => ({
  name: 'Mock',
  baseUrl,
  username: 'alice',
  password: 's3cret',
  ...extra,
});

describe('resolveAuthType', () => {
  it('defaults to basic', () => {
    expect(resolveAuthType(inst())).toBe('basic');
  });

  it('rejects unsupported types such as oauth', () => {
    expect(() => resolveAuthType(inst({ auth: { type: 'oauth' as any } }))).toThrow(/unsupported auth.type "oauth"/);
  });
});

describe('basic auth', () => {
  it('sends an Authorization: Basic header', async () => {
    const res = await authFetch(inst(), `${baseUrl}/basic`);
    expect(await res.text()).toBe('Basic ' + Buffer.from('alice:s3cret').toString('base64'));
  });

  it('does not let caller headers override auth', async () => {
    const res = await authFetch(inst(), `${baseUrl}/basic`, { headers: { Authorization: 'Bearer x' } });
    expect(await res.text()).toMatch(/^Basic /);
  });
});

describe('session auth', () => {
  it('logs in once and reuses the session cookie + CSRF token', async () => {
    const i = inst({ auth: { type: 'session' } });
    expect((await authFetch(i, `${baseUrl}/session`)).status).toBe(200);
    expect((await authFetch(i, `${baseUrl}/session`)).status).toBe(200);
    expect(logins).toBe(1);
    expect(seen.some((h) => h.authorization)).toBe(false);
  });

  it('shares one login across concurrent requests', async () => {
    const i = inst({ auth: { type: 'session' } });
    const results = await Promise.all([1, 2, 3].map(() => authFetch(i, `${baseUrl}/session`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(logins).toBe(1);
  });

  it('re-logs in once when the session has expired', async () => {
    const i = inst({ auth: { type: 'session' } });
    await authFetch(i, `${baseUrl}/session`);
    validSession = 'JSESSIONID=server-side-expired';
    const res = await authFetch(i, `${baseUrl}/session`);
    expect(res.status).toBe(200);
    expect(logins).toBe(2);
  });

  it('can be forced for session-only APIs on a basic-auth instance', async () => {
    const res = await authFetch(inst(), `${baseUrl}/session`, {}, getAuthProvider(inst(), 'session'));
    expect(res.status).toBe(200);
  });
});

describe('origin guard', () => {
  it('refuses to send credentials to another host', async () => {
    await expect(authFetch(inst(), 'https://evil.example/rest/2.0/assets')).rejects.toThrow(/Refusing to send credentials/);
  });

  it('refuses userinfo tricks appended to the base URL', async () => {
    await expect(authFetch(inst({ baseUrl: 'https://collibra.example' }), 'https://collibra.example@evil.example/x')).rejects.toThrow(
      /Refusing to send credentials/,
    );
  });

  it('allows the instance origin', async () => {
    expect((await authFetch(inst(), `${baseUrl}/basic`)).status).toBe(200);
  });
});

describe('TLS agent', () => {
  it('uses no custom agent for plain defaults', () => {
    expect(getHttpsAgent(inst({ baseUrl: 'https://collibra.invalid' }))).toBeUndefined();
  });

  it('builds a TLS 1.2+ agent that skips verification only when insecure', () => {
    const agent: any = getHttpsAgent(inst({ baseUrl: 'https://collibra.invalid', insecure: true }));
    expect(agent.options.rejectUnauthorized).toBe(false);
    expect(agent.options.minVersion).toBe('TLSv1.2');
  });

  it('reports a missing CA file clearly', () => {
    expect(() => getHttpsAgent(inst({ baseUrl: 'https://collibra.invalid', tls: { caFile: 'no/such/ca.pem' } }))).toThrow(
      /cannot read tls.caFile/,
    );
  });

  it('requires client cert and key together', () => {
    expect(() =>
      getHttpsAgent(inst({ baseUrl: 'https://collibra.invalid', tls: { clientCertFile: 'cert.pem' } })),
    ).toThrow(/must be set together/);
  });
});
