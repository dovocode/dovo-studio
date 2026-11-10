import { WebSocket } from 'ws'
import {
  decode,
  mutableStruct,
  previewUrl,
  STUDIO_BROWSER_SCOPE,
  isPrivateBrowserProfile,
  remoteBrowserInputSchema,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../errors.js'
import type { AgentBrowserCommand } from './agent-browser.js'
import { browserScript, browserScriptResult } from './browser-script.js'
import { staleBrowserRef, nextBrowserSnapshotId } from './browser-targets.js'
import { browserObservationSchema, readBrowserObservation } from './browser-observation.js'
import { readDesktopBrowserTargets, type DesktopBrowserTarget } from './desktop-browser-host.js'

export const DESKTOP_BROWSER_PREFIX = 'desktop:'
const snapshots = new Map<string, { document: number; url: string; refs: Map<string, number> }>()
const commands = new Map<string, Promise<void>>()

export function desktopWorkspaceTargets(): DesktopBrowserTarget[] {
  const targets = readDesktopBrowserTargets().filter(
    (target) =>
      target.taskId === STUDIO_BROWSER_SCOPE &&
      !!target.tabId &&
      !isPrivateBrowserProfile(target.profileId),
  )
  const endpoints = new Set(targets.map((target) => target.endpoint))
  for (const endpoint of snapshots.keys()) if (!endpoints.has(endpoint)) snapshots.delete(endpoint)
  return targets
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
  childIds?: readonly string[]
  backendDOMNodeId?: number
  value?: { value?: string | number | boolean }
  properties?: readonly { name: string; value: { value?: string | number | boolean } }[]
}

/** Format a CDP accessibility tree like a compact aria snapshot (bounded, readable lines). */
export function formatAxSnapshot(
  nodes: readonly AxNode[],
  limit = 32000,
  refFor?: (node: AxNode) => string | undefined,
): string {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const lines: string[] = []
  const visit = (node: AxNode, depth: number) => {
    if (lines.join('').length > limit || depth > 40) return
    const role = node.role?.value ?? 'generic'
    const name = (node.name?.value ?? '').replace(/\s+/g, ' ').trim()
    if (!node.ignored && role !== 'generic' && role !== 'none') {
      const ref = refFor?.(node)
      const states = (node.properties ?? [])
        .filter((property) =>
          ['disabled', 'checked', 'selected', 'expanded', 'required', 'readonly', 'level'].includes(
            property.name,
          ),
        )
        .map((property) => ` [${property.name}=${JSON.stringify(property.value.value)}]`)
        .join('')
      const value = !['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)
        ? node.value?.value
        : undefined
      lines.push(
        `${'  '.repeat(depth)}- ${role}${name ? ` ${JSON.stringify(name)}` : ''}${ref ? ` [ref=${ref}]` : ''}${states}${value !== undefined ? `: ${JSON.stringify(value)}` : ''}`,
      )
    }
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
      backendDOMNodeId: Schema.optional(Schema.Number),
      value: Schema.optional(
        mutableStruct({
          value: Schema.optional(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
        }),
      ),
      properties: Schema.optional(
        Schema.Array(
          mutableStruct({
            name: Schema.String,
            value: mutableStruct({
              value: Schema.optional(Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
            }),
          }),
        ),
      ),
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
        message = JSON.parse(
          (Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw)
          ).toString('utf8'),
        ) as typeof message
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
    socket.on('error', () => socket.close())
  }
  static async open(endpoint: string) {
    const socket = new WebSocket(endpoint, { maxPayload: 16 * 1024 * 1024 })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new HttpError(504, 'Desktop browser connection timed out'))
      }, 10000)
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
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new HttpError(
            504,
            `Desktop browser command timed out: ${method}. Inspect the page before retrying an action.`,
          ),
        )
      }, 10000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) {
          this.pending.delete(id)
          clearTimeout(timer)
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
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}

type ElementCommand =
  | { action: 'click' }
  | { action: 'focus' }
  | { action: 'fill'; text: string }
  | { action: 'scroll'; deltaY: number }

function elementAction(command: ElementCommand) {
  if (command.action === 'click')
    return `el.scrollIntoView({ block: 'center' }); el.click(); return true`
  if (command.action === 'focus')
    return `el.focus({ preventScroll: true }); if (document.activeElement !== el && !el.contains(document.activeElement)) throw new Error('Element cannot receive keyboard input'); return true`
  if (command.action === 'scroll')
    return `el.scrollBy(0, ${JSON.stringify(command.deltaY)}); return true`
  return `{
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if ('value' in el && setter) setter.call(el, ${JSON.stringify(command.text)}); else if (el.isContentEditable) el.textContent = ${JSON.stringify(command.text)}; else throw new Error('Element is not fillable');
        el.dispatchEvent(new InputEvent('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true
      }`
}

