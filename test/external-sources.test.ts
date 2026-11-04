import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

process.env.COLLIBRA_CONFIG_PATH = fileURLToPath(new URL('./fixtures/config.starwars.json', import.meta.url));

let registry: typeof import('../src/tools/index.js');

beforeAll(async () => {
  registry = await import('../src/tools/index.js');
});

describe('external sources opt-in', () => {
  it('advertises search_star_wars as an open-world tool when explicitly enabled', () => {
    const t: any = registry.tools.find((x) => x.name === 'search_star_wars');
    expect(t).toBeDefined();
    expect(t.annotations.openWorldHint).toBe(true);
  });
});
