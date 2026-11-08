import { WebSocket } from 'ws'
import {
  decode,
  mutableStruct,
  previewUrl,
  STUDIO_BROWSER_SCOPE,
  isPrivateBrowserProfile,
} from '@dovo/protocol'
import { Schema } from 'effect'
import type { CDPSession } from 'playwright'
import { HttpError } from '../errors.js'
import type { AgentBrowserCommand } from './agent-browser.js'
import { browserScript } from './browser-script.js'
import { readDesktopBrowserTargets, type DesktopBrowserTarget } from './desktop-browser-host.js'

export const DESKTOP_BROWSER_PREFIX = 'desktop:'

export function desktopWorkspaceTargets(): DesktopBrowserTarget[] {
  return readDesktopBrowserTargets().filter(
    (target) =>
      target.taskId === STUDIO_BROWSER_SCOPE &&
      !!target.tabId &&
      !isPrivateBrowserProfile(target.profileId),
  )
}

export function desktopBrowserTarget(id: string) {
  if (!id.startsWith(DESKTOP_BROWSER_PREFIX)) return undefined
  const tabId = id.slice(DESKTOP_BROWSER_PREFIX.length)
  return desktopWorkspaceTargets().find((target) => target.tabId === tabId)
}

const targetListSchema = mutableStruct({
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
})

/** Live title/URL for listing, from the target's own token-scoped /json endpoint. */
export async function desktopBrowserList() {
  return Promise.all(
    desktopWorkspaceTargets().map(async (target) => {
      let title = ''
      let url = ''
      try {
        const endpoint = new URL(target.endpoint)
        const token = endpoint.pathname.split('/')[1] ?? ''
        const response = await fetch(`http://${endpoint.host}/${token}/json`, {
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          const list: unknown = await response.json()
          const first = Array.isArray(list) ? list[0] : undefined
          if (first) {
            const parsed = decode(targetListSchema, first)
            title = parsed.title ?? ''
            url = parsed.url ?? ''
          }
        }
      } catch {
        /* A tab that is closing simply lists without live page details. */
      }
      return {
        id: `${DESKTOP_BROWSER_PREFIX}${target.tabId}`,
        kind: 'desktop' as const,
        tabId: target.tabId as string,
        profileId: target.profileId,
        url,
        title,
      }
    }),
  )
}

type AxNode = {
  nodeId: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  childIds?: string[]
}

/** Format a CDP accessibility tree like a compact aria snapshot (bounded, readable lines). */
export function formatAxSnapshot(nodes: AxNode[], limit = 32000): string {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const lines: string[] = []
  const visit = (node: AxNode, depth: number) => {
    if (lines.join('').length > limit || depth > 40) return
    const role = node.role?.value ?? 'generic'
    const name = (node.name?.value ?? '').replace(/\s+/g, ' ').trim()
    if (!node.ignored && role !== 'generic' && role !== 'none')
      lines.push(`${'  '.repeat(depth)}- ${role}${name ? ` "${name}"` : ''}`)
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child)
        visit(child, node.ignored || role === 'generic' || role === 'none' ? depth : depth + 1)
    }
  }
  if (nodes[0]) visit(nodes[0], 0)
  return lines.join('\n').slice(0, limit)
}

const axTreeSchema = mutableStruct({
  nodes: Schema.Array(
    mutableStruct({
      nodeId: Schema.String,
      ignored: Schema.optional(Schema.Boolean),
      role: Schema.optional(mutableStruct({ value: Schema.optional(Schema.String) })),
      name: Schema.optional(mutableStruct({ value: Schema.optional(Schema.String) })),
      childIds: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})
const screenshotSchema = mutableStruct({ data: Schema.String })
const historySchema = mutableStruct({
  currentIndex: Schema.Number,
  entries: Schema.Array(mutableStruct({ id: Schema.Number })),
})

/** Minimal page-scoped CDP client for one command at a time. */
class PageCdp {
  private socket: WebSocket
  private sequence = 0
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private events = new Map<string, () => void>()
  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (raw) => {
      let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(raw.toString()) as typeof message
      } catch {
        return
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error)
          pending.reject(new HttpError(400, message.error.message ?? 'Browser command failed'))
        else pending.resolve(message.result)
      } else if (message.method) this.events.get(message.method)?.()
    })
    socket.once('close', () => {
      for (const pending of this.pending.values())
        pending.reject(new HttpError(503, 'Desktop browser disconnected'))
      this.pending.clear()
    })
  }
  static async open(endpoint: string) {
    const socket = new WebSocket(endpoint, { maxPayload: 16 * 1024 * 1024 })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new HttpError(504, 'Desktop browser connection timed out')),
        10000,
      )
      socket.once('open', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    return new PageCdp(socket)
  }
  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }
  onceEvent(method: string) {
    return new Promise<void>((resolve) => this.events.set(method, resolve))
  }
  close() {
    this.socket.close()
  }
}

const keys: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}

