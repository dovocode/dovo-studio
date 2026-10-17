import { expect, it } from 'vite-plus/test'
import { nativeTodos, nativeTodoSummary } from './native-todos.js'

it('maps Muse todo statuses and drops cancelled or blank entries', () => {
  expect(
    nativeTodos('session/todoListChanged', {
      items: [
        { text: '  Step one ', status: 'completed' },
        { text: 'Step two', status: 'inProgress' },
        { text: 'Step three', status: 'pending' },
        { text: 'Dropped', status: 'cancelled' },
        { text: '   ', status: 'pending' },
        { text: 'Mystery', status: 'unknown' },
      ],
    }),
  ).toEqual([
    { text: 'Step one', status: 'completed' },
    { text: 'Step two', status: 'in-progress' },
    { text: 'Step three', status: 'pending' },
  ])
})

it('clears on an empty list and ignores other events and malformed payloads', () => {
  expect(nativeTodos('session/todoListChanged', { items: [] })).toEqual([])
  expect(nativeTodos('session/tokenUsage', { items: [] })).toBeUndefined()
  expect(nativeTodos('session/todoListChanged', {})).toBeUndefined()
  expect(nativeTodos('session/todoListChanged', null)).toBeUndefined()
})

it('summarizes progress and the active step', () => {
  expect(
    nativeTodoSummary({
      nativeTodos: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in-progress' },
        { text: 'Three', status: 'pending' },
      ],
    }),
  ).toEqual({ total: 3, completed: 1, active: 'Two' })
  expect(nativeTodoSummary({ nativeTodos: [] })).toBeUndefined()
  expect(nativeTodoSummary({})).toBeUndefined()
})

it('maps Codex plan updates and ignores another thread or unrelated tool events', () => {
  const payload = {
    threadId: 'root',
    plan: [
      { step: 'Inspect', status: 'completed' },
      { step: 'Build', status: 'inProgress' },
      { step: 'Verify', status: 'pending' },
    ],
  }
  expect(nativeTodos('turn/plan/updated', payload, 'codex', [], 'root')).toEqual([
    { text: 'Inspect', status: 'completed' },
    { text: 'Build', status: 'in-progress' },
    { text: 'Verify', status: 'pending' },
  ])
  expect(nativeTodos('turn/plan/updated', payload, 'codex', [], 'child')).toBeUndefined()
  expect(
    nativeTodos('turn/plan/updated', { threadId: 'root', plan: [] }, 'codex', [], 'root'),
  ).toEqual([])
  expect(
    nativeTodos('turn/plan/updated', { threadId: 'root' }, 'codex', [], 'root'),
  ).toBeUndefined()
  expect(nativeTodos('turn/plan/updated', payload, 'claude')).toBeUndefined()
})

const claude = (
  tool_name: string,
  tool_input: unknown,
  tool_response: unknown,
  current: Parameters<typeof nativeTodos>[3] = [],
) => nativeTodos('claude/checklist', { tool_name, tool_input, tool_response }, 'claude', current)

it('maps OpenCode todo snapshots only for the current session, including clearing and cancellation', () => {
  const properties = {
    sessionID: 'root',
    todos: [
      { content: ' Inspect ', status: 'completed' },
      { content: 'Build', status: 'in_progress' },
      { content: 'Verify', status: 'pending' },
      { content: 'Removed', status: 'cancelled' },
    ],
  }
  const read = (value: unknown, sessionId?: string) =>
    nativeTodos('todo.updated', value, 'opencode', [], sessionId)
  expect(read({ properties }, 'root')).toEqual([
    { text: 'Inspect', status: 'completed' },
    { text: 'Build', status: 'in-progress' },
    { text: 'Verify', status: 'pending' },
  ])
  expect(read({ properties }, 'child')).toBeUndefined()
  expect(read({ properties })).toBeUndefined()
  expect(read({ properties: { sessionID: 'root', todos: [] } }, 'root')).toEqual([])
  expect(read({ properties: { sessionID: 'root' } }, 'root')).toBeUndefined()
})

it.each(['acp', 'grok'] as const)(
  'maps %s plan snapshots without importing another session',
  (provider) => {
    const payload = {
      sessionId: 'root',
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Inspect', status: 'completed', priority: 'high' },
          { content: 'Build', status: 'in_progress', priority: 'medium' },
        ],
      },
    }
    const read = (value: unknown, sessionId = 'root') =>
      nativeTodos('plan', value, provider, [], sessionId)
    expect(read(payload)).toEqual([
      { text: 'Inspect', status: 'completed' },
      { text: 'Build', status: 'in-progress' },
    ])
    expect(read(payload, 'child')).toBeUndefined()
    expect(read({ sessionId: 'root', update: { sessionUpdate: 'plan', entries: [] } })).toEqual([])
    expect(
      read({ sessionId: 'root', update: { sessionUpdate: 'tool_call', entries: [] } }),
    ).toBeUndefined()
    expect(read({ sessionId: 'root', update: { sessionUpdate: 'plan' } })).toBeUndefined()
  },
)

