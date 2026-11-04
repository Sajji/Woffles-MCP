/**
 * Pluggable, OAuth-free authentication + TLS for Collibra instances.
 *
 * FedRAMP and Collibra Platform Self-Hosted (CPSH) customers cannot use OAuth,
 * so the supported modes are:
 *   - `basic`   (default) — HTTP Basic on every request.
 *   - `session` — REST session login (`POST /rest/2.0/auth/sessions`), reusing
 *                 the session cookie + X-CSRF-TOKEN and re-logging in on 401/403.
 *
 * Transport options are independent of the auth mode: `caFile` (custom CA
 * bundle, e.g. an agency PKI root), `clientCertFile`/`clientKeyFile` (mutual
 * TLS), and `insecure` (development only). TLS 1.2 is the minimum version.
 *
 * Every outbound Collibra call should go through `authFetch` so auth, TLS and
 * retry behaviour are applied consistently.
 */
import fetch, { type RequestInit, type Response } from 'node-fetch';
import https from 'https';
import { readFileSync } from 'fs';
import type { CollibraInstance } from '../types.js';

export type AuthType = 'basic' | 'session';
export const AUTH_TYPES: readonly AuthType[] = ['basic', 'session'];

export interface AuthProvider {
  readonly type: AuthType;
  /** True when a 401/403 may be fixed by re-authenticating (retry once). */
  readonly refreshable: boolean;
  /** Headers that authenticate one request. `forceRefresh` discards cached credentials first. */
  headers(forceRefresh?: boolean): Promise<Record<string, string>>;
}

export function resolveAuthType(instance: CollibraInstance): AuthType {
  const type = instance.auth?.type ?? 'basic';
  if (!AUTH_TYPES.includes(type)) {
    throw new Error(
      `Instance "${instance.name}": unsupported auth.type "${type}". Use one of: ${AUTH_TYPES.join(', ')}.`,
    );
  }
  return type;
}

class BasicAuthProvider implements AuthProvider {
  readonly type = 'basic' as const;
  readonly refreshable = false;
  private readonly header: string;

  constructor(instance: CollibraInstance) {
    this.header = 'Basic ' + Buffer.from(`${instance.username}:${instance.password}`).toString('base64');
  }

  async headers(): Promise<Record<string, string>> {
    return { Authorization: this.header };
  }
}

interface Session {
  cookie: string;
  csrfToken: string;
}

class SessionAuthProvider implements AuthProvider {
  readonly type = 'session' as const;
  readonly refreshable = true;
  /** Stored as a promise so concurrent callers share one login. */
  private session: Promise<Session> | null = null;

  constructor(private readonly instance: CollibraInstance) {}

  private async login(): Promise<Session> {
    const response = await fetch(`${this.instance.baseUrl}/rest/2.0/auth/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username: this.instance.username, password: this.instance.password }),
      agent: getHttpsAgent(this.instance),
    });
    if (!response.ok) {
      throw new Error(`Session login failed: ${response.status} ${response.statusText}`);
    }
    const setCookies: string[] = response.headers.raw()['set-cookie'] ?? [];
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    const body = (await response.json().catch(() => ({}))) as { csrfToken?: string };
    if (!cookie) throw new Error('Session login succeeded but no session cookie was returned.');
    return { cookie, csrfToken: body.csrfToken ?? '' };
  }

  async headers(forceRefresh = false): Promise<Record<string, string>> {
    if (forceRefresh || !this.session) {
      const pending = this.login();
      this.session = pending;
      pending.catch(() => {
        if (this.session === pending) this.session = null;
      });
    }
    const { cookie, csrfToken } = await this.session;
    return { Cookie: cookie, 'X-CSRF-TOKEN': csrfToken };
  }
}

const providerCache = new Map<string, AuthProvider>();
const agentCache = new Map<string, https.Agent | undefined>();

function cacheKey(instance: CollibraInstance, type: string): string {
  return `${type}|${instance.baseUrl}|${instance.username}`;
}

/** The instance's configured auth provider (cached per instance + user). */
export function getAuthProvider(instance: CollibraInstance, type: AuthType = resolveAuthType(instance)): AuthProvider {
  const key = cacheKey(instance, type);
  let provider = providerCache.get(key);
  if (!provider) {
    provider = type === 'session' ? new SessionAuthProvider(instance) : new BasicAuthProvider(instance);
    providerCache.set(key, provider);
  }
  return provider;
}

function readTlsFile(instance: CollibraInstance, field: string, path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`Instance "${instance.name}": cannot read ${field} "${path}": ${(error as Error).message}`);
  }
}

/**
 * HTTPS agent applying the instance's TLS settings, or undefined for plain
 * defaults. Cached per instance so connections are reused.
 */
export function getHttpsAgent(instance: CollibraInstance): https.Agent | undefined {
  if (!instance.baseUrl.toLowerCase().startsWith('https:')) return undefined;
  const tls = instance.tls ?? {};
  const key = `${instance.name}|${instance.baseUrl}`;
  if (agentCache.has(key)) return agentCache.get(key);

  const needsAgent = instance.insecure || tls.caFile || tls.clientCertFile || tls.clientKeyFile;
  let agent: https.Agent | undefined;
  if (needsAgent) {
    if (!!tls.clientCertFile !== !!tls.clientKeyFile) {
      throw new Error(`Instance "${instance.name}": tls.clientCertFile and tls.clientKeyFile must be set together.`);
    }
    agent = new https.Agent({
      keepAlive: true,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: !instance.insecure,
      ca: tls.caFile ? readTlsFile(instance, 'tls.caFile', tls.caFile) : undefined,
      cert: tls.clientCertFile ? readTlsFile(instance, 'tls.clientCertFile', tls.clientCertFile) : undefined,
      key: tls.clientKeyFile ? readTlsFile(instance, 'tls.clientKeyFile', tls.clientKeyFile) : undefined,
      passphrase: tls.clientKeyPassphrase,
    });
  }
  agentCache.set(key, agent);
  return agent;
}

/**
 * Credentials may only ever be sent to the instance's own origin. Guards
 * against URLs built from user input (e.g. `baseUrl + "@other.host/..."`)
 * redirecting an authenticated request, and keeps egress to configured hosts.
 */
export function assertSameOrigin(instance: CollibraInstance, url: string): void {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error(`Refusing request to an invalid URL for instance "${instance.name}".`);
  }
  const expected = new URL(instance.baseUrl);
  if (target.origin !== expected.origin || target.username || target.password) {
    throw new Error(
      `Refusing to send credentials for instance "${instance.name}" to ${target.origin}: only ${expected.origin} is allowed.`,
    );
  }
}

/**
 * fetch() against a Collibra instance with auth headers and TLS settings
 * applied. Retries once with fresh credentials on 401/403 when the provider
 * supports it (session expiry). Caller-supplied headers win over defaults but
 * never over auth headers.
 */
export async function authFetch(
  instance: CollibraInstance,
  url: string,
  init: RequestInit = {},
  provider: AuthProvider = getAuthProvider(instance),
): Promise<Response> {
  assertSameOrigin(instance, url);
  const send = async (forceRefresh: boolean) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(await provider.headers(forceRefresh)) },
      agent: getHttpsAgent(instance),
    });

  let response = await send(false);
  const replayableBody = init.body == null || typeof init.body === 'string' || Buffer.isBuffer(init.body);
  if (provider.refreshable && replayableBody && (response.status === 401 || response.status === 403)) {
    response = await send(true);
  }
  return response;
}

/** Test hook: drop cached providers and agents. */
export function resetAuthCaches(): void {
  providerCache.clear();
  agentCache.clear();
}
