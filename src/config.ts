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

export function getWarning(): string | undefined {
  return loadConfig().warning;
}

export function getWarningIcon(): string {
  return loadConfig().warningIcon ?? '⚠️';
}
