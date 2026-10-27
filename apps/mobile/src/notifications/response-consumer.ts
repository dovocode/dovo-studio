import { notificationTarget, type NotificationTarget } from './target'
import { isNativeAnswerAction } from './answers'

type Response = {
  actionIdentifier: string
  notification: { request: { identifier: string; content: { data?: unknown } } }
}

export function createNotificationResponseConsumer(options: {
  ready: () => boolean
  open: (target: NotificationTarget) => void
  last: () => Response | null
  clear: () => void
  onError: (operation: 'open' | 'clear') => void
}) {
  const seen = new Set<string>()
  const pending: Array<{ key: string; target: NotificationTarget }> = []
  let disposed = false
  const keyOf = (response: Response) =>
    JSON.stringify([response.notification.request.identifier, response.actionIdentifier])
  const consume = (key: string) => {
    try {
      if (disposed) return
      const last = options.last()
      if (last && keyOf(last) === key) options.clear()
    } catch {
      if (!disposed) options.onError('clear')
    }
  }
  const flush = () => {
    while (!disposed && options.ready() && pending.length) {
      const entry = pending[0]
      try {
        options.open(entry.target)
      } catch {
        if (!disposed) options.onError('open')
        return
      }
      pending.shift()
      consume(entry.key)
    }
  }
  return {
    handle(response: Response) {
      if (disposed) return
      const key = keyOf(response)
      if (seen.has(key)) {
        if (pending.some((entry) => entry.key === key)) flush()
        return
      }
      seen.add(key)
      const target = notificationTarget(response.notification.request.content.data)
      if (isNativeAnswerAction(response.actionIdentifier) || !target) {
        consume(key)
        return
      }
      pending.push({ key, target })
      flush()
    },
    flush,
    dispose() {
      disposed = true
    },
  }
}
