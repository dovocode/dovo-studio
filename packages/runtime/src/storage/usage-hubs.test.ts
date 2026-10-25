import { expect, it, vi } from 'vite-plus/test'
import { createServer, type IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { openDatabase } from './database.js'
import { UsageHubs } from './usage-hubs.js'
import { reportedUsageAccount } from '../agents/tasks/usage-account.js'
async function hub(handler: (path: string, request: IncomingMessage) => unknown) {
  const server = createServer((request, response) => {
    void Promise.resolve()
      .then(() => handler(request.url ?? '', request))
      .then((value) => {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(value))
      })
      .catch(() => {
        response.statusCode = 500
        response.end('secret-management-key')
      })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No hub address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
async function json(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString()) as {
    auth_index: string
    url: string
    header: Record<string, string>
  }
}
it('reads enabled accounts over HTTP, deduplicates Codex identity, supports scoped Claude windows and never publishes keys', async () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  const calls: string[] = []
  const remote = await hub(async (path, request) => {
    expect(request.headers.authorization).toBe('Bearer secret-management-key')
    calls.push(path)
    if (path.endsWith('auth-files'))
      return {
        files: [
          {
            id: 'codex',
            auth_index: '1',
            provider: 'codex',
            email: 'user@example.com',
            id_token: { chatgpt_account_id: 'workspace' },
          },
          { id: 'claude', auth_index: '2', provider: 'claude' },
          { id: 'disabled', auth_index: '3', provider: 'codex', disabled: true },
          { id: 'unsupported', auth_index: '4', provider: 'gemini' },
        ],
      }
    const input = await json(request)
    expect(input.header.Authorization).toBe('Bearer $TOKEN$')
    return {
      status_code: 200,
      body: JSON.stringify(
        input.auth_index === '1'
          ? {
              plan_type: 'pro',
              rate_limit: {
                primary_window: {
                  used_percent: 25,
                  limit_window_seconds: 18000,
                  reset_at: 2000000000,
                },
                secondary_window: { used_percent: 50, limit_window_seconds: 604800 },
              },
            }
          : {
              five_hour: { utilization: 10, resets_at: null },
              limits: [
                { kind: 'weekly_scoped', percent: 70, scope: { model: { display_name: 'Opus' } } },
                { kind: 'ignored', percent: null, scope: null },
              ],
            },
      ),
    }
  })
  try {
    const saved = hubs.save({
      label: 'Home',
      url: remote.url + '/v0/management/',
      managementKey: 'secret-management-key',
      enabled: true,
    })
    expect(saved.url).toBe(remote.url + '/')
    const [a, b] = await Promise.all([hubs.read(), hubs.read()])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(3)
    expect(a[0]?.limits).toHaveLength(4)
    expect(a[0]?.limits.find((limit) => limit.provider === 'codex')?.account?.id).toBe(
      reportedUsageAccount('codex', 'account/read', {
        account: { type: 'chatgpt', email: 'user@example.com', planType: 'pro' },
        workspaceRouting: { chatgptAccountId: 'workspace' },
      })?.id,
    )
    expect(a[0]?.limits.find((limit) => limit.window === 'Weekly · Opus')?.usedPercent).toBe(70)
    expect(JSON.stringify(a)).not.toContain('secret-management-key')
    expect(new UsageHubs(db).list()).toEqual(a)
    await hubs.read()
    expect(calls).toHaveLength(3)
    hubs.save({ id: saved.id, label: 'Renamed', url: remote.url, enabled: true })
    await hubs.read()
    expect(calls).toHaveLength(6)
    expect(() =>
      hubs.save({ id: saved.id, label: 'Other', url: 'http://different', enabled: true }),
    ).toThrow('management key')
    hubs.save({ id: saved.id, label: 'Disabled', url: remote.url, enabled: false })
    expect((await hubs.read())[0]?.limits).toEqual([])
    expect(calls).toHaveLength(6)
  } finally {
    db.close()
    await remote.close()
  }
})
it('sanitizes failures, keeps last reading offline, and applies cooldown to failures', async () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  let fail = false,
    calls = 0
  const remote = await hub((path) => {
    calls++
    if (fail) throw new Error('secret-management-key')
    return path.endsWith('auth-files')
      ? { files: [{ id: 'a', auth_index: '1', provider: 'codex' }] }
      : {
          status_code: 200,
          body: JSON.stringify({ rate_limit: { primary_window: { used_percent: 40 } } }),
        }
  })
  try {
    hubs.save({
      label: 'Home',
      url: remote.url,
      managementKey: 'secret-management-key',
      enabled: true,
    })
    const initial = await hubs.read()
    fail = true
    const failed = await hubs.read(true)
    expect(failed[0]?.limits).toEqual(initial[0]?.limits)
    expect(failed[0]?.error).toContain('could not report')
    expect(JSON.stringify(failed)).not.toContain('secret-management-key')
    await hubs.read()
    expect(calls).toBe(3)
  } finally {
    db.close()
    await remote.close()
  }
})
it('reports partial failures explicitly and prevents in-flight reads resurrecting edited or removed hubs', async () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  let release: () => void = () => {},
    entered: () => void = () => {}
  const started = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve))
  const remote = await hub(async (path) => {
    if (path.endsWith('auth-files')) {
      entered()
      await gate
      return { files: [{ id: 'a', auth_index: '1', provider: 'codex' }] }
    }
    return { status_code: 429, body: 'secret-management-key' }
  })
  try {
    const saved = hubs.save({
      label: 'Home',
      url: remote.url,
      managementKey: 'secret-management-key',
      enabled: true,
    })
    const pending = hubs.read()
    await started
    hubs.save({ ...saved, label: 'Edited' })
    release()
    expect((await pending)[0]).toMatchObject({ label: 'Edited', limits: [] })
    const partial = await hubs.read(true)
    expect(partial[0]?.error).toBe('1 of 1 accounts could not report limits.')
    const pendingRemoval = hubs.read(true)
    hubs.remove(saved.id)
    expect(await pendingRemoval).toEqual([])
    expect(new UsageHubs(db).list()).toEqual([])
  } finally {
    release()
    db.close()
    await remote.close()
  }
})
it('rejects credential-bearing or non-HTTP URLs and requires keys only for new destinations', () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  try {
    for (const url of [
      'file:///secret',
      'http://user:pass@hub',
      'https://hub/?key=secret',
      'https://hub/#secret',
    ])
      expect(() => hubs.save({ label: 'Bad', url, managementKey: 'key', enabled: true })).toThrow(
        'Use an HTTP or HTTPS',
      )
    expect(() => hubs.save({ label: 'Missing', url: 'http://hub', enabled: true })).toThrow(
      'management key',
    )
    expect(() =>
      hubs.save({
        id: 'unknown',
        label: 'Missing',
        url: 'http://hub',
        managementKey: 'key',
        enabled: true,
      }),
    ).toThrow('no longer exists')
  } finally {
    db.close()
  }
})

