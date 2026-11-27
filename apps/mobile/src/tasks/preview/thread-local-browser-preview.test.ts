import { decode, type RuntimeProfile } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { prepareThreadLocalPreview, threadLocalPreviewOrigin } from './thread-local-browser-preview'
import type { useRuntime } from '../../runtime/connection/provider'

type Read = ReturnType<typeof useRuntime>['readRuntime']
const computer: RuntimeProfile = {
  id: 'paired',
  name: 'Paired computer',
  connection: { address: 'http://computer.local:8790', token: 'fixture-device-token' },
}
const url = 'http://localhost:5173/docs?q=one#anchor'

it('accepts only HTTP loopback pages without credentials', () => {
  expect(threadLocalPreviewOrigin(url)).toBe('http://localhost:5173')
  expect(threadLocalPreviewOrigin('http://[::1]:8080/api')).toBe('http://[::1]:8080')
  for (const page of [
    'https://localhost:5173',
    'http://localhost.example.org',
    'http://user:password@localhost:5173',
    'file:///localhost',
    'localhost:5173',
  ]) {
    expect(threadLocalPreviewOrigin(page)).toBeUndefined()
  }
})

it('opens the owning computer’s page, requests a scoped ticket, and closes its temporary tab', async () => {
  const requests: { path: string; input: unknown }[] = []
  const read: Read = async (profile, path, input, schema) => {
    expect(profile).toBe(computer)
    requests.push({ path, input })
    if (path.endsWith('/open'))
      return decode(schema, { ticket: 'browser-ticket', tabId: 'test-tab', host: 'computer' })
    if (path.endsWith('/ticket')) return decode(schema, { ticket: 'preview-ticket' })
    return decode(schema, { ok: true })
  }
  const abort = new AbortController()
  const ticket = await prepareThreadLocalPreview(
    read,
    computer,
    'task',
    'test-tab',
    url,
    abort.signal,
  )
  const socket = new URL(await ticket())
  expect(socket).toMatchObject({
    protocol: 'ws:',
    host: 'computer.local:8790',
    pathname: '/ws/local-preview',
  })
  expect(socket.searchParams.get('ticket')).toBe('preview-ticket')
  abort.abort()
  await expect(ticket()).rejects.toHaveProperty('name', 'AbortError')
  expect(requests).toEqual([
    { path: '/api/previews/browser/open', input: { taskId: 'task', tabId: 'test-tab', url } },
    {
      path: '/api/previews/browser/local-preview/ticket',
      input: { taskId: 'task', tabId: 'test-tab', origin: 'http://localhost:5173' },
    },
    { path: '/api/previews/browser/close', input: { taskId: 'task', tabId: 'test-tab' } },
  ])
})

it('closes a tab that finishes opening after the mobile preview has been dismissed', async () => {
  const requests: string[] = []
  const opened = Promise.withResolvers<void>()
  const read: Read = async (_profile, path, _input, schema) => {
    requests.push(path)
    if (path.endsWith('/open')) {
      await opened.promise
      return decode(schema, { ticket: 'browser-ticket', tabId: 'test-tab', host: 'computer' })
    }
    return decode(schema, { ok: true })
  }
  const abort = new AbortController()
  const preparing = prepareThreadLocalPreview(read, computer, 'task', 'test-tab', url, abort.signal)
  abort.abort()
  opened.resolve()
  await expect(preparing).rejects.toHaveProperty('name', 'AbortError')
  expect(requests).toEqual(['/api/previews/browser/open', '/api/previews/browser/close'])
})