it('imports only successful Mistral Vibe todo results, retaining native identities', () => {
  const entry = {
    sessionId: 'root',
    type: 'effect',
    detail: { kind: 'todo', input: { todos: [] } },
    state: {
      status: 'completed',
      output: {
        todos: [
          { id: '1', content: 'Inspect', status: 'completed' },
          { id: '2', content: 'Build', status: 'in_progress' },
          { id: '3', content: 'Removed', status: 'cancelled' },
        ],
      },
    },
  }
  const read = (entry: unknown) => nativeTodos('vibe/effect', { entry }, 'vibe', [], 'root')
  expect(read(entry)).toEqual([
    { id: 'vibe:1', text: 'Inspect', status: 'completed' },
    { id: 'vibe:2', text: 'Build', status: 'in-progress' },
  ])
  expect(read({ ...entry, sessionId: 'child' })).toBeUndefined()
  for (const status of ['running', 'failed', 'cancelled'])
    expect(read({ ...entry, state: { ...entry.state, status } })).toBeUndefined()
  expect(read({ ...entry, state: { status: 'completed', output: { todos: [] } } })).toEqual([])
  expect(read({ ...entry, state: { status: 'completed' } })).toBeUndefined()
})

it('maps successful Claude TodoWrite snapshots without interpreting pending requests or child progress', () => {
  const response = {
    newTodos: [
      { content: 'Inspect', status: 'completed' },
      { content: 'Build', status: 'in_progress' },
    ],
  }
  expect(claude('TodoWrite', {}, response)).toEqual([
    { text: 'Inspect', status: 'completed' },
    { text: 'Build', status: 'in-progress' },
  ])
  expect(claude('TodoWrite', { todos: response.newTodos }, {})).toBeUndefined()
  expect(
    nativeTodos('assistant', { tool_name: 'TodoWrite', tool_response: response }, 'claude'),
  ).toBeUndefined()
  expect(
    nativeTodos(
      'claude/checklist',
      { tool_name: 'TodoWrite', tool_response: response, agent_id: 'child' },
      'claude',
    ),
  ).toBeUndefined()
  expect(claude('TodoWrite', {}, { newTodos: [] })).toEqual([])
})

it('tracks Claude task creation, updates and deletion by identity, including duplicate events', () => {
  const created = claude('TaskCreate', {}, { task: { id: '1', subject: 'Inspect' } })
  expect(created).toEqual([{ id: 'claude:1', text: 'Inspect', status: 'pending' }])
  expect(claude('TaskCreate', {}, { task: { id: '1', subject: 'Inspect' } }, created)).toEqual(
    created,
  )
  const updated = claude(
    'TaskUpdate',
    { taskId: '1', subject: 'Read the code', status: 'in_progress' },
    { success: true, taskId: '1', updatedFields: ['subject', 'status'] },
    created,
  )
  expect(updated).toEqual([{ id: 'claude:1', text: 'Read the code', status: 'in-progress' }])
  expect(
    claude('TaskUpdate', { status: 'completed' }, { success: false, taskId: '1' }, updated),
  ).toBeUndefined()
  expect(
    claude(
      'TaskUpdate',
      { status: 'completed' },
      { success: true, taskId: '1', updatedFields: [] },
      updated,
    ),
  ).toEqual(updated)
  expect(
    claude(
      'TaskUpdate',
      { status: 'deleted' },
      { success: true, taskId: '1', updatedFields: ['status'] },
      updated,
    ),
  ).toEqual([])
  expect(
    claude(
      'TaskUpdate',
      { status: 'completed' },
      { success: true, taskId: 'unknown', updatedFields: ['status'] },
      updated,
    ),
  ).toBeUndefined()
})

it('reconciles resumed Claude task lists and individual reads into one checklist', () => {
  const tasks = [
    { id: '1', subject: 'Inspect', status: 'completed' },
    { id: '2', subject: 'Verify', status: 'pending' },
  ]
  const current = claude('TaskList', {}, { tasks })
  expect(current).toEqual([
    { id: 'claude:1', text: 'Inspect', status: 'completed' },
    { id: 'claude:2', text: 'Verify', status: 'pending' },
  ])
  expect(
    claude('TaskGet', {}, { task: { ...tasks[1], status: 'in_progress' } }, current)?.at(-1),
  ).toEqual({ id: 'claude:2', text: 'Verify', status: 'in-progress' })
  expect(claude('TaskGet', {}, { task: null }, current)).toBeUndefined()
  expect(claude('TaskList', {}, { tasks: [] }, current)).toEqual([])
})
