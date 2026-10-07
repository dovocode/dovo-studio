import { expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import * as cua from '../../computer-use/cua.js'
import type { AgentAdapter } from './types.js'

it('injects machine Cua into writable turns without persisting it as an agent resource', async () => {
  const f = await fixture()
  const runtime = await startRuntime({
    databasePath: ':memory:',
    port: 0,
    ownerToken: 'test-owner-token-with-at-least-32-characters',
  })
  try {
    const skill = vi
      .spyOn(cua, 'cuaSkillInstructions')
      .mockResolvedValue(
        'Official Cua Driver skill: read /fixture/cua-driver/SKILL.md before computer use.',
      )
    runtime.services.store.update(() => f.workspace)
    const run = vi.fn<AgentAdapter['run']>(async (input) => {
      input.onText('Checked')
    })
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      run,
      probe: vi.fn<AgentAdapter['probe']>(),
    })
    for (const [enabled, permission, exposed] of [
      [false, 'ask', false],
      [true, 'ask', true],
      [true, 'read-only', false],
      [false, 'ask', false],
    ] as const) {
      runtime.services.commands.save({
        ...runtime.services.commands.get(),
        cua: process.execPath,
        cuaEnabled: enabled,
      })
      runtime.services.store.update((workspace) => ({
        ...workspace,
        agents: workspace.agents.map((agent) => ({ ...agent, permission })),
      }))
      const task = runtime.services.tasks.create({
        title: 'Cua integration',
        agentId: 'agent',
        repositoryId: 'repo',
        objective: 'Check tools',
      })
      await (
        await runtime.services.tasks.start(task.id)
      ).done
      const input = run.mock.lastCall?.[0]
      expect(input).toBeDefined()
      const server = input?.agent.resources?.mcpServers.find((entry) => entry.name === 'dovo_cua')
      expect(server && { command: server.command, args: server.args }).toEqual(
        exposed ? { command: process.execPath, args: ['mcp'] } : undefined,
      )
      expect(input?.agent.instructions.includes('opted in to desktop computer use')).toBe(exposed)
      expect(input?.agent.instructions.includes('/fixture/cua-driver/SKILL.md')).toBe(exposed)
      expect(
        runtime.services.store
          .get()
          .agents[0].resources?.mcpServers.some((entry) => entry.name === 'dovo_cua'),
      ).toBeFalsy()
    }
    expect(run).toHaveBeenCalledTimes(4)
    expect(skill).toHaveBeenCalledExactlyOnceWith(process.execPath)
  } finally {
    vi.restoreAllMocks()
    await runtime.close()
    await f.cleanup()
  }
})
