import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { CollibraConfig } from './types.js';

let config: CollibraConfig | null = null;

export function loadConfig(configPath?: string): CollibraConfig {
  if (config) {
    return config;
  }

  const path = configPath || process.env.COLLIBRA_CONFIG_PATH || './config.json';
  const resolvedPath = resolve(path);

  try {
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    config = JSON.parse(fileContent) as CollibraConfig;
    
    // Validate config
    if (!config.instances || !Array.isArray(config.instances)) {
      throw new Error('Config must contain an "instances" array');
    }

    for (const instance of config.instances) {
      if (!instance.name || !instance.baseUrl || !instance.username || !instance.password) {
        throw new Error(`Invalid instance configuration: ${JSON.stringify(instance)}`);
      }
    }

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
 * Resolve the Star Wars external source configuration, applying defaults when
 * the `externalSources.starWars` section is absent from config.json. Enabled by
 * default so the multi-source demo works out of the box.
 */
export function getStarWarsSource(): { enabled: boolean; baseUrl: string } {
  const starWars = loadConfig().externalSources?.starWars;
  return {
    enabled: starWars?.enabled !== false,
    baseUrl: (starWars?.baseUrl || 'https://www.swapi.tech/api').replace(/\/+$/, ''),
  };
}


