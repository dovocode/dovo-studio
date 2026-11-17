import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readFile, access } from 'node:fs/promises'

type Event = {
  trusted: boolean
  sender: { id: number; startDrag: (value: { file: string }) => void }
  returnValue?: { error?: string }
}
const bridge = vi.hoisted(() => ({
  prepare: undefined as
    | ((event: Event, name: unknown, bytes: unknown) => Promise<string>)
    | undefined,
  start: undefined as ((event: Event, id: unknown) => void) | undefined,
  quit: undefined as (() => void) | undefined,
}))
vi.mock('electron', () => ({
  app: {
    getFileIcon: async () => ({}),
    once: (_name: string, callback: () => void) => {
      bridge.quit = callback
    },
  },
  ipcMain: {
    handle: (_name: string, callback: NonNullable<typeof bridge.prepare>) => {
      bridge.prepare = callback
    },
    on: (_name: string, callback: NonNullable<typeof bridge.start>) => {
      bridge.start = callback
    },
  },
}))
vi.mock('./renderer-trust.js', () => ({
  requireTrustedRenderer: (event: Event) => {
    if (!event.trusted) throw new Error('Untrusted desktop request')
  },
}))
import { registerFileDrag } from './file-drag.js'
afterEach(() => {
  bridge.quit?.()
  vi.useRealTimers()
})

it('drags only a staged file owned by the trusted renderer and expires it', async () => {
  registerFileDrag('/app/index.html')
  if (!bridge.prepare || !bridge.start) throw new Error('Missing drag handlers')
  const startDrag = vi.fn<(value: { file: string }) => void>()
  const event: Event = { trusted: true, sender: { id: 1, startDrag } }
  const id = await bridge.prepare(event, 'Report.txt', new TextEncoder().encode('Report content'))
  bridge.start(event, id)
  expect(event.returnValue).toEqual({})
  const staged = startDrag.mock.calls[0]?.[0].file
  if (!staged) throw new Error('Missing staged file')
  expect(await readFile(staged, 'utf8')).toBe('Report content')
  const foreign: Event = { trusted: true, sender: { id: 2, startDrag } }
  bridge.start(foreign, id)
  expect(foreign.returnValue?.error).toContain('Prepare')
  await expect(
    bridge.prepare({ ...event, trusted: false }, 'file', new Uint8Array()),
  ).rejects.toThrow('Untrusted')
  await expect(bridge.prepare(event, '../secret', new Uint8Array())).rejects.toThrow('filename')
  await expect(bridge.prepare(event, 'large', new Uint8Array(33 * 1024 * 1024))).rejects.toThrow(
    '32 MB',
  )
  vi.useFakeTimers()
  vi.setSystemTime(Date.now() + 16 * 60_000)
  bridge.start(event, id)
  expect(event.returnValue?.error).toContain('Prepare')
  bridge.quit?.()
  await vi.waitFor(async () => {
    await expect(access(staged)).rejects.toThrow('ENOENT')
  })
})
