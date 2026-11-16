import { homedir } from 'node:os'
import { redactCredentialText } from '@dovo/protocol'

const REDACTED = '[redacted]'
const quoted = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'`
/** Environment names whose values are treated as secrets wherever they appear. */
const secretName = /token|secret|passw(?:or)?d|key|cookie|credential|auth|session|private/i
const patterns: readonly [RegExp, string | ((...parts: string[]) => string)][] = [
  // Pairing codes in prose, such as `pairing code 48213907`.
  [/(\bpairing[\s_-]*code\b["']?\s*[:=]?\s*["']?)\d{4,}/gi, `$1${REDACTED}`],
  // Dovo agent run credentials.
  [/\bdovo_run_[A-Za-z0-9_-]+/g, REDACTED],
  // Provider and forge API keys, cloud keys and JSON web tokens.
  [
    /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g,
    REDACTED,
  ],
  // npm, Stripe secret and restricted keys.
  [/\b(?:npm_[A-Za-z0-9]{36}|[sr]k_(?:live|test)_[A-Za-z0-9]{16,})\b/g, REDACTED],
  // Slack incoming webhook and workflow URLs carry their secret in the path.
  [/(\bhooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]+/gi, `$1${REDACTED}`],
  // Cookie headers and fields keep their name and lose the whole value.
  [
    new RegExp(`(\\b(?:set-)?cookie["']?\\s*[:=]\\s*)(${quoted}|[^\\r\\n]+)`, 'gi'),
    (_match, prefix, value) => `${prefix}${wrap(value)}`,
  ],
  // Environment assignments, such as `NAME=value` in a command line or log. The YAML form
  // `NAME: value` counts only for credential names, so log prefixes such as `ERROR:` stay.
  [
    new RegExp(`\\b([A-Z][A-Z0-9_]{2,})(=|:[ \\t]*)(${quoted}|[^\\s,;&]+)`, 'g'),
    (match, name, separator, value) =>
      separator === '=' || (name.includes('_') && secretName.test(name))
        ? `${name}${separator}${wrap(value)}`
        : match,
  ],
  // Environment maps in JSON, such as `"NAME": "value"`.
  [/("[A-Z][A-Z0-9_]{2,}"\s*:\s*)"(?:\\.|[^"\\])*"/g, `$1"${REDACTED}"`],
  // Device and owner tokens are 43 random base64url characters. Commit IDs are lower-case hex.
  [
    /(?<![\w-])(?=[\w-]*[a-z])(?=[\w-]*[A-Z])[\w-]{32,}(?![\w-])/g,
    // Long camelCase names stay readable; a letters-only token needs 40 or more characters.
    (match) => (/^[A-Za-z]+$/.test(match) && match.length < 40 ? match : REDACTED),
  ],
  // User names in home-directory paths on macOS, Linux and Windows.
  [/(\/(?:Users|home)\/)(?!\[user\])[^/\s"'`:;,)\]]+/g, '$1[user]'],
  [/(\b[A-Za-z]:\\{1,2}Users\\{1,2})(?!\[user\])[^\\\s"'`:;,)\]]+/gi, '$1[user]'],
]
function wrap(value: string) {
  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
  return `${quote}${REDACTED}${quote}`
}

/** Values from this runtime's environment and pairing state that must never leave it. */
export function environmentSecrets(env: NodeJS.ProcessEnv = process.env) {
  return Object.entries(env).flatMap(([name, value]) =>
    value && secretName.test(name) && value.length >= 6 ? [value] : [],
  )
}

/** Redact text for a problem report before it reaches a thread. It builds on the shared
 * credential redaction and also removes known literal secrets, cookies, environment values,
 * token-shaped strings and home-directory user names. Applying it twice changes nothing. */
export function redactReportText(
  text: string,
  secrets: readonly string[] = [],
  home: string = homedir(),
) {
  let value = text
  for (const secret of [...new Set(secrets)]
    .filter((item) => item.length >= 6)
    .sort((a, b) => b.length - a.length))
    value = value.replaceAll(secret, REDACTED)
  if (home.length > 1) {
    const user = home
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop()
    const masked = user ? home.slice(0, home.lastIndexOf(user)) + '[user]' : home
    value = value.replaceAll(home, masked)
  }
  value = redactCredentialText(value)
  for (const [pattern, replacement] of patterns)
    value =
      typeof replacement === 'string'
        ? value.replace(pattern, replacement)
        : value.replace(pattern, replacement)
  return value
}

export function redactionCount(text: string) {
  return text.match(/\[redacted\]|\[user\]/g)?.length ?? 0
}
