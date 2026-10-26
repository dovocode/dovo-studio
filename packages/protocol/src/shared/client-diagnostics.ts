export type ClientDiagnosticContext = {
  appVersion?: string
  build?: string
  channel?: string
  platform?: string
  computerName?: string
  runtimeVersion?: string
  surface?: string
}

/** Keep useful failure context local and remove common credentials before copying or displaying. */
export function diagnosticMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
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
    })
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /\b((?:access[_-]|refresh[_-]|device[_-])?token|password|secret|authorization|api[_-]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1=[redacted]',
    )
    .slice(0, 2000)
}

export function clientDiagnostic(error: unknown, context: ClientDiagnosticContext = {}) {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    context,
    error: diagnosticMessage(error),
  }
}

export const notificationTestTaskId = 'dovo-notification-test'
