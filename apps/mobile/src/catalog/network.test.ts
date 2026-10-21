import { afterEach, expect, test, vi } from 'vite-plus/test'
import { isolateCatalogNetwork } from './network'

afterEach(() => vi.unstubAllGlobals())

test('catalog blocks direct service traffic while retaining local Metro access', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('Metro'))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('WebSocket', globalThis.WebSocket)
  isolateCatalogNetwork()

  for (const url of [
    'https://connect.dovo.studio/api/account',
    'http://192.168.0.10:51464/api/runtime',
    'http://localhost:51464/api/runtime',
    'http://localhost.example.test:8081/',
  ]) {
    await expect(globalThis.fetch(url)).rejects.toThrow('disabled')
    expect(() => new WebSocket(url.replace(/^http/, 'ws'))).toThrow('disabled')
  }
  expect(fetch).not.toHaveBeenCalled()
  await expect(globalThis.fetch('http://localhost:8081/status')).resolves.toBeInstanceOf(Response)
  expect(fetch).toHaveBeenCalledOnce()
})
