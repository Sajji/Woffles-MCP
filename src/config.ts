import { readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import type { CollibraConfig } from './types.js';
import { AUTH_TYPES } from './utils/auth.js';
import { isSecretRef, resolveSecretRefs } from './utils/secrets.js';
import { AuditLog, type AuditSettings } from './utils/audit.js';
import { checkCompliance, fipsEnabled, type CompliancePosture } from './utils/compliance.js';

let config: CollibraConfig | null = null;
let configFilePath: string | null = null;
let plaintextPasswordInstances: string[] = [];
let auditLog: AuditLog | null | undefined;
let complianceWarnings: string[] = [];

/** Non-fatal compliance findings from the last config load. */
export function getComplianceWarnings(): string[] {
  loadConfig();
  return complianceWarnings;
}

export function getCompliancePosture(): CompliancePosture {
  const cfg = loadConfig();
  const audit = getAuditSettings();
  return {
    mode: cfg.complianceMode ?? null,
    fips: fipsEnabled(),
    audit: { enabled: audit.enabled, logReads: audit.logReads },
    externalSources: cfg.externalSources?.starWars?.enabled === true,
    tls: cfg.instances.map((i) => ({
      name: i.name,
      verifyCertificates: !i.insecure,
      customCa: !!i.tls?.caFile,
      mutualTls: !!i.tls?.clientCertFile,
    })),
  };
}

export function getAuditSettings(): AuditSettings {
  const cfg = loadConfig();
  const a = cfg.audit ?? {};
  const compliance = cfg.complianceMode !== undefined;
  return {
    enabled: compliance || a.enabled === true,
    path: resolve(a.path || join(dirname(configFilePath ?? resolve('config.json')), 'logs', 'audit.jsonl')),
    logReads: a.logReads ?? compliance,
    maxBytes: a.maxBytes ?? 50 * 1024 * 1024,
  };
}

/** The process-wide audit log, or null when auditing is disabled. */
export function getAuditLog(): AuditLog | null {
  if (auditLog === undefined) {
    const settings = getAuditSettings();
    auditLog = settings.enabled ? new AuditLog(settings) : null;
  }
  return auditLog;
}

/** Names of instances whose password is stored literally in config.json (not via a secret reference). */
export function getPlaintextPasswordInstances(): string[] {
  loadConfig();
  return plaintextPasswordInstances;
}

/** Every resolved instance secret (passwords, client-key passphrases), for redacting output. */
export function getConfiguredSecrets(): string[] {
  return loadConfig()
    .instances.flatMap((i) => [i.password, i.tls?.clientKeyPassphrase])
    .filter((s): s is string => !!s);
}

export function loadConfig(configPath?: string): CollibraConfig {
  if (config) {
    return config;
  }

  const path = configPath || process.env.COLLIBRA_CONFIG_PATH || './config.json';
  const resolvedPath = resolve(path);
  configFilePath = resolvedPath;

  try {
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as CollibraConfig;
    plaintextPasswordInstances = (parsed.instances ?? [])
      .filter((i) => typeof i?.password === 'string' && !isSecretRef(i.password))
      .map((i) => i.name);
    const cfg = resolveSecretRefs(parsed);

    // Validate config
    if (!cfg.instances || !Array.isArray(cfg.instances)) {
      throw new Error('Config must contain an "instances" array');
    }

    for (const instance of cfg.instances) {
      if (!instance.name || !instance.baseUrl || !instance.username || !instance.password) {
        throw new Error(`Invalid instance configuration: ${JSON.stringify({ ...instance, password: instance.password ? '***' : undefined, tls: instance.tls ? { ...instance.tls, clientKeyPassphrase: instance.tls.clientKeyPassphrase ? '***' : undefined } : undefined })}`);
      }
      const authType = instance.auth?.type ?? 'basic';
      if (!AUTH_TYPES.includes(authType)) {
        throw new Error(
          `Instance "${instance.name}": unsupported auth.type "${authType}". Use one of: ${AUTH_TYPES.join(', ')}. (OAuth is not supported.)`,
        );
      }
      if (!!instance.tls?.clientCertFile !== !!instance.tls?.clientKeyFile) {
        throw new Error(`Instance "${instance.name}": tls.clientCertFile and tls.clientKeyFile must be set together.`);
      }
    }

    const compliance = checkCompliance(cfg, plaintextPasswordInstances);
    if (compliance.errors.length) {
      throw new Error(
        `Compliance check failed (${cfg.complianceMode ?? 'requireFips'}):\n  - ${compliance.errors.join('\n  - ')}`,
      );
    }
    complianceWarnings = compliance.warnings;

    config = cfg;
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Configuration file not found at ${resolvedPath}. ` +
        `Please create a config.json file or set COLLIBRA_CONFIG_PATH environment variable.`
      );
    }
    throw error;
  }
}

export function getInstances(): CollibraConfig['instances'] {
  return loadConfig().instances;
}

export function getInstance(name: string) {
  const instances = getInstances();
  const instance = instances.find(i => i.name === name);
  
  if (!instance) {
    throw new Error(
      `Instance "${name}" not found. Available instances: ${instances.map(i => i.name).join(', ')}`
    );
  }
  
  return instance;
}

export function isReadOnly(): boolean {
  return loadConfig().readOnly === true;
}

/**
 * Read the optional per-tool enable/disable configuration. `enabledTools`
 * (allowlist) is honoured via config.json or the COLLIBRA_ENABLED_TOOLS env
 * var; `disabledTools` (denylist) via config.json or COLLIBRA_DISABLED_TOOLS.
 * Env vars are comma-separated lists and override the config file when set.
 * The allowlist takes precedence: when it is non-empty the denylist is ignored.
 */
export function getToolToggles(): { enabled: string[]; disabled: string[] } {
  const cfg = loadConfig();
  const parseEnv = (v?: string): string[] =>
    (v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const envEnabled = parseEnv(process.env.COLLIBRA_ENABLED_TOOLS);
  const envDisabled = parseEnv(process.env.COLLIBRA_DISABLED_TOOLS);

  const enabled = envEnabled.length > 0 ? envEnabled : cfg.enabledTools || [];
  const disabled = envDisabled.length > 0 ? envDisabled : cfg.disabledTools || [];

  return { enabled, disabled };
}

/**
 * Decide whether a tool name is permitted by the enable/disable toggles.
 * Read-only filtering is handled separately.
 */
export function isToolEnabledByConfig(toolName: string): boolean {
  const { enabled, disabled } = getToolToggles();
  if (enabled.length > 0) return enabled.includes(toolName);
  if (disabled.length > 0) return !disabled.includes(toolName);
  return true;
}

/**
 * Resolve the Star Wars external source configuration. Opt-in: disabled unless
 * `externalSources.starWars.enabled` is explicitly `true`, so a default
 * deployment never calls a public internet API (a FedRAMP boundary concern).
 */
export function getStarWarsSource(): { enabled: boolean; baseUrl: string } {
  const starWars = loadConfig().externalSources?.starWars;
  return {
    enabled: starWars?.enabled === true,
    baseUrl: (starWars?.baseUrl || 'https://www.swapi.tech/api').replace(/\/+$/, ''),
  };
}


