import { decode } from '@dovo/protocol'
import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTaskAgent, snapshotSchema } from '@dovo/protocol'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import type { AgentAdapter } from './types'
it('keeps explicit Automatic and speed resets through the workspace API, restart, and task execution', async () => {
  const f = await fixture()
  const storage = await mkdtemp(join(tmpdir(), 'dovo-mode-overrides-'))
  const options = {
    databasePath: join(storage, 'runtime.sqlite'),
    ownerToken: 'test-owner-token-with-at-least-32-characters',
    port: 0,
  }
  let runtime = await startRuntime(options)
  try {
    f.workspace.agents[0].serviceTier = 'priority'
    f.workspace.agents[0].cyberAccessProgram = 'daybreakBlue'
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Test',
      agentId: 'agent',
      repositoryId: 'repo',
      objective: 'Fixture',
    })
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/workspace`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${options.ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection: 'tasks',
        id: task.id,
        changes: {
          agentOverrides: {
            before: null,
            after: {
              model: 'other-model',
              serviceTier: null,
              cyberAccessProgram: null,
            },
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    await runtime.close()
    runtime = await startRuntime(options)
    const snapshot = decode(
      snapshotSchema,
      await (
        await fetch(`http://127.0.0.1:${runtime.port}/api/snapshot`, {
          headers: {
            Authorization: `Bearer ${options.ownerToken}`,
          },
        })
      ).json(),
    )
    const saved = snapshot.workspace.tasks.find((entry) => entry.id === task.id)!
    expect(saved.agentOverrides).toEqual({
      model: 'other-model',
      serviceTier: null,
      cyberAccessProgram: null,
    })
    const resolved = resolveTaskAgent(saved, snapshot.workspace.agents)
    expect(resolved?.serviceTier).toBeUndefined()
    expect(resolved?.cyberAccessProgram).toBeUndefined()
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      expect(input.agent.serviceTier).toBeUndefined()
      expect(input.agent.cyberAccessProgram).toBeUndefined()
      input.onText('Verified')
    })
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      run,
      probe: vi.fn<AgentAdapter['probe']>(),
    })
    await (
      await runtime.services.tasks.start(task.id)
    ).done
    expect(run).toHaveBeenCalledOnce()
    expect(runtime.services.store.get().agents[0]).toMatchObject({
      serviceTier: 'priority',
      cyberAccessProgram: 'daybreakBlue',
    })
  } finally {
    await runtime.close()
    await f.cleanup()
    await rm(storage, {
      recursive: true,
      force: true,
    })
    vi.restoreAllMocks()
  }
})
