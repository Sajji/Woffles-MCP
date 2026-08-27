import { marked } from 'marked';

/**
 * Utilities for converting agent-supplied Markdown into the HTML that
 * Collibra RICH_TEXT string attributes expect. LLMs naturally emit Markdown;
 * pushing it raw into a rich-text attribute renders as literal `**bold**`
 * in the Collibra UI.
 */

/** True when the value already contains HTML tags — leave those untouched. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(value);
}

/**
 * True when the value contains Markdown constructs worth converting:
 * headings, emphasis, links, inline/fenced code, lists, or blockquotes.
 * Plain single-line prose returns false so we don't wrap it in <p> for nothing.
 */
export function looksLikeMarkdown(value: string): boolean {
  if (looksLikeHtml(value)) return false;
  return (
    /(^|\n)#{1,6}\s/.test(value) ||          // headings
    /\*\*[^*\n]+\*\*/.test(value) ||          // bold
    /(^|[^*])\*[^*\s][^*\n]*\*/.test(value) || // italic
    /\[[^\]\n]+\]\([^)\n]+\)/.test(value) ||  // links
    /`[^`\n]+`/.test(value) ||                // inline code
    /(^|\n)```/.test(value) ||                // fenced code
    /(^|\n)\s*([-*+]|\d+\.)\s+\S/.test(value) || // lists
    /(^|\n)>\s+\S/.test(value)                // blockquotes
  );
}

/** Convert Markdown to HTML (synchronous; GFM defaults). */
export function markdownToHtml(md: string): string {
  return (marked.parse(md, { async: false }) as string).trim();
}

/**
 * Convert `value` to HTML iff the attribute type is RICH_TEXT and the value
 * looks like Markdown (already-HTML values pass through unchanged).
 * `isRichText` is resolved by the caller (attribute-type lookup).
 */
export function toRichTextValue(value: string, isRichText: boolean): { value: string; converted: boolean } {
  if (!isRichText || typeof value !== 'string' || !looksLikeMarkdown(value)) {
    return { value, converted: false };
  }
  return { value: markdownToHtml(value), converted: true };
}
