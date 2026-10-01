import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { OpenCodeServers, opencodeHeaders } from './opencode-server'
import { createOpenCodeAdapter } from './opencode'
import { runtimeIntegration } from '../../../testing/integration'
vi.setConfig(runtimeIntegration)
const agent = {
  id: 'agent',
  name: 'Test',
  provider: 'opencode' as const,
  endpoint: '',
  model: '',
  permission: 'read-only' as const,
  instructions: '',
}
// A real owned process exercises listener discovery, authentication and process-group cleanup.
const fixture = `
const http = require('node:http');
const password = process.env.FIXTURE_GENERATED_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD;
const expected = 'Basic ' + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ':' + password).toString('base64');
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expected) { response.writeHead(401); response.end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/info') { response.writeHead(404); response.end('{}'); }
  else if (request.url === '/global/health') response.end('{"healthy":true,"version":"1.18.33"}');
  else response.end('{"all":[{"id":"test","name":"Test","models":{"model":{"id":"model","name":"Model"}}}],"connected":["test"]}');
});
server.listen(0, '127.0.0.1', () => {
  console.log('opencode server listening on http://127.0.0.1:' + server.address().port);
  if (process.env.FIXTURE_GENERATED_PASSWORD) console.log('server password ' + password);
});
`
it('shares an authenticated local server across model loading and turns, then stops it', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  let endpoint = ''
  try {
    const [first, second, catalog] = await Promise.all([
      servers.resolve(agent),
      servers.resolve(agent),
      adapter.models!(agent),
    ])
    endpoint = first.endpoint
    expect(first.endpoint).toBe(second.endpoint)
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch.mock.calls[0][1]).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '0'])
    expect(catalog.models).toEqual([{ id: 'test/model', name: 'Test / Model', reasoning: [] }])
    expect((await adapter.probe(agent)).available).toBe(true)
    expect((await fetch(`${endpoint}/api/info`)).status).toBe(401)
    expect(first.env?.OPENCODE_SERVER_PASSWORD).toBeTruthy()
  } finally {
    await adapter.dispose?.()
  }
  await expect(fetch(endpoint)).rejects.toThrow(/fetch failed|ECONNREFUSED/)
  await expect(servers.resolve(agent)).rejects.toThrow('shutting down')
})
it('uses a generated server password and keeps launch configurations separate', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  try {
    const first = await servers.resolve({
      ...agent,
      env: {
        FIXTURE_GENERATED_PASSWORD: 'generated-password',
        OPENCODE_SERVER_USERNAME: 'configured-user',
      },
    })
    const second = await servers.resolve({
      ...agent,
      env: { OPENCODE_SERVER_PASSWORD: 'configured-password' },
    })
    expect(first.env.OPENCODE_SERVER_PASSWORD).toBe('generated-password')
    expect(first.endpoint).not.toBe(second.endpoint)
    expect(launch).toHaveBeenCalledTimes(2)
    const response = await fetch(`${first.endpoint}/api/info`, {
      headers: opencodeHeaders(first.env),
    })
    expect(response.status).toBe(404)
  } finally {
    await servers.dispose()
  }
})
it('leaves explicit HTTP URLs alone and reports unreachable URLs clearly', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn(process.execPath, ['-e', fixture], options),
  )
  const servers = new OpenCodeServers(launch)
  const adapter = createOpenCodeAdapter(servers)
  const unused = createServer()
  unused.listen(0, '127.0.0.1')
  await once(unused, 'listening')
  const address = unused.address()
  if (!address || typeof address === 'string') throw new Error('No test address')
  await new Promise<void>((resolve) => unused.close(() => resolve()))
  const explicit = { ...agent, endpoint: `http://127.0.0.1:${address.port}` }
  try {
    expect(await servers.resolve(explicit)).toMatchObject(explicit)
    await expect(adapter.models!(explicit)).rejects.toThrow('Cannot connect to OpenCode')
    expect(launch).not.toHaveBeenCalled()
    await expect(servers.resolve({ ...agent, endpoint: '/path/to/opencode' })).rejects.toThrow(
      'executable path separately',
    )
  } finally {
    await adapter.dispose?.()
  }
})
it('does not cache a failed launch', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) => spawn('/dovo-nonexistent-opencode', [], options),
  )
  const servers = new OpenCodeServers(launch)
  try {
    await expect(servers.resolve(agent)).rejects.toThrow('Install OpenCode')
    await expect(servers.resolve(agent)).rejects.toThrow('Install OpenCode')
    expect(launch).toHaveBeenCalledTimes(2)
  } finally {
    await servers.dispose()
  }
})
it('uses configured credentials rather than the process environment', () => {
  vi.stubEnv('OPENCODE_SERVER_PASSWORD', 'process-password')
  vi.stubEnv('OPENCODE_SERVER_USERNAME', 'process-user')
  try {
    expect(
      opencodeHeaders({
        OPENCODE_SERVER_PASSWORD: 'agent-password',
        OPENCODE_SERVER_USERNAME: 'agent-user',
      }),
    ).toEqual({
      Authorization: `Basic ${Buffer.from('agent-user:agent-password').toString('base64')}`,
    })
    expect(opencodeHeaders({ OPENCODE_SERVER_PASSWORD: '' })).toEqual({})
  } finally {
    vi.unstubAllEnvs()
  }
})

it('stops a server while initialization is still pending', async () => {
  const launch = vi.fn<(command: string, args: string[], options: SpawnOptions) => ChildProcess>(
    (_command, _args, options) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options),
  )
  const servers = new OpenCodeServers(launch)
  const ready = servers.resolve(agent)
  await Promise.all([expect(ready).rejects.toThrow(/aborted|OpenCode exited/), servers.dispose()])
  expect(
    launch.mock.results[0].value.exitCode !== null ||
      launch.mock.results[0].value.signalCode !== null,
  ).toBe(true)
})
