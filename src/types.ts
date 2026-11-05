// Configuration types
export interface CollibraInstance {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
  /** Development only: skip TLS certificate verification. Prefer `tls.caFile`. */
  insecure?: boolean;
  /** How requests authenticate. Default: `{ type: 'basic' }`. OAuth is intentionally not supported. */
  auth?: { type?: 'basic' | 'session' };
  /** Transport security: custom CA bundle and/or mutual-TLS client certificate (PEM files). */
  tls?: {
    caFile?: string;
    clientCertFile?: string;
    clientKeyFile?: string;
    clientKeyPassphrase?: string;
  };
}

/**
 * Standard return shape for tool executors that opt in to structured output.
 * Tools may still return a plain string for backward compatibility — the
 * dispatcher will treat that as `{ text: <string> }`.
 */
export interface ToolResult {
  /** Human-readable text content (typically JSON.stringify of `structured`). */
  text: string;
  /** Parseable object emitted via MCP `structuredContent`. */
  structured?: unknown;
}

/**
 * Configuration for a single external (non-Collibra) source.
 */
export interface StarWarsSourceConfig {
  /** Opt-in: the Star Wars source is only used when this is explicitly true. Default: false. */
  enabled?: boolean;
  /** Base URL of the Star Wars API. Default: https://www.swapi.tech/api */
  baseUrl?: string;
}

/**
 * Optional catalog of external (non-Collibra) sources the server can federate
 * queries across. Designed to be extended with additional public/internal APIs.
 */
export interface ExternalSourcesConfig {
  starWars?: StarWarsSourceConfig;
}

export interface CollibraConfig {
  instances: CollibraInstance[];
  readOnly?: boolean;
  /**
   * Optional allowlist of tool names to expose. When set and non-empty, ONLY
   * these tools are enabled (all others hidden). Takes precedence over
   * `disabledTools`. Mutually exclusive with it in practice.
   */
  enabledTools?: string[];
  /**
   * Optional denylist of tool names to hide. Ignored when `enabledTools` is
   * set and non-empty.
   */
  disabledTools?: string[];
  /** Optional non-Collibra sources (e.g. the public Star Wars API). */
  externalSources?: ExternalSourcesConfig;
  /** Optional external skills directory (layout: <dir>/<namespace>/<name>/SKILL.md). */
  skillsDir?: string;
  /**
   * Optional HTTP transport settings. When enabled the server listens on
   * localhost (streamable HTTP) instead of stdio.
   */
  http?: {
    enabled?: boolean;
    port?: number;
    /** Optional bearer token clients must send (`Authorization: Bearer …`). Use a secret reference. */
    token?: string;
  };
  /** When true, tool outputs are validated against their outputSchema (warn-only). */
  validateOutput?: boolean;
  /**
   * Also advertise legacy (superseded) tools in tools/list. They are always
   * callable; by default they are hidden to keep the advertised surface small.
   */
  listLegacyTools?: boolean;
  /**
   * Tamper-evident audit trail (hash-chained JSONL). Off by default; forced on
   * by `complianceMode`. `path` defaults to `<config dir>/logs/audit.jsonl`.
   */
  audit?: { enabled?: boolean; path?: string; logReads?: boolean; maxBytes?: number };
  /**
   * Hardened deployment posture enforced at startup (see src/utils/compliance.ts).
   * "fedramp": https + verified TLS, secret references only, no external
   * sources, mandatory audit, FIPS check.
   */
  complianceMode?: 'fedramp';
  /** Fail startup unless Node's crypto is in FIPS mode. */
  requireFips?: boolean;
}

// Asset Type types
export interface AssetTypeParent {
  id: string;
  resourceType: string;
  resourceDiscriminator: string;
  name: string;
}

export interface AssetTypeSymbolData {
  color: string;
  symbolType: string;
  acronymCode?: string;
}

export interface AssetType {
  id: string;
  createdBy: string;
  createdOn: number;
  lastModifiedBy: string;
  lastModifiedOn: number;
  system: boolean;
  resourceType: string;
  name: string;
  description?: string;
  publicId: string;
  parent?: AssetTypeParent;
  symbolData?: AssetTypeSymbolData;
  displayNameEnabled: boolean;
  ratingEnabled: boolean;
  finalType: boolean;
  lockStatuses: boolean;
  product: string;
  appliedTraits: any[];
}

export interface AssetTypesResponse {
  total: number;
  offset: number;
  limit: number;
  results: AssetType[];
}
