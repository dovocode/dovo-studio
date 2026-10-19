import { expect, it, vi } from 'vite-plus/test'
import { defaultTaskHarness, decode, taskSchema, type Agent, type Task } from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { RuntimeDefaults } from '../../storage/runtime-defaults'
import { RuntimePreferences } from '../../storage/runtime-preferences'
import { AgentRegistry } from '../configuration/registry'
import { TitleGeneration } from './title-generation'
import { ModelSelection } from './model-selection'
import type { AgentAdapter, AgentRun } from '../execution/types'

function setup(mode: Task['modelSelection'] = 'smart') {
  const db = openDatabase(':memory:')
  const store = new WorkspaceStore(db)
  const defaults = new RuntimeDefaults(db)
  defaults.save({
    ...defaults.get(),
    configured: true,
    harness: { ...defaultTaskHarness('codex'), model: 'system-model' },
  })
  const preferences = new RuntimePreferences(db)
  preferences.save({ ...preferences.get(), enableSmartModelSelection: true })
  store.update((w) => ({
    ...w,
    repositories: [
      {
        id: 'project',
        name: 'Project',
        path: '/project',
        branch: 'main',
        taskDefaults: { harness: { ...defaultTaskHarness('codex'), model: 'project-model' } },
      },
    ],
    tasks: [
      decode(taskSchema, {
        id: 'task',
        title: 'Draft',
        repositoryId: 'project',
        agentId: '',
        status: 'draft',
        createdAt: '',
        messages: [],
        files: [],
        draft: 'Implement a feature',
        example: false,
        modelSelection: mode,
      }),
    ],
  }))
  const registry = new AgentRegistry()
  const titles = new TitleGeneration(db, store, registry)
  titles.save({ harness: { provider: 'codex', endpoint: '' }, model: 'title-model' })
  const runs: AgentRun[] = []
  let output: string | undefined
  let selectedProvider: Agent['provider'] = 'claude'
  let reasoning: { id: string; name: string }[] = []
  const get = vi.spyOn(registry, 'get').mockImplementation(async (provider) => ({
    probe: vi.fn<AgentAdapter['probe']>().mockResolvedValue({
      available: provider === 'codex' || provider === 'claude',
      provider,
      detail: '',
    }),
    models: async () => ({
      models: [
        { id: `${provider}-small`, name: 'Small', description: 'Fast, simple tasks' },
        { id: `${provider}-large`, name: 'Large', description: 'Complex reasoning' },
      ],
      reasoning,
    }),
    run: async (run) => {
      runs.push(run)
      const input = JSON.parse(run.prompt)
      const candidate = input.candidates.find(
        (c: { provider: string; model: string }) =>
          c.provider === selectedProvider && c.model.endsWith('-large'),
      )
      run.onText(
        output ??
          JSON.stringify({
            id: candidate?.id,
            reasoning: reasoning[0]?.id ?? '',
            reason: 'Complex task',
          }),
      )
    },
  }))
  const selection = new ModelSelection(db, store, registry, titles)
  return {
    db,
    store,
    preferences,
    titles,
    registry,
    selection,
    runs,
    get,
    setReasoning: (value: { id: string; name: string }[]) => {
      reasoning = value
    },
    setOutput: (value: string) => {
      output = value
    },
    setProvider: (value: Agent['provider']) => {
      selectedProvider = value
    },
    close: async () => {
      await titles.dispose()
      await registry.dispose()
      db.close()
    },
  }
}

it.each(['project', 'missing'])(
  'Inherit uses exact project/system defaults without inference: %s',
  async (repositoryId) => {
    const s = setup('inherit')
    try {
      s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: false })
      s.store.updateTask('task', (task) => ({ ...task, repositoryId }))
      await runClientEffect(s.selection.resolveEffect('task'))
      expect(s.store.task('task').harness?.model).toBe(
        repositoryId === 'project' ? 'project-model' : 'system-model',
      )
      expect(s.store.task('task').modelSelection).toBeUndefined()
      expect(s.get).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  },
)

it.each(['inherit', 'auto', 'smart'] as const)(
  'preserves a thread permission restriction through %s selection',
  async (mode) => {
    const s = setup(mode)
    try {
      s.store.updateTask('task', (task) => ({
        ...task,
        harness: { ...defaultTaskHarness('codex'), permission: 'ask' },
        agentOverrides: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request' },
      }))
      s.setProvider('codex')
      await runClientEffect(s.selection.resolveEffect('task'))
      expect(s.store.task('task').harness).toMatchObject({
        permission: 'ask',
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
      })
      expect(s.store.task('task').agentOverrides).toBeUndefined()
    } finally {
      await s.close()
    }
  },
)

it('maps read-only permissions when Inherit selects a different provider', async () => {
  const s = setup('inherit')
  try {
    s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repository) => ({
        ...repository,
        taskDefaults: { harness: defaultTaskHarness('claude') },
      })),
    }))
    s.store.updateTask('task', (task) => ({
      ...task,
      harness: {
        ...defaultTaskHarness('codex'),
        permission: 'read-only',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      },
    }))
    await runClientEffect(s.selection.resolveEffect('task'))
    expect(s.store.task('task').harness).toMatchObject({
      provider: 'claude',
      permission: 'read-only',
    })
    expect(s.store.task('task').harness?.sandboxMode).toBeUndefined()
  } finally {
    await s.close()
  }
})

