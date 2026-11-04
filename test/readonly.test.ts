import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

process.env.COLLIBRA_CONFIG_PATH = fileURLToPath(new URL('./fixtures/config.readonly.json', import.meta.url));

let registry: typeof import('../src/tools/index.js');
let hints: typeof import('../src/tools/annotations.js');

beforeAll(async () => {
  registry = await import('../src/tools/index.js');
  hints = await import('../src/tools/annotations.js');
});

describe('read-only mode', () => {
  it('advertises no write tools', () => {
    const advertised = registry.tools.map((t) => t.name);
    for (const w of hints.WRITE_TOOL_NAMES) expect(advertised, w).not.toContain(w);
    expect(registry.tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
  });

  it('refuses to execute write tools', async () => {
    await expect(registry.executeTool('edit_asset', {})).rejects.toThrow(/read-only mode/);
  });
});