/** Locate exactly one element; never fall back to the user's focused page or control. */
function finderExpression(selector: string, command: ElementCommand) {
  if (/^(role|xpath|id|data-testid)=/.test(selector))
    throw new HttpError(
      400,
      'Desktop browser tabs support CSS selectors and text= lookups. Use a CSS selector, or evaluate a script for role-based lookup.',
    )
  const matches = selector.startsWith('text=')
    ? `[...document.querySelectorAll('body *')].filter((el) => el.children.length === 0 || ['BUTTON','A','LABEL','LI','SPAN'].includes(el.tagName)).filter((el) => (el.textContent ?? '').trim() === ${JSON.stringify(selector.slice(5).replace(/^"|"$/g, ''))})`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})]`
  return `(() => { const matches = ${matches}; if (matches.length !== 1) throw new Error('Expected one element; found ' + matches.length + '. Take a fresh snapshot and use its ref.'); const el = matches[0]; ${elementAction(command)} })()`
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

async function actOnElement(
  cdp: PageCdp,
  endpoint: string,
  selector: string,
  command: ElementCommand,
  authorize: () => void,
) {
  if (!selector.startsWith('ref=')) {
    await browserScript(cdp, finderExpression(selector, command))
    return
  }
  const snapshot = snapshots.get(endpoint)
  const backendNodeId = snapshot?.refs.get(selector.slice(4))
  if (!snapshot || backendNodeId === undefined) throw staleBrowserRef()
  const resolved = decode(
    mutableStruct({ object: mutableStruct({ objectId: Schema.optional(Schema.String) }) }),
    await cdp.send('DOM.resolveNode', { backendNodeId }),
  )
  const objectId = resolved.object.objectId
  if (!objectId) throw staleBrowserRef()
  try {
    authorize()
    browserScriptResult(
      await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() { const el = this; if (!el.isConnected || el.ownerDocument !== document || performance.timeOrigin !== ${snapshot.document} || location.href !== ${JSON.stringify(snapshot.url)}) throw new Error('This element reference is stale. Take a fresh snapshot.'); ${elementAction(command)} }`,
        returnByValue: true,
      }),
    )
  } finally {
    await cdp.send('Runtime.releaseObject', { objectId })
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
  const operation = (commands.get(target.endpoint) ?? Promise.resolve()).then(() =>
    runDesktopBrowserCommand(id, command, authorize, target.endpoint),
  )
  const settled = operation.then(
    () => {},
    () => {},
  )
  commands.set(target.endpoint, settled)
  try {
    return await operation
  } finally {
    if (commands.get(target.endpoint) === settled) commands.delete(target.endpoint)
  }
}

async function runDesktopBrowserCommand(
  id: string,
  command: AgentBrowserCommand,
  authorize: () => void,
  endpoint: string,
) {
  authorize()
  const target = desktopBrowserTarget(id)
  if (!target || target.endpoint !== endpoint)
    throw new HttpError(
      404,
      'Desktop browser tab not found. Open the tab in the desktop Browser workspace, then list sessions again.',
    )
  const cdp = await PageCdp.open(target.endpoint)
  try {
    authorize()
    await cdp.send('Page.enable')
    if (['navigate', 'back', 'forward', 'reload', 'close'].includes(command.action))
      snapshots.delete(target.endpoint)
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
        scriptResult = await browserScript(cdp, command.script)
        break
      case 'click':
      case 'fill': {
        await actOnElement(cdp, target.endpoint, command.selector, command, authorize)
        break
      }
      case 'key': {
        decode(remoteBrowserInputSchema, { type: 'key', key: command.key })
        const named = keys[command.key]
        if (!named && command.key.length !== 1)
          throw new HttpError(400, `Desktop browser tabs do not support the key: ${command.key}`)
        if (command.selector)
          await actOnElement(cdp, target.endpoint, command.selector, { action: 'focus' }, authorize)
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
        if (command.selector)
          await actOnElement(cdp, target.endpoint, command.selector, command, authorize)
        else await browserScript(cdp, `window.scrollBy(0, ${JSON.stringify(command.deltaY)})`)
        break
      case 'snapshot':
      case 'screenshot':
        break
    }
    authorize()
    const page = decode(
      mutableStruct({ url: Schema.String, title: Schema.String, document: Schema.Number }),
      await browserScript(
        cdp,
        '({ url: location.href, title: document.title, document: performance.timeOrigin })',
      ),
    )
    const details = {
      ok: true as const,
      url: page.url,
      title: page.title,
    }
    if (command.action === 'evaluate') return { ...details, result: scriptResult }
    if (command.action === 'screenshot') {
      const screenshot = decode(
        screenshotSchema,
        await cdp.send('Page.captureScreenshot', { format: 'png' }),
      )
      return { ...details, image: screenshot.data }
    }
    await cdp.send('Accessibility.enable')
    snapshots.delete(target.endpoint)
    const tree = decode(axTreeSchema, await cdp.send('Accessibility.getFullAXTree'))
    const refs = new Map<string, number>()
    const generation = nextBrowserSnapshotId()
    const snapshot = formatAxSnapshot(tree.nodes, 32001, (node) => {
      if (!node.backendDOMNodeId) return undefined
      const ref = `${generation}-${node.nodeId}`
      refs.set(ref, node.backendDOMNodeId)
      return ref
    })
    snapshots.set(target.endpoint, { document: page.document, url: page.url, refs })
    return {
      ...details,
      snapshot: snapshot.slice(0, 32000),
      snapshotTruncated: snapshot.length > 32000,
      ...decode(
        browserObservationSchema,
        await browserScript(cdp, `(${readBrowserObservation.toString()})()`),
      ),
    }
  } finally {
    cdp.close()
  }
}
