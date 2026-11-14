import { expect, it } from 'vite-plus/test'
import { createServer } from 'node:http'
import { readOpenCodeServerLimits } from './opencode-limits.js'
it('reads server budgets and Go windows with Basic auth and no model request', async () => {
  let status = 200,
    payload: unknown
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
    )
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const connection = {
    endpoint: `http://127.0.0.1:${address.port}`,
    env: { OPENCODE_SERVER_PASSWORD: 'secret' },
  }
  try {
    const reset = Date.now() + 3600000
    payload = {
      data: {
        workspace: { id: 'team', name: 'Team' },
        go: {
          rolling: { percent: 15, limited: false, resetsAt: reset },
          weekly: { percent: 70, limited: true, resetsAt: reset },
          monthly: { percent: 5, limited: false, resetsAt: reset },
        },
        budgets: [
          {
            id: 'b',
            limit: 20,
            spent: 14,
            scope: 'each',
            per: 'model',
            coverage: 'models',
            models: [
              { providerID: 'console', modelID: 'a', name: 'Model A', spent: 10 },
              { providerID: 'console', modelID: 'b', name: 'Model B', spent: 4 },
            ],
            shared: false,
            resetsAt: reset,
          },
        ],
      },
    }
    const result = await readOpenCodeServerLimits(connection)
    expect(result.account?.label).toBe('Team')
    expect(result.limits).toHaveLength(5)
    expect(result.limits[1]).toMatchObject({ usedPercent: 100, resetsAt: reset / 1000 })
    expect(result.limits[3]).toMatchObject({
      provider: 'opencode',
      modelIds: ['console/a'],
      usedPercent: 50,
    })
    expect(JSON.stringify(result)).not.toContain('secret')
    status = 404
    expect(await readOpenCodeServerLimits(connection)).toEqual({ account: undefined, limits: [] })
    status = 200
    payload = { data: null }
    expect(await readOpenCodeServerLimits(connection)).toEqual({ account: undefined, limits: [] })
    status = 503
    await expect(readOpenCodeServerLimits(connection)).rejects.toThrow('503')
    status = 401
    await expect(readOpenCodeServerLimits(connection)).rejects.toThrow('authentication')
    status = 200
    payload = { data: { workspace: { id: 'bad' }, budgets: [{}] } }
    await expect(readOpenCodeServerLimits(connection)).rejects.toThrow(/budgets|limit/)
    expect(requests.every((url) => url.startsWith('/api/experimental/usage/limits?'))).toBe(true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
