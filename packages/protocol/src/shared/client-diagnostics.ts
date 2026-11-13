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

/** Supported credential assignments, headers and embedded JSON; not arbitrary secret detection. */
export function redactCredentialText(text: string) {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try {
        const url = new URL(value)
        if (!url.username && !url.password) return value
        url.username = ''
        url.password = ''
        return url.href
      } catch {
        return value
      }
    })
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(
      /(\b(?:[\w.-]*(?:token|secret|password)|(?:proxy-)?authorization|(?:x[-_])?api[-_]?key|ticket|pairing[-_]?code|management[-_]?key|content[-_]?key|signing[-_]?seed)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[redacted\]|[^\s,;&}\]]+)/gi,
      (_match, prefix: string, value: string) => {
        const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : ''
        return `${prefix}${quote}[redacted]${quote}`
      },
    )
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
