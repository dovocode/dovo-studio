import { it, expect, vi } from 'vite-plus/test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createBrowserCdp } from './browser-cdp'

it('isolates page discovery, forwards CDP, blocks application targets and revokes sockets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cdp-test-'))
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
  const contents = {
    debugger: debuggerApi,
    getTitle: () => 'Preview',
    getURL: () => 'https://example.com',
    isDestroyed: () => false,
  }
  const bridge = await createBrowserCdp(directory)
  let socket: WebSocket | undefined
  try {
    const endpoint = bridge.register('1', 'task-a', 'work', contents)
    bridge.register('2', 'task-b', 'personal', contents)
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
    expect(statSync(join(directory, 'desktop-browser-host.json')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(directory, 'desktop-browser-host.json'), 'utf8')).toContain('task-a')
    socket = new WebSocket(endpoint)
    const client = socket
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
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
    expect(debuggerApi.sendCommand).toHaveBeenCalledOnce()
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()))
    bridge.remove('1')
    await closed
    expect((await fetch(`http://${url.host}/${token}/json/list`)).status).toBe(404)
  } finally {
    socket?.terminate()
    await bridge.close()
    expect(existsSync(join(directory, 'desktop-browser-host.json'))).toBe(false)
    rmSync(directory, { recursive: true, force: true })
  }
})
