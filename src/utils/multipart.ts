import { randomBytes } from 'crypto';

/**
 * Build a multipart/form-data body without an external dependency.
 *
 * Hardening: the boundary is random (so content cannot predict and close it),
 * content that happens to contain the boundary is rejected, and header tokens
 * (field names, filename) may not contain CR, LF or quotes — otherwise they
 * could inject extra headers or whole extra parts.
 */
export function buildMultipartBody(
  fields: Record<string, string>,
  file?: { field: string; filename: string; contentType: string; content: string },
): { body: Buffer; contentType: string } {
  const boundary = `----WofflesMCP${randomBytes(16).toString('hex')}`;
  const parts: Buffer[] = [];

  if (file) {
    if (file.content.includes(boundary)) throw new Error('File content collides with the multipart boundary.');
    assertSafe('field name', file.field);
    assertSafe('filename', file.filename);
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      Buffer.from(file.content, 'utf8'),
      Buffer.from('\r\n', 'utf8'),
    );
  }

  for (const [name, value] of Object.entries(fields)) {
    assertSafe('field name', name);
    if (value.includes(boundary)) throw new Error(`Value of "${name}" collides with the multipart boundary.`);
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function assertSafe(label: string, value: string): void {
  if (/[\r\n"]/.test(value)) {
    throw new Error(`Invalid multipart ${label}: must not contain line breaks or double quotes.`);
  }
}
