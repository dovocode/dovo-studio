export type ClientDiagnosticContext = {
  appVersion?: string
  build?: string
  channel?: string
  platform?: string
  viewerPlatform?: string
  viewerArchitecture?: string
  viewerProcessArchitecture?: string
  /** navigator.platform is a compatibility string, not hardware architecture. */
  browserPlatformLegacy?: string
  computerName?: string
  runtimeVersion?: string
  surface?: string
  /** Extension view ID only. Do not include entity or thread IDs. */
  viewId?: string
}

const quotedValue = `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'`
/** Field names whose values are credentials. Plain `key` names, such as `sort_key`, stay
 * readable; a key name needs a word that marks it as a credential. */
const credentialName =
  '[\\w.-]*(?:token|secret|passw(?:or)?d|pwd)|[\\w.-]*(?:secret|private|access|api|auth|signing|encryption|master|session|client|account)[-_]?key|(?:proxy-)?authorization|(?:x[-_])?api[-_]?key|ticket|pairing[-_]?code|management[-_]?key|content[-_]?key|signing[-_]?seed'
const credentialPatterns: readonly [RegExp, string | ((...parts: string[]) => string)][] = [
  // PEM and OpenSSH private keys. The whole block goes, also when a log or a length limit
  // cut it before its END line or after its BEGIN line.
  [
    /-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----(?:[\s\S]*?-----END \1PRIVATE KEY-----|[\s\S]*?(?=\r?\n[ \t]*\r?\n|$))/g,
    (match, kind) =>
      match.includes('-----END ')
        ? `-----BEGIN ${kind}PRIVATE KEY----- [redacted] -----END ${kind}PRIVATE KEY-----`
        : `-----BEGIN ${kind}PRIVATE KEY----- [redacted]`,
  ],
  [/^(?:[A-Za-z0-9+/=]+\r?\n)+(?=-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----)/gm, '[redacted]\n'],
  // User names and passwords in any `scheme://user:password@host` URL.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#<>"'`]+@(?=[^\s@/?#])/gi, '$1'],
  [/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]'],
  // Command-line options with a separate value, such as `--api-key value`.
  [
    new RegExp(
      `(--[\\w-]*(?:token|secret|passw(?:or)?d|pwd|api[-_]?key|access[-_]?key|private[-_]?key)[ \\t]+)(?!-)(${quotedValue}|[^\\s]+)`,
      'gi',
    ),
    (_match, prefix: string, value: string) => `${prefix}${wrapRedacted(value)}`,
  ],
  [
    new RegExp(
      `(\\b(?:${credentialName})["']?\\s*[:=]\\s*)(${quotedValue}|\\[redacted\\]|[^\\s,;&}\\]]+)`,
      'gi',
    ),
    (_match, prefix: string, value: string) => `${prefix}${wrapRedacted(value)}`,
  ],
]
function wrapRedacted(value: string) {
  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
  return `${quote}[redacted]${quote}`
}

/** Supported credential assignments, headers, URLs, private keys and embedded JSON; not
 * arbitrary secret detection. Applying it twice changes nothing. */
export function redactCredentialText(text: string) {
  let value = text
  for (const [pattern, replacement] of credentialPatterns)
    value =
      typeof replacement === 'string'
        ? value.replace(pattern, replacement)
        : value.replace(pattern, replacement)
  return value
}

/** Keep useful failure context local and remove common credentials before copying or displaying. */
export function diagnosticMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return redactCredentialText(
    text.replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const url = new URL(value)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return url.href
      } catch {
        return '[address]'
      }
    }),
  ).slice(0, 2000)
}

export function clientDiagnostic(
  error: unknown,
  context: ClientDiagnosticContext = {},
  componentStack?: string | null,
) {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    context,
    error: diagnosticMessage(error),
    ...(componentStack ? { componentStack: diagnosticMessage(componentStack) } : {}),
  }
}

export const notificationTestTaskId = 'dovo-notification-test'

/** Recent errors in this client process, newest last. They stay in memory on this device and
 * leave it only when a person includes them in a problem report. */
const recentErrors: { at: string; message: string; source?: string }[] = []
const RECENT_CLIENT_ERRORS = 20
export function recordClientError(error: unknown, source?: string) {
  const message = diagnosticMessage(
    error instanceof Error && error.name !== 'Error' ? `${error.name}: ${error.message}` : error,
  )
  if (!message.trim()) return
  const previous = recentErrors.at(-1)
  // A render loop can report the same failure many times; keep one entry per burst.
  if (previous?.message === message && previous.source === source) {
    previous.at = new Date().toISOString()
    return
  }
  recentErrors.push({ at: new Date().toISOString(), message, ...(source ? { source } : {}) })
  if (recentErrors.length > RECENT_CLIENT_ERRORS)
    recentErrors.splice(0, recentErrors.length - RECENT_CLIENT_ERRORS)
}
export function recentClientErrors() {
  return recentErrors.map((entry) => ({ ...entry }))
}
