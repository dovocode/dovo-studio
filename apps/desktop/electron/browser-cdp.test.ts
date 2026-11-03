import { it, expect, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createBrowserCdp } from './browser-cdp'
import { decode, desktopBrowserHostSchema } from '@dovo/protocol'

async function expectRejectedSocket(endpoint: string, origin?: string) {
  const client = new WebSocket(endpoint, { origin })
  await new Promise<void>((resolve, reject) => {
    client.once('error', () => resolve())
    client.once('open', () => {
      client.terminate()
      reject(new Error('Unauthorized CDP connection opened'))
    })
  })
}

function createContents() {
  let attached = false
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn<() => void>(() => {
      attached = true
    }),
    detach: vi.fn<() => void>(() => {
      attached = false
    }),
    sendCommand: vi.fn<
      (
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
      ) => Promise<{ result: { type: string; value: number } }>
    >(async () => ({ result: { type: 'number', value: 42 } })),
  })
  return {
    debugger: debuggerApi,
    getTitle: () => 'Preview',
    getURL: () => 'https://example.com',
    isDestroyed: () => false,
  }
}

it('isolates page discovery, forwards CDP, blocks application targets and revokes sockets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cdp-test-'))
  const contents = createContents()
  const debuggerApi = contents.debugger
  const bridge = await createBrowserCdp(directory)
  let socket: WebSocket | undefined
  try {
    // The IPC caller keys registrations by window and tab, not a numeric page ID.
    const key = JSON.stringify([1, 'studio:browser:tab-a'])
    const endpoint = bridge.register(key, 'task-a', 'work', contents)
    bridge.register(JSON.stringify([2, 'task-b']), 'task-b', 'personal', contents)
    bridge.register(
      JSON.stringify([1, 'studio:browser:tab-shared']),
      'studio:browser',
      'work',
      contents,
      'tab-shared',
    )
    expect(bridge.register(key, 'task-a', 'work', contents)).toBe(endpoint)
    const hostFile = JSON.parse(
      readFileSync(join(directory, 'desktop-browser-host.json'), 'utf8'),
    ) as { targets: { taskId: string; tabId?: string; profileId: string }[] }
    expect(hostFile.targets).toContainEqual(
      expect.objectContaining({ taskId: 'studio:browser', tabId: 'tab-shared', profileId: 'work' }),
    )
    expect(hostFile.targets.find((target) => target.taskId === 'task-a')?.tabId).toBeUndefined()
    const url = new URL(endpoint)
    const token = url.pathname.split('/')[1]
    const discovery = await fetch(`http://${url.host}/${token}/json/list`)
    const pages: unknown = await discovery.json()
    expect(pages).toEqual([
      {
        id: '1',
        type: 'page',
        title: 'Preview',
        url: 'https://example.com',
        webSocketDebuggerUrl: endpoint,
      },
    ])
    expect((await fetch(`http://${url.host}/wrong/json/list`)).status).toBe(404)
    await expectRejectedSocket(endpoint.replace('/page/1', '/page/2'))
    await expectRejectedSocket(endpoint.replace(`/${token}/`, `/${'0'.repeat(64)}/`))
    await expectRejectedSocket(endpoint, 'https://example.com')
    expect(statSync(join(directory, 'desktop-browser-host.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(directory, 'desktop-browser-host.json'), 'utf8')).toContain('task-a')
    socket = new WebSocket(endpoint)
    const client = socket
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    expect(bridge.connected(key)).toBe(true)
    const command = (id: number, method: string) =>
      new Promise<unknown>((resolve) => {
        client.once('message', (raw) =>
          resolve(JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : 'null')),
        )
        client.send(JSON.stringify({ id, method, params: {} }))
      })
    expect(await command(1, 'Runtime.evaluate')).toEqual({
      id: 1,
      result: { result: { type: 'number', value: 42 } },
    })
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith('Runtime.evaluate', {}, undefined)
    expect(await command(2, 'Target.getTargets')).toMatchObject({
      id: 2,
      error: { message: expect.stringContaining('page-scoped') },
    })
    expect(await command(3, 'Browser.getVersion')).toMatchObject({
      id: 3,
      error: { message: expect.stringContaining('page-scoped') },
    })
    expect(debuggerApi.sendCommand).toHaveBeenCalledOnce()
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
    bridge.remove(key)
    await closed
    expect(bridge.connected(key)).toBe(false)
    expect((await fetch(`http://${url.host}/${token}/json/list`)).status).toBe(404)
    await expectRejectedSocket(endpoint)
    const replacement = bridge.register(key, 'task-a', 'work', contents)
    expect(replacement).not.toBe(endpoint)
    expect(new URL(replacement).pathname.split('/').at(-1)).not.toBe('1')
  } finally {
    socket?.terminate()
    await bridge.close()
    expect(existsSync(join(directory, 'desktop-browser-host.json'))).toBe(false)
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps failed registrations and metadata updates out of live targets, preserving discovery on cleanup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cdp-transaction-'))
  const bridge = await createBrowserCdp(directory)
  const contents = createContents()
  const path = join(directory, 'desktop-browser-host.json')
  const readHost = () => decode(desktopBrowserHostSchema, JSON.parse(readFileSync(path, 'utf8')))
  const key = JSON.stringify([7, 'shared:tab/opaque?key#one'])
  const retryKey = 'shared:tab/opaque?key#two'
  let socket: WebSocket | undefined
  try {
    const endpoint = bridge.register(key, 'survivor', 'work', contents, 'original-tab')
    const original = readHost()
    // A directory at the atomic-write path makes publication fail with a real I/O error.
    mkdirSync(`${path}.tmp`)
    try {
      expect(() => bridge.register(retryKey, 'failed-task', 'work', contents)).toThrow(/EISDIR/)
      expect(() => bridge.register(key, 'survivor', 'work', contents, 'failed-tab')).toThrow(
        /EISDIR/,
      )
      expect(readHost()).toEqual(original)
    } finally {
      rmSync(`${path}.tmp`, { recursive: true, force: true })
    }
    bridge.register(retryKey, 'retry-task', 'work', contents)
    expect(readHost().targets).toEqual([
      original.targets[0],
      expect.objectContaining({ taskId: 'retry-task' }),
    ])
    bridge.remove(retryKey)
    expect(readHost()).toEqual(original)
    const url = new URL(endpoint)
    const discovery = await fetch(`http://${url.host}/${url.pathname.split('/')[1]}/json/list`)
    expect(await discovery.json()).toEqual([
      expect.objectContaining({ webSocketDebuggerUrl: endpoint }),
    ])
    socket = new WebSocket(readHost().targets[0]!.endpoint)
    const client = socket
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    expect(bridge.connected(key)).toBe(true)
  } finally {
    socket?.terminate()
    await bridge.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('cleans up after the first registration fails without publishing a failed target', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cdp-first-save-'))
  const bridge = await createBrowserCdp(directory)
  const path = join(directory, 'desktop-browser-host.json')
  const key = JSON.stringify([1, 'shared:first-tab'])
  try {
    mkdirSync(`${path}.tmp`)
    expect(() => bridge.register(key, 'task', 'work', createContents())).toThrow(/EISDIR/)
    rmSync(`${path}.tmp`, { recursive: true })
    bridge.remove(key)
    expect(existsSync(path)).toBe(false)
  } finally {
    await bridge.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