it('does not follow management redirects or leak authorization to the destination', async () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  let destinationCalls = 0
  const destination = await hub(() => {
    destinationCalls++
    return { files: [] }
  })
  const redirect = createServer((_, response) => {
    response.writeHead(302, { Location: destination.url })
    response.end()
  })
  redirect.listen(0, '127.0.0.1')
  await once(redirect, 'listening')
  try {
    const address = redirect.address()
    if (!address || typeof address === 'string') throw new Error('No address')
    hubs.save({
      label: 'Redirect',
      url: `http://127.0.0.1:${address.port}`,
      managementKey: 'secret-management-key',
      enabled: true,
    })
    expect((await hubs.read())[0]?.error).toContain('could not report')
    expect(destinationCalls).toBe(0)
  } finally {
    await hubs.dispose()
    db.close()
    await new Promise<void>((resolve) => redirect.close(() => resolve()))
    await destination.close()
  }
})
it('cancels pending hub requests before runtime storage closes', async () => {
  const db = openDatabase(':memory:')
  const hubs = new UsageHubs(db)
  let entered: () => void = () => {},
    release: () => void = () => {}
  const started = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve))
  const remote = await hub(async () => {
    entered()
    await gate
    return { files: [] }
  })
  try {
    hubs.save({ label: 'Pending', url: remote.url, managementKey: 'key', enabled: true })
    const reading = hubs.read()
    await started
    await hubs.dispose()
    expect(await reading).toEqual(hubs.list())
    expect(new UsageHubs(db).list()[0]?.checkedAt).toBeUndefined()
    db.close()
  } finally {
    release()
    if (db.open) db.close()
    await remote.close()
  }
})

it('bounds the whole hub refresh so queued hubs cannot outlive the client request', async () => {
  const db = openDatabase(':memory:'),
    hubs = new UsageHubs(db),
    deadline = new AbortController()
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  const timer = vi
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms) => (ms === 20000 ? deadline.signal : timeout(ms)))
  let entered: () => void = () => {},
    release: () => void = () => {}
  const started = new Promise<void>((resolve) => (entered = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve))
  const remote = await hub(async () => {
    entered()
    await gate
    return { files: [] }
  })
  try {
    for (const label of ['First', 'Second', 'Queued'])
      hubs.save({ label, url: remote.url, managementKey: 'key', enabled: true })
    const reading = hubs.read()
    await started
    deadline.abort()
    const result = await reading
    expect(result).toHaveLength(3)
    expect(result.every((value) => !!value.error)).toBe(true)
  } finally {
    timer.mockRestore()
    release()
    await hubs.dispose()
    db.close()
    await remote.close()
  }
})
