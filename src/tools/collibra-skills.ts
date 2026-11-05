import { ok, okPretty } from '../utils/tool-result.js';
import type { ToolResult } from '../types.js';
import { listSkills, loadSkill } from '../utils/skills.js';

export const listCollibraSkillsTool = {
  name: 'list_collibra_skills',
  description:
    'List the available Collibra skills: short Markdown guides documenting multi-step workflows for this server ' +
    '(operating-model planning, cross-instance migration, assessments, discovery & lineage, …). ' +
    'Call load_collibra_skill to read a guide BEFORE attempting the corresponding workflow. ' +
    'Skills require no Collibra connection — this reads the local catalog. ' +
    'Add custom skills via the skillsDir config key or COLLIBRA_MCP_SKILLS_DIR (layout: <dir>/<namespace>/<name>/SKILL.md).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      skills: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            namespace: { type: 'string' },
            name: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            source: { type: 'string', enum: ['embedded', 'external'] },
            references: { type: 'array', items: { type: 'string' } },
          },
          required: ['namespace', 'name', 'title'],
        },
      },
    },
    required: ['count', 'skills'],
  },
};

export async function executeListCollibraSkills(): Promise<ToolResult> {
  try {
    const skills = listSkills().map((s) => ({
      namespace: s.namespace,
      name: s.name,
      title: s.title,
      summary: s.summary,
      source: s.source,
      references: s.references,
    }));
    return ok({ count: skills.length, skills });
  } catch (error) {
    return ok({ error: true, message: (error as Error).message });
  }
}

export const loadCollibraSkillTool = {
  name: 'load_collibra_skill',
  description:
    'Load a Collibra skill guide (Markdown) by namespace and name, as listed by list_collibra_skills. ' +
    'Read the guide fully and follow its steps and rules when performing the corresponding workflow. ' +
    'Optionally load one of the skill\'s reference files via the reference parameter.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Skill namespace (e.g. "collibra").' },
      name: { type: 'string', description: 'Skill name (e.g. "operating-model").' },
      reference: { type: 'string', description: 'Optional: filename of a reference doc listed by list_collibra_skills.' },
    },
    required: ['namespace', 'name'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      namespace: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string', description: 'The full SKILL.md markdown.' },
      referenceContent: { type: 'string' },
      references: { type: 'array', items: { type: 'string' } },
    },
    required: ['namespace', 'name', 'content'],
  },
};

export async function executeLoadCollibraSkill(args: any): Promise<ToolResult> {
  const { namespace, name, reference } = args;
  try {
    const loaded = loadSkill(namespace, name, reference);
    if (!loaded) {
      const available = listSkills().map((s) => `${s.namespace}/${s.name}`);
      return ok({
        error: true,
        message: `Skill "${namespace}/${name}" not found.`,
        availableSkills: available,
      });
    }
    return okPretty({
      namespace: loaded.skill.namespace,
      name: loaded.skill.name,
      title: loaded.skill.title,
      content: loaded.content,
      ...(loaded.referenceContent ? { referenceContent: loaded.referenceContent } : {}),
      references: loaded.skill.references,
    });
  } catch (error) {
    return ok({ error: true, message: (error as Error).message });
  }
}
