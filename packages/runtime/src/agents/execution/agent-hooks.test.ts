import { expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeHook, runWithHooks } from './agent-hooks.js'
import type { AgentRun } from './types.js'

it('runs a hook in its checkout and reports a failed command', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-hook-'))
  try {
    const hook = {
      name: 'check',
      enabled: true,
      event: 'after-turn' as const,
      command: 'node -e "process.stdout.write(process.cwd()); process.exit(2)"',
      timeoutSeconds: 10,
    }
    expect(await executeHook(hook, cwd, new AbortController().signal)).toMatchObject({
      ok: false,
      output: await realpath(cwd),
    })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

it('returns a failed after-turn check to the same provider session and stops after two repairs', async () => {
  const run = {
    cwd: process.cwd(),
    prompt: 'original',
    sessionId: undefined,
    signal: new AbortController().signal,
    agent: { permission: 'full' },
    onSession: vi.fn<(id: string) => void>(),
  } as unknown as AgentRun
  const adapter = {
    run: vi.fn<(input: AgentRun) => Promise<void>>(async (input) => {
      input.onSession('same-session')
    }),
  }
  const report = vi.fn<(result: import('./agent-hooks.js').HookResult) => void>()
  const repairStarted = vi.fn<() => void>()
  const hook = {
    name: 'check',
    enabled: true,
    event: 'after-turn' as const,
    command: 'node -e "process.exit(1)"',
    timeoutSeconds: 10,
  }
  await expect(runWithHooks(adapter, run, [hook], report, repairStarted)).rejects.toThrow(
    'after two repair attempts',
  )
  expect(adapter.run).toHaveBeenCalledTimes(3)
  expect(adapter.run.mock.calls[1]?.[0]).toMatchObject({
    sessionId: 'same-session',
    attachments: undefined,
  })
  expect(adapter.run.mock.calls[1]?.[0].prompt).toContain('Required project/agent checks failed')
  expect(repairStarted).toHaveBeenCalledTimes(2)
  expect(report).toHaveBeenCalledTimes(3)
})
