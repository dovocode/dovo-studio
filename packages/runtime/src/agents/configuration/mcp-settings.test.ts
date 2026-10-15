import { expect, it, vi } from 'vite-plus/test'
import { decode, mcpServerSchema } from '@dovo/protocol'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { spawn } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { claudeMcpConfigFile } from './mcp-settings.js'

it('keeps every resolved MCP environment and header secret out of actual SDK launch arguments', async () => {
  vi.stubEnv('DOVO_TEST_MCP_KEY', 'synthetic-mapped-secret')
  const config = claudeMcpConfigFile([
    decode(mcpServerSchema, {
      name: 'stdio',
      enabled: true,
      transport: 'stdio',
      command: 'test-server',
      envValues: { INLINE: 'synthetic-inline-secret' },
      env: { MAPPED: 'DOVO_TEST_MCP_KEY' },
    }),
    decode(mcpServerSchema, {
      name: 'http',
      enabled: true,
      transport: 'http',
      url: 'http://localhost/mcp',
      headerValues: { 'X-Inline': 'synthetic-header-secret' },
      headerEnv: { 'X-Mapped': 'DOVO_TEST_MCP_KEY' },
      bearerTokenEnv: 'DOVO_TEST_MCP_KEY',
    }),
  ])
  if (!config.path) throw new Error('Expected a private MCP config')
  let argv: string[] = []
  const stream = query({
    prompt: 'test',
    options: {
      pathToClaudeCodeExecutable: process.execPath,
      extraArgs: { 'mcp-config': config.path },
      env: {},
      settingSources: [],
      // Intercept only this test launch. No live process arguments/environment are inspected.
      spawnClaudeCodeProcess: (options) => {
        argv = options.args
        return spawn(process.execPath, ['-e', 'process.exit(0)'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {},
        })
      },
    },
  })
  try {
    expect(statSync(config.path).mode & 0o777).toBe(0o600)
    expect(statSync(dirname(config.path)).mode & 0o777).toBe(0o700)
    const content = readFileSync(config.path, 'utf8')
    expect(content).toContain('synthetic-inline-secret')
    expect(content).toContain('synthetic-mapped-secret')
    expect(content).toContain('synthetic-header-secret')
    await stream.next()
    expect(argv).toContain('--mcp-config')
    expect(argv).toContain(config.path)
    expect(argv.join(' ')).not.toContain('synthetic-')
    expect(argv.join(' ')).not.toContain('mcpServers')
  } finally {
    stream.close()
    config.dispose()
    vi.unstubAllEnvs()
  }
  expect(existsSync(config.path)).toBe(false)
})
