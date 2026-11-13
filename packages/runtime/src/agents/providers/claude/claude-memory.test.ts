import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun } from '../../execution/types.js'
import { stopOwnedChild } from '../../execution/stop-owned-child.js'
import * as warm from '../../execution/warm-processes.js'
const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (input: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => unknown
    >(),
  prewarm: vi.fn<(input: { options: Options }) => Promise<unknown>>(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('@anthropic-ai/claude-agent-sdk/core', () => ({ prewarm: mocks.prewarm }))
vi.mock('../../configuration/claude-command.js', () => ({
  claudeCommand: async () => '/fixture/claude',
}))
import { createClaudeAdapter } from './claude.js'
const children: ChildProcess[] = []
afterEach(async () => {
  await Promise.all(children.splice(0).map(stopOwnedChild))
  vi.restoreAllMocks()
})
function launch(options: Options) {
  const spawn = options.spawnClaudeCodeProcess
  if (!spawn) throw new Error('Expected owned custom spawn')
  spawn({
    command: process.execPath,
    args: ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"],
    cwd: process.cwd(),
    env: process.env,
    signal: new AbortController().signal,
  })
  // Ownership callbacks receive the actual handle. The test captures it with its own run.
}
function run(taskId: string, onOwnedProcess: NonNullable<AgentRun['onOwnedProcess']>): AgentRun {
  return {
    taskId,
    onOwnedProcess,
    cwd: process.cwd(),
    prompt: 'fixture',
    signal: new AbortController().signal,
    agent: {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      model: '',
      instructions: '',
      permission: 'full-access',
      endpoint: '',
    },
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    approve: async () => 'deny',
    ask: async () => null,
  }
}
function stream(prompt: string | AsyncIterable<SDKUserMessage>) {
  return {
    async *[Symbol.asyncIterator]() {
      if (typeof prompt === 'string') throw new Error('Expected streaming input')
      for await (const _message of prompt)
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'fixture-session' }
    },
    close: () => {},
    setMcpServers: async () => ({ errors: {} }),
  }
}
it.skipIf(process.platform === 'win32')(
  'binds a real dedicated Claude launcher to each warm run and drains it on disposal',
  async () => {
    vi.spyOn(warm, 'releaseIdleProvider').mockReturnValue(false)
    mocks.prewarm.mockRejectedValue(new Error('No spare in this fixture'))
    mocks.query.mockImplementation(({ prompt, options }) => {
      launch(options)
      return stream(prompt)
    })
    const adapter = createClaudeAdapter()
    const first = vi.fn<(child: ChildProcess) => void>((child) => {
      if (!children.includes(child)) children.push(child)
    })
    const second = vi.fn<(child: ChildProcess) => void>()
    try {
      const input = run('warm', first)
      await adapter.run(input)
      expect(children).toHaveLength(1)
      const child = children[0]!
      await once(child.stdout!, 'data')
      await adapter.run({ ...input, sessionId: 'fixture-session', onOwnedProcess: second })
      expect(second).toHaveBeenCalledWith(child)
      expect(mocks.query).toHaveBeenCalledOnce()
      await adapter.dispose?.()
      expect(() => process.kill(-child.pid!, 0)).toThrow(/ESRCH/)
    } finally {
      await adapter.dispose?.()
    }
  },
)
