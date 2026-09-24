import { decode } from '@dovo/protocol'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { commandsSchema } from '@dovo/protocol'
import { checkAdapterUpdates } from './diagnostics'
const run = vi.hoisted(() =>
  vi.fn<
    (
      command: string,
      args: string[],
      options: unknown,
    ) => Promise<{
      stdout: string
      stderr?: string
    }>
  >(),
)
vi.mock('../process.js', () => ({
  exec: run,
  processEnvironment: () => ({
    PATH: '/bin',
  }),
}))
const settings = decode(commandsSchema, {})
const request = vi.fn<typeof fetch>()
function urlString(input: Parameters<typeof fetch>[0]) {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}
beforeEach(() => {
  run.mockReset().mockResolvedValue({
    stdout: 'codex-cli 0.155.1\n',
    stderr: '',
  })
  request.mockReset()
  vi.stubGlobal('fetch', request)
})
afterEach(() => vi.unstubAllGlobals())
it('checks the installed adapters without contacting an update registry or running model turns', async () => {
  request.mockResolvedValue(
    Response.json({
      healthy: true,
      version: '1.18.31',
    }),
  )
  const diagnostics = await checkAdapterUpdates(settings)
  expect(run.mock.calls).toEqual(
    ['codex', 'claude'].map((command) => [
      command,
      ['--version'],
      expect.objectContaining({ timeout: 5000, env: { PATH: '/bin' } }),
    ]),
  )
  expect(request.mock.calls.map(([url]) => urlString(url))).toEqual([
    'http://127.0.0.1:4096/global/health',
  ])
  expect(diagnostics.find((item) => item.id === 'claude-sdk')).toMatchObject({
    available: true,
    kind: 'sdk',
    installedVersion: expect.stringMatching(/^0\.3\./),
  })
  expect(diagnostics.filter((item) => item.kind === 'sdk').every((item) => item.available)).toBe(
    true,
  )
  expect(diagnostics.every((item) => item.updateStatus === 'not-checked')).toBe(true)
})
it('compares stable, prerelease, and newer installed versions correctly', async () => {
  request.mockImplementation(async (url) => {
    if (urlString(url).includes('/global/health'))
      return Response.json({
        healthy: true,
        version: '2.0.0-beta.2',
      })
    const name = decodeURIComponent(new URL(urlString(url)).pathname.split('/')[1])
    return Response.json({
      name,
      version: name === '@openai/codex' ? '0.154.0' : name === 'opencode-ai' ? '2.0.0' : '999.0.0',
    })
  })
  const diagnostics = await checkAdapterUpdates(settings, {
    checkUpdates: true,
  })
  expect(diagnostics.find((item) => item.id === 'codex')).toMatchObject({
    installedVersion: '0.155.1',
    latestVersion: '0.154.0',
    updateStatus: 'ahead',
  })
  expect(diagnostics.find((item) => item.kind === 'server')).toMatchObject({
    installedVersion: '2.0.0-beta.2',
    latestVersion: '2.0.0',
    updateStatus: 'update-available',
  })
  expect(diagnostics.find((item) => item.id === 'claude-sdk')?.updateStatus).toBe(
    'update-available',
  )
})
it('retains useful results if an executable, server, or update registry is unavailable', async () => {
  run.mockRejectedValue(new Error('secret-token: child stderr must not be reported'))
  request.mockImplementation(async (url) => {
    if (urlString(url).includes('/global/health'))
      return new Response(null, {
        status: 401,
      })
    throw new Error('network offline')
  })
  const diagnostics = await checkAdapterUpdates(settings, {
    checkUpdates: true,
  })
  expect(diagnostics.find((item) => item.id === 'codex')).toMatchObject({
    available: false,
    installedVersion: null,
    updateStatus: 'unknown',
  })
  expect(diagnostics.find((item) => item.id === 'claude-sdk')).toMatchObject({
    available: true,
    installedVersion: expect.any(String),
    updateStatus: 'unknown',
  })
  expect(diagnostics.find((item) => item.kind === 'server')?.detail).toContain('HTTP 401')
  expect(JSON.stringify(diagnostics)).not.toContain('secret-token')
})
it('checks configured agent executables and deduplicates a shared installation', async () => {
  request.mockResolvedValue(
    Response.json({
      healthy: true,
      version: '1.18.31',
    }),
  )
  run.mockImplementation(async (command) => ({
    stdout: command === '/bin/custom-agent' ? 'custom build\n' : '2.1.278 (Claude Code)\n',
  }))
  const diagnostics = await checkAdapterUpdates(
    decode(commandsSchema, {
      claude: '/bin/claude',
    }),
    {
      agents: [
        {
          provider: 'claude',
          endpoint: '/bin/claude',
          model: '',
        },
        {
          provider: 'acp',
          endpoint: '/bin/custom-agent',
          model: '',
        },
        {
          provider: 'acp',
          endpoint: '/bin/custom-agent',
          model: '',
        },
      ],
    },
  )
  expect(run.mock.calls.map(([command]) => command)).toEqual([
    'codex',
    '/bin/claude',
    '/bin/custom-agent',
  ])
  expect(
    diagnostics.find((item) => item.provider === 'claude' && item.kind === 'executable'),
  ).toMatchObject({
    installedVersion: '2.1.278',
  })
  expect(
    diagnostics.find((item) => item.provider === 'acp' && item.kind === 'executable'),
  ).toMatchObject({
    available: true,
    installedVersion: null,
  })
})
it('checks the actual configured OpenCode host and reuses its configured server authentication', async () => {
  vi.stubEnv('OPENCODE_SERVER_PASSWORD', 'test-server-password')
  vi.stubEnv('OPENCODE_SERVER_USERNAME', 'tester')
  try {
    request.mockResolvedValue(
      Response.json({
        healthy: true,
        version: '1.18.31',
      }),
    )
    const diagnostics = await checkAdapterUpdates(settings, {
      agents: [
        {
          provider: 'opencode',
          endpoint: 'https://code.example.test/api',
          model: '',
        },
        {
          provider: 'opencode',
          endpoint: 'https://code.example.test/api',
          model: '',
        },
      ],
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(urlString(request.mock.calls[0][0])).toBe('https://code.example.test/api/global/health')
    expect(request.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Basic dGVzdGVyOnRlc3Qtc2VydmVyLXBhc3N3b3Jk',
    })
    expect(JSON.stringify(diagnostics)).not.toContain('test-server-password')
  } finally {
    vi.unstubAllEnvs()
  }
})
it('rejects mismatched registry packages without claiming an update is available', async () => {
  request.mockImplementation(async (url) =>
    urlString(url).includes('/global/health')
      ? Response.json({
          healthy: true,
          version: '1.18.31',
        })
      : Response.json({
          name: 'different-package',
          version: '999.0.0',
        }),
  )
  const diagnostics = await checkAdapterUpdates(settings, {
    checkUpdates: true,
  })
  expect(diagnostics.every((item) => item.updateStatus === 'unknown')).toBe(true)
  expect(diagnostics.every((item) => item.latestVersion === null)).toBe(true)
})
