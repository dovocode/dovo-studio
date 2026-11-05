import { readDesktopBrowserTargets } from '../../previews/desktop-browser-host.js'

/** Discovery is optional; a closed desktop browser must never prevent a task from running. */
export function browserCdpInstructions(taskId: string) {
  const targets = readDesktopBrowserTargets().filter((target) => target.taskId === taskId)
  if (!targets.length) return ''
  return `The user enabled agent access to this thread's built-in browser. Page-scoped CDP WebSocket endpoints: ${JSON.stringify(targets.map((target) => ({ profile: target.profileId, endpoint: target.endpoint })))}. Connect directly to the page WebSocket to use Runtime, Page, DOM, Network and Input commands. This is a page endpoint, not a browser endpoint: Browser.* and Target.* commands are unavailable. Use only these page targets; do not launch or attach to the Dovo application UI. Switching profiles or disabling Agent CDP closes this endpoint. Website cookies belong to the selected browser profile.`
}
