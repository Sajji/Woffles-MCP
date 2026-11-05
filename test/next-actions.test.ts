/**
 * Every `{ tool: 'x', args: { ... } }` follow-up suggestion in the tool
 * sources must name a registered tool and use only argument names that tool
 * accepts (top-level keys), including all of its required arguments.
 * Placeholder VALUES like '<id>' are fine; wrong KEYS send agents astray.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

process.env.COLLIBRA_CONFIG_PATH = fileURLToPath(new URL('./fixtures/config.write.json', import.meta.url));
const toolsDir = fileURLToPath(new URL('../src/tools/', import.meta.url));

function suggestions(): { file: string; line: number; tool: string; keys: string[] }[] {
  const out: { file: string; line: number; tool: string; keys: string[] }[] = [];
  const re = /tool:\s*'([a-z_]+)'\s*,\s*args:\s*\{/g;
  for (const file of readdirSync(toolsDir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(toolsDir + file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (depth && i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      let flat = src.slice(start, i - 1);
      let prev: string;
      do {
        prev = flat;
        flat = flat.replace(/\{[^{}]*\}/g, '{}').replace(/\[[^[\]]*\]/g, '[]');
      } while (flat !== prev);
      const keys = [...flat.matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*(?=[:,]|$)/gi)].map((k) => k[1]);
      out.push({ file, line: src.slice(0, m.index).split('\n').length, tool: m[1], keys });
    }
  }
  return out;
}

describe('nextActions suggestions', () => {
  it('reference real tools with valid argument names', async () => {
    const { registeredTools } = await import('../src/tools/index.js');
    const schemas = new Map(registeredTools.map((t: any) => [t.name, t.inputSchema]));
    const problems: string[] = [];
    const found = suggestions();
    expect(found.length).toBeGreaterThan(50);
    for (const s of found) {
      const schema: any = schemas.get(s.tool);
      if (!schema) {
        problems.push(`${s.file}:${s.line} unknown tool "${s.tool}"`);
        continue;
      }
      const props = Object.keys(schema.properties ?? {});
      const unknown = s.keys.filter((k) => !props.includes(k));
      const missing = (schema.required ?? []).filter((r: string) => r !== 'instance_name' && !s.keys.includes(r));
      if (unknown.length) problems.push(`${s.file}:${s.line} ${s.tool}: unknown args ${unknown.join(', ')}`);
      if (missing.length) problems.push(`${s.file}:${s.line} ${s.tool}: missing required ${missing.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });
});