/** Locate one element in the page. Desktop tabs support CSS selectors and `text=` lookups. */
function finderExpression(selector: string, action: 'click' | 'fill', text?: string) {
  if (/^(role|xpath|id|data-testid)=/.test(selector))
    throw new HttpError(
      400,
      'Desktop browser tabs support CSS selectors and text= lookups. Use a CSS selector, or evaluate a script for role-based lookup.',
    )
  const locate = selector.startsWith('text=')
    ? `[...document.querySelectorAll('body *')].filter((el) => el.children.length === 0 || ['BUTTON','A','LABEL','LI','SPAN'].includes(el.tagName)).find((el) => (el.textContent ?? '').trim() === ${JSON.stringify(selector.slice(5).replace(/^"|"$/g, ''))})`
    : `document.querySelector(${JSON.stringify(selector)})`
  const act =
    action === 'click'
      ? `el.scrollIntoView({ block: 'center' }); el.click(); return true`
      : `{
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if ('value' in el && setter) setter.call(el, ${JSON.stringify(text ?? '')}); else if (el.isContentEditable) el.textContent = ${JSON.stringify(text ?? '')}; else throw new Error('Element is not fillable');
          el.dispatchEvent(new InputEvent('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true
        }`
  return `(() => { const el = ${locate}; if (!el) throw new Error('No element matches selector'); ${act} })()`
}

const withTimeout = async <T>(pending: Promise<T>, ms: number): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms))),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Run one agent browser command against a live desktop Browser-workspace tab. */
export async function desktopBrowserCommand(
  id: string,
  command: AgentBrowserCommand,
  authorize: () => void,
) {
  authorize()
  const target = desktopBrowserTarget(id)
  if (!target)
    throw new HttpError(
      404,
      'Desktop browser tab not found. Open the tab in the desktop Browser workspace, then list sessions again.',
    )
  const cdp = await PageCdp.open(target.endpoint)
  try {
    authorize()
    await cdp.send('Page.enable')
    const loaded = () => withTimeout(cdp.onceEvent('Page.loadEventFired'), 10000)
    let scriptResult: unknown
    switch (command.action) {
      case 'close':
        await cdp.send('Page.close')
        return { ok: true as const }
      case 'navigate': {
        const waiting = loaded()
        await cdp.send('Page.navigate', { url: previewUrl(command.url) })
        await waiting
        break
      }
      case 'back':
      case 'forward': {
        const history = decode(historySchema, await cdp.send('Page.getNavigationHistory'))
        const entry = history.entries[history.currentIndex + (command.action === 'back' ? -1 : 1)]
        if (!entry) throw new HttpError(400, `Cannot go ${command.action} in this tab`)
        const waiting = loaded()
        await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
        await waiting
        break
      }
      case 'reload': {
        const waiting = loaded()
        await cdp.send('Page.reload')
        await waiting
        break
      }
      case 'evaluate':
        scriptResult = await browserScript(cdp as unknown as CDPSession, command.script)
        break
      case 'click':
        await browserScript(
          cdp as unknown as CDPSession,
          finderExpression(command.selector, 'click'),
        )
        break
      case 'fill':
        await browserScript(
          cdp as unknown as CDPSession,
          finderExpression(command.selector, 'fill', command.text),
        )
        break
      case 'key': {
        const named = keys[command.key]
        if (!named && command.key.length === 1)
          await cdp.send('Input.insertText', { text: command.key })
        else if (named) {
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: named.key,
            code: named.code,
            windowsVirtualKeyCode: named.keyCode,
            ...(named.text ? { text: named.text } : {}),
          })
          await cdp.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: named.key,
            code: named.code,
            windowsVirtualKeyCode: named.keyCode,
          })
        } else
          throw new HttpError(400, `Desktop browser tabs do not support the key: ${command.key}`)
        break
      }
      case 'scroll':
        await browserScript(
          cdp as unknown as CDPSession,
          `window.scrollBy(0, ${JSON.stringify(command.deltaY)})`,
        )
        break
      case 'snapshot':
        break
    }
    authorize()
    const page = decode(
      mutableStruct({ url: Schema.String, title: Schema.String }),
      await browserScript(
        cdp as unknown as CDPSession,
        '({ url: location.href, title: document.title })',
      ),
    )
    await cdp.send('Accessibility.enable')
    const tree = decode(axTreeSchema, await cdp.send('Accessibility.getFullAXTree'))
    const screenshot = decode(
      screenshotSchema,
      await cdp.send('Page.captureScreenshot', { format: 'png' }),
    )
    return {
      ok: true as const,
      ...(command.action === 'evaluate' ? { result: scriptResult } : {}),
      url: page.url,
      title: page.title,
      snapshot: formatAxSnapshot(
        tree.nodes.map((node) => ({
          ...node,
          childIds: node.childIds ? [...node.childIds] : undefined,
        })),
      ),
      image: screenshot.data,
    }
  } finally {
    cdp.close()
  }
}
