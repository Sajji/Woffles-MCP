/** Shared helpers for the Assessments v2 API tools. */

export const ASSESSMENTS_BASE = '/rest/assessments/v2';

/** Expected shapes for JSON-string arguments, quoted in error messages. */
export const ASSESSMENT_JSON_FORMATS = {
  assignees: '[{"type":"USER","id":"uuid"}]',
  content: '[{"id":"questionId","answer":{"type":"BOOLEAN","value":true}}]',
} as const;

/**
 * Parse a JSON-string tool argument (assignees / content). Throws a descriptive
 * error on invalid JSON; the dispatcher reports it as a standard error result.
 */
export function parseJsonArg(name: keyof typeof ASSESSMENT_JSON_FORMATS, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON in ${name} field. Expected format: ${ASSESSMENT_JSON_FORMATS[name]}`);
  }
}
