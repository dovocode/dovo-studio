import { expect, it } from 'vite-plus/test'
import { createServer } from 'node:http'
import { readRoutineSource } from './source-monitor'
it('reads real HTTP sources, follows bounded redirects, rejects large bodies and invalid schemes', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/source' })
      res.end()
      return
    }
    if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' })
      res.end()
      return
    }
    if (req.url === '/large') {
      res.end('x'.repeat(512 * 1024 + 1))
      return
    }
    if (req.url === '/error') {
      res.writeHead(503)
      res.end('Unavailable')
      return
    }
    res.end('Release 1')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No source address')
  const base = `http://127.0.0.1:${address.port}`
  try {
    const source = await readRoutineSource(base + '/redirect', AbortSignal.timeout(5000))
    expect(source.text).toBe('Release 1')
    expect(source.url).toBe(base + '/source')
    expect((await readRoutineSource(base + '/source', AbortSignal.timeout(5000))).hash).toBe(
      source.hash,
    )
    await expect(readRoutineSource(base + '/large', AbortSignal.timeout(5000))).rejects.toThrow(
      /512 KiB/,
    )
    await expect(readRoutineSource(base + '/loop', AbortSignal.timeout(5000))).rejects.toThrow(
      /redirected/,
    )
    await expect(readRoutineSource(base + '/error', AbortSignal.timeout(5000))).rejects.toThrow(
      /503/,
    )
    await expect(
      readRoutineSource('file:///etc/passwd', AbortSignal.timeout(5000)),
    ).rejects.toThrow(/HTTP/)
    await expect(
      readRoutineSource('http://user:password@localhost', AbortSignal.timeout(5000)),
    ).rejects.toThrow(/credentials/)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
})
