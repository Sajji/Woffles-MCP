import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../config.js';

/**
 * Skill catalog loader. Skills are short Markdown guides documenting
 * multi-step Collibra workflows for the connecting LLM, laid out chip-style:
 *   <dir>/<namespace>/<name>/SKILL.md   (+ optional references/*.md)
 * Embedded skills ship in <package root>/skills; an external directory
 * (config `skillsDir` or COLLIBRA_MCP_SKILLS_DIR) is merged on top —
 * an external skill with the same namespace/name fully replaces the
 * embedded one.
 */

export interface SkillEntry {
  namespace: string;
  name: string;
  /** First markdown heading or first non-empty line of SKILL.md. */
  title: string;
  /** First paragraph after the title. */
  summary: string;
  dir: string;
  source: 'embedded' | 'external';
  references: string[];
}

/** Package root = two levels up from dist/utils (or src/utils under ts-node). */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

function externalSkillsDir(): string | null {
  const fromEnv = process.env.COLLIBRA_MCP_SKILLS_DIR;
  const fromConfig = (loadConfig() as any).skillsDir as string | undefined;
  const dir = fromEnv || fromConfig;
  return dir ? resolve(dir) : null;
}

function parseSkillMd(md: string): { title: string; summary: string } {
  const lines = md.split(/\r?\n/);
  let title = '';
  let summary = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!title) {
      title = t.replace(/^#+\s*/, '');
      continue;
    }
    if (!t.startsWith('#')) {
      summary = t;
      break;
    }
  }
  return { title: title || '(untitled skill)', summary };
}

function scanDir(base: string, source: 'embedded' | 'external'): SkillEntry[] {
  const out: SkillEntry[] = [];
  if (!existsSync(base)) return out;
  for (const ns of readdirSync(base)) {
    const nsDir = join(base, ns);
    if (!statSync(nsDir).isDirectory() || ns.startsWith('_') || ns.startsWith('.')) continue;
    for (const name of readdirSync(nsDir)) {
      const skillDir = join(nsDir, name);
      const skillMd = join(skillDir, 'SKILL.md');
      if (!statSync(skillDir).isDirectory() || !existsSync(skillMd)) continue;
      const { title, summary } = parseSkillMd(readFileSync(skillMd, 'utf-8'));
      const refsDir = join(skillDir, 'references');
      const references = existsSync(refsDir)
        ? readdirSync(refsDir).filter((f) => f.toLowerCase().endsWith('.md'))
        : [];
      out.push({ namespace: ns, name, title, summary, dir: skillDir, source, references });
    }
  }
  return out;
}

/** List all skills; external entries override embedded ones with the same namespace/name. */
export function listSkills(): SkillEntry[] {
  const embedded = scanDir(join(packageRoot(), 'skills'), 'embedded');
  const external = externalSkillsDir() ? scanDir(externalSkillsDir()!, 'external') : [];
  const byKey = new Map<string, SkillEntry>();
  for (const s of embedded) byKey.set(`${s.namespace}/${s.name}`, s);
  for (const s of external) byKey.set(`${s.namespace}/${s.name}`, s);
  return [...byKey.values()].sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}

/** Load a skill's SKILL.md (and optionally one reference file). */
export function loadSkill(
  namespace: string,
  name: string,
  reference?: string,
): { skill: SkillEntry; content: string; referenceContent?: string } | null {
  const entry = listSkills().find((s) => s.namespace === namespace && s.name === name);
  if (!entry) return null;
  const content = readFileSync(join(entry.dir, 'SKILL.md'), 'utf-8');
  let referenceContent: string | undefined;
  if (reference) {
    // Path traversal guard: the reference must be a plain filename from the skill's own list
    if (!entry.references.includes(reference)) return { skill: entry, content };
    referenceContent = readFileSync(join(entry.dir, 'references', reference), 'utf-8');
  }
  return { skill: entry, content, referenceContent };
}
