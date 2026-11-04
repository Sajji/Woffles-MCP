/**
 * Secret references in config.json, so credentials need not be stored in
 * plaintext:
 *
 *   "${env:NAME}"        environment variable
 *   "${file:/path}"      file contents, trailing newline trimmed (Docker/K8s secrets)
 *   "${keychain:TARGET}" OS credential store:
 *                          Windows  Credential Manager generic credential (cmdkey /generic:TARGET ...)
 *                          macOS    Keychain generic password with service TARGET
 *                          Linux    libsecret item with attribute service=TARGET (secret-tool)
 *
 * A reference must be the whole string value. Resolution happens once, when
 * the config is loaded; a missing secret fails startup with a clear message.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const REF = /^\$\{(env|file|keychain):([^}]+)\}$/;

export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value.trim());
}

const WINDOWS_CRED_READ = `
$sig = @'
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
  public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
}
'@
Add-Type -MemberDefinition $sig -Namespace WofflesSecrets -Name Cred
$p = [IntPtr]::Zero
if (-not [WofflesSecrets.Cred]::CredRead($env:WOFFLES_CRED_TARGET, 1, 0, [ref]$p)) { exit 2 }
try {
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][WofflesSecrets.Cred+CREDENTIAL])
  [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2))
} finally { [WofflesSecrets.Cred]::CredFree($p) }
`;

function readKeychain(target: string): string {
  const opts = { encoding: 'utf-8' as const, stdio: ['ignore', 'pipe', 'pipe'] as any, timeout: 15000 };
  if (process.platform === 'win32') {
    // Target goes via env var, never interpolated into the script.
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_CRED_READ], {
      ...opts,
      env: { ...process.env, WOFFLES_CRED_TARGET: target },
    });
  }
  if (process.platform === 'darwin') {
    return execFileSync('security', ['find-generic-password', '-s', target, '-w'], opts).replace(/\r?\n$/, '');
  }
  return execFileSync('secret-tool', ['lookup', 'service', target], opts).replace(/\r?\n$/, '');
}

/** Resolve one secret reference; throws a descriptive error (without the secret) on failure. */
export function resolveSecretRef(value: string, where: string): string {
  const m = REF.exec(value.trim());
  if (!m) return value;
  const [, kind, ref] = m;
  let resolved: string | undefined;
  try {
    if (kind === 'env') resolved = process.env[ref];
    else if (kind === 'file') resolved = readFileSync(ref, 'utf-8').replace(/\r?\n$/, '');
    else resolved = readKeychain(ref);
  } catch (error) {
    const reason = kind === 'keychain' ? 'credential not found or OS credential store unavailable' : (error as Error).message;
    throw new Error(`${where}: could not resolve \${${kind}:${ref}} (${reason}).`);
  }
  if (resolved === undefined || resolved === '') {
    throw new Error(`${where}: \${${kind}:${ref}} resolved to an empty value.`);
  }
  return resolved;
}

/** Deep-resolve every secret reference in a parsed config object (in place). */
export function resolveSecretRefs<T>(node: T, path = 'config'): T {
  if (Array.isArray(node)) {
    node.forEach((v, i) => ((node as any)[i] = resolveSecretRefs(v, `${path}[${i}]`)));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) (node as any)[k] = resolveSecretRefs(v, `${path}.${k}`);
  } else if (isSecretRef(node)) {
    return resolveSecretRef(node, path) as T;
  }
  return node;
}

/** Replace every occurrence of the given secrets in `text` with ***. */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('***');
  }
  return out;
}
