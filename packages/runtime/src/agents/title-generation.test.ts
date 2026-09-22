import { expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { openDatabase } from '../storage/database'
import { WorkspaceStore } from '../storage/workspace'
import { AgentRegistry } from './registry'
import { TitleGeneration } from './title-generation'
import type { AgentAdapter, AgentRun } from './types'
function setup() {
  const db = openDatabase(':memory:')
  const store = new WorkspaceStore(db)
  store.update((w) => ({
    ...w,
    agents: [
      {
        id: 'harness',
        name: 'Title harness',
        provider: 'codex',
        model: 'task-model',
        reasoning: 'high',
        instructions: 'Perform project work',
        permission: 'full-access',
        endpoint: 'fixture-codex',
      },
    ],
  }))
  const registry = new AgentRegistry()
  const titles = new TitleGeneration(db, store, registry)
  return { db, store, registry, titles }
}
it('persists independent title settings and generates using a temporary read-only session', async () => {
  const s = setup()
  let captured: AgentRun | undefined
  vi.spyOn(s.registry, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      captured = run
      run.onText('Improve ')
      run.onText('task creation')
    },
  })
  try {
    s.titles.save({ agentId: 'harness', model: 'title-model', reasoning: 'low' })
    expect(new TitleGeneration(s.db, s.store, s.registry).read()).toEqual({
      agentId: 'harness',
      model: 'title-model',
      reasoning: 'low',
    })
    expect(await s.titles.generate({ text: 'Improve task creation\nKeep all context' })).toEqual({
      title: 'Improve task creation',
    })
    expect(captured?.agent).toMatchObject({
      endpoint: 'fixture-codex',
      model: 'title-model',
      reasoning: 'low',
      permission: 'read-only',
    })
    expect(captured?.agent.instructions).not.toContain('Perform project work')
    expect(captured?.prompt).toContain(JSON.stringify('Improve task creation\nKeep all context'))
    expect(captured?.sessionId).toBeUndefined()
    expect(existsSync(captured?.cwd ?? '')).toBe(false)
    expect(await captured?.approve('Write', 'file')).toBe(false)
    expect(s.store.get().agents[0].model).toBe('task-model')
    expect(s.store.get().tasks).toEqual([])
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})
it.each(['', 'A title\nUnexpected second line', 'x'.repeat(121)])(
  'rejects invalid model output %j',
  async (output) => {
    const s = setup()
    vi.spyOn(s.registry, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => run.onText(output),
    })
    try {
      await expect(s.titles.generate({ text: 'Create a task' })).rejects.toThrow(/title model/)
    } finally {
      await s.titles.dispose()
      await s.registry.dispose()
      s.db.close()
    }
  },
)
it('generates titles with a direct harness when no saved agents exist', async () => {
  const s = setup()
  s.store.update((w) => ({ ...w, agents: [] }))
  const run = vi.fn<AgentAdapter['run']>(async (input) => {
    input.onText('Direct harness title')
  })
  vi.spyOn(s.registry, 'get').mockResolvedValue({ probe: vi.fn<AgentAdapter['probe']>(), run })
  try {
    s.titles.save({
      harness: { provider: 'claude', endpoint: 'custom-claude' },
      model: 'selected-model',
      reasoning: 'low',
    })
    expect(await s.titles.generate({ text: 'Make a title' })).toEqual({
      title: 'Direct harness title',
    })
    expect(run.mock.calls[0][0].agent).toMatchObject({
      provider: 'claude',
      endpoint: 'custom-claude',
      model: 'selected-model',
      reasoning: 'low',
    })
  } finally {
    await s.titles.dispose()
    await s.registry.dispose()
    s.db.close()
  }
})