it.each(['auto', 'smart'] as const)(
  '%s resolves only once and limits candidate harnesses appropriately',
  async (mode) => {
    const s = setup(mode)
    s.setProvider(mode === 'auto' ? 'codex' : 'claude')
    try {
      await runClientEffect(s.selection.resolveEffect('task', 'Solve a difficult concurrency bug'))
      const task = s.store.task('task')
      expect(task.harness).toMatchObject({
        provider: mode === 'auto' ? 'codex' : 'claude',
        model: mode === 'auto' ? 'codex-large' : 'claude-large',
      })
      expect(s.runs[0].agent.model).toBe('title-model')
      expect(s.runs[0].tools).toBe('none')
      expect(s.runs[0].prompt).toContain('Solve a difficult concurrency bug')
      expect(s.runs[0].prompt).not.toContain('env')
      await runClientEffect(s.selection.resolveEffect('task', 'Another message'))
      expect(s.runs).toHaveLength(1)
    } finally {
      await s.close()
    }
  },
)

it('supports an independent selection model and title inheritance by default', async () => {
  const s = setup()
  try {
    expect(s.titles.read('auto-selection').inheritTitleModel).toBe(true)
    s.titles.save(
      { harness: { provider: 'codex', endpoint: '' }, model: 'selector-model' },
      'auto-selection',
    )
    await runClientEffect(s.selection.resolveEffect('task'))
    expect(s.runs[0].agent.model).toBe('selector-model')
    expect(s.titles.read().model).toBe('title-model')
  } finally {
    await s.close()
  }
})

it.each(['disabled', 'invalid', 'changed', 'disabled-during-selection'] as const)(
  'rejects %s selection without freezing a model',
  async (reason) => {
    const s = setup()
    try {
      if (reason === 'disabled')
        s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: false })
      if (reason === 'invalid') s.setOutput('{"id":"invented","reason":"guess"}')
      if (reason === 'changed' || reason === 'disabled-during-selection') {
        const classify = s.titles.selectModelEffect.bind(s.titles)
        vi.spyOn(s.titles, 'selectModelEffect').mockImplementation((text) => {
          if (reason === 'changed')
            s.store.updateTask('task', (task) => ({ ...task, draft: 'Changed' }))
          else s.preferences.save({ ...s.preferences.get(), enableSmartModelSelection: false })
          return classify(text)
        })
      }
      await expect(runClientEffect(s.selection.resolveEffect('task'))).rejects.toThrow(
        reason === 'invalid'
          ? 'unavailable model'
          : reason === 'changed'
            ? 'thread changed'
            : 'disabled',
      )
      expect(s.store.task('task').modelSelection).toBe('smart')
      expect(s.store.task('task').harness).toBeUndefined()
      expect(s.runs).toHaveLength(reason === 'disabled' ? 0 : 1)
    } finally {
      await s.close()
    }
  },
)

it.each(['auto', 'smart'] as const)(
  '%s uses difficulty to choose model and supported reasoning together',
  async (mode) => {
    const s = setup(mode)
    s.setProvider(mode === 'auto' ? 'codex' : 'claude')
    s.setReasoning([
      { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' },
    ])
    s.store.updateTask('task', (task) => ({ ...task, modelSelectionDifficulty: 'high' }))
    try {
      await runClientEffect(s.selection.resolveEffect('task'))
      const input = JSON.parse(s.runs[0].prompt)
      expect(input.difficulty).toBe('high')
      expect(input.candidates[0].reasoning).toContainEqual({ id: 'medium', name: 'Medium' })
      // Difficulty is a hint: the selected model can use a different supported reasoning level.
      expect(s.store.task('task').harness?.reasoning).toBe('medium')
      expect(s.store.task('task').modelSelectionDifficulty).toBeUndefined()
      await runClientEffect(s.selection.resolveEffect('task', 'Later message'))
      expect(s.runs).toHaveLength(1)
    } finally {
      await s.close()
    }
  },
)

it('defaults difficulty to auto independently of project reasoning', async () => {
  const s = setup()
  try {
    await runClientEffect(s.selection.resolveEffect('task'))
    expect(JSON.parse(s.runs[0].prompt).difficulty).toBe('auto')
  } finally {
    await s.close()
  }
})

it.each(['missing', 'unsupported'])(
  'rejects %s reasoning before changing the thread',
  async (kind) => {
    const s = setup()
    s.setReasoning([{ id: 'high', name: 'High' }])
    s.setOutput(
      JSON.stringify({
        id: '1',
        reason: 'Complex',
        ...(kind === 'unsupported' ? { reasoning: 'invented' } : {}),
      }),
    )
    const before = s.store.task('task')
    try {
      await expect(runClientEffect(s.selection.resolveEffect('task'))).rejects.toThrow(
        /reasoning level/,
      )
      expect(s.store.task('task')).toEqual(before)
    } finally {
      await s.close()
    }
  },
)
