import * as path from 'node:path';

/** Files that are never read or sent anywhere. */
const SENSITIVE_NAME = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|der|crt|cer|gpg|asc|ovpn)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^(credentials|secrets?)(\.(json|ya?ml|toml|ini|env|txt|conf|cfg|xml|properties))?$/i,
  /service[-_]?account.*\.json$/i,
  /^\.(npmrc|pypirc|netrc|htpasswd|git-credentials)$/i,
  /^terraform\.tfstate(\.backup)?$/i,
  /\.tfvars$/i,
];

const SAFE_ENV_TEMPLATE = /^\.env\.(example|sample|template|defaults|dist)$/i;

export function isSensitiveFile(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  if (SAFE_ENV_TEMPLATE.test(base)) return false;
  return SENSITIVE_NAME.some((re) => re.test(base));
}

/** Token shapes from common providers. Matches are replaced, the file is still used. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** `password = "hunter2hunter2"` style literals: keep the key, hide the value. */
const ASSIGNMENT =
  /((?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|client[_-]?secret)[\w-]*["']?\s*[:=]\s*["'])([^"'\s]{12,})(["'])/gi;

export function redactSecrets(content: string): { content: string; count: number } {
  let count = 0;
  let out = content;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return '[REDACTED]';
    });
  }
  out = out.replace(ASSIGNMENT, (_m, pre: string, value: string, post: string) => {
    if (value === '[REDACTED]' || /^(process\.env|os\.environ|\$\{|<|your|xxx|changeme|example)/i.test(value)) {
      return pre + value + post;
    }
    count++;
    return `${pre}[REDACTED]${post}`;
  });
  return { content: out, count };
}
