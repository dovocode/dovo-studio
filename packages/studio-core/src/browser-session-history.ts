// The viewer can unmount while its Browser tab and host page are still in use.
// Keep the last observed page ID without credentials or website content.
const sessions = new Map<string, string>()
const limit = 256

export function browserSessionKey(
  computer: string | undefined,
  taskId: string,
  tabId: string | undefined,
  profileId: string,
) {
  return computer && tabId ? JSON.stringify([computer, taskId, tabId, profileId]) : undefined
}

export function previousBrowserSession(key: string | undefined) {
  return key === undefined ? undefined : sessions.get(key)
}

export function rememberBrowserSession(key: string | undefined, sessionId: string | undefined) {
  if (key === undefined) return
  sessions.delete(key)
  if (sessionId === undefined) return
  sessions.set(key, sessionId)
  if (sessions.size > limit) {
    const oldest = sessions.keys().next()
    if (!oldest.done) sessions.delete(oldest.value)
  }
}
