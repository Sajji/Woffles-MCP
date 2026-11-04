import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

process.env.COLLIBRA_CONFIG_PATH = fileURLToPath(new URL('./fixtures/config.write.json', import.meta.url));

let registry: typeof import('../src/tools/index.js');
let hints: typeof import('../src/tools/annotations.js');

beforeAll(async () => {
  registry = await import('../src/tools/index.js');
  hints = await import('../src/tools/annotations.js');
});

describe('tool registry', () => {
  it('has unique tool names', () => {
    const names = registry.registeredTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every tool a description and an object inputSchema', () => {
    for (const t of registry.registeredTools) {
      expect(t.description, t.name).toBeTruthy();
      expect(t.inputSchema?.type, t.name).toBe('object');
    }
  });

  it('has an executor for every registered tool', () => {
    for (const t of registry.registeredTools) {
      expect(typeof registry.toolExecutors[t.name], t.name).toBe('function');
    }
  });

  // Mirrors chip's TestRegisterAll_AllToolsHaveProperAnnotations.
  it('sets every MCP annotation hint explicitly on every tool', () => {
    for (const t of registry.registeredTools) {
      const a = (t as any).annotations;
      expect(a, t.name).toBeDefined();
      expect(typeof a.title, t.name).toBe('string');
      for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        expect(typeof a[k], `${t.name}.${k}`).toBe('boolean');
      }
    }
  });

  it('only lists registered tools as write tools', () => {
    const names = new Set(registry.registeredTools.map((t) => t.name));
    for (const w of hints.WRITE_TOOL_NAMES) expect(names.has(w), w).toBe(true);
  });

  it('marks write tools not read-only and read tools non-destructive', () => {
    for (const t of registry.registeredTools) {
      const a = (t as any).annotations;
      if (hints.WRITE_TOOL_NAMES.includes(t.name)) {
        expect(a.readOnlyHint, t.name).toBe(false);
      } else if (a.readOnlyHint) {
        expect(a.destructiveHint, t.name).toBe(false);
      }
    }
  });

  it('flags tools whose name implies deletion/removal as destructive', () => {
    for (const t of registry.registeredTools) {
      if (/(^|_)(delete|remove)(_|$)/.test(t.name)) {
        expect((t as any).annotations.destructiveHint, t.name).toBe(true);
      }
    }
  });

  it('gives chip aliases the same hints as their canonical tool', () => {
    const byName = new Map(registry.registeredTools.map((t: any) => [t.name, t.annotations]));
    for (const [alias, canonical] of [
      ['list_asset_types', 'get_asset_types'],
      ['search_asset_keyword', 'search_assets_by_name'],
      ['get_asset_details', 'get_asset_by_id'],
    ]) {
      const { title: _a, ...aliasHints } = byName.get(alias);
      const { title: _c, ...canonicalHints } = byName.get(canonical);
      expect(aliasHints, alias).toEqual(canonicalHints);
    }
  });

  it('exposes write tools when readOnly is false', () => {
    const advertised = new Set(registry.tools.map((t) => t.name));
    expect(advertised.has('edit_asset')).toBe(true);
  });

  it('hides the opt-in Star Wars demo tool by default', () => {
    expect(registry.tools.some((t) => t.name === 'search_star_wars')).toBe(false);
  });
});

describe('humanizeToolName', () => {
  it('title-cases words and preserves acronyms', () => {
    expect(hints.humanizeToolName('get_asset_by_id')).toBe('Get Asset By ID');
    expect(hints.humanizeToolName('get_api_catalog')).toBe('Get API Catalog');
  });
});
