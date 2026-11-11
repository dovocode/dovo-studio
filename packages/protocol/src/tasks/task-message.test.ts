import { expect, it } from 'vite-plus/test'
import { decode, decodeResult, ValidationError } from '../shared/schema.js'
import { defaultTaskHarness, taskSchema } from '../workspace.js'
import { taskMessageSchema, threadStartMessage } from './task-message.js'

it('validates the same submission before local admission and on the runtime', () => {
  const message = { id: 'task', messageId: 'message', text: '  Hello  ' }
  expect(decode(taskMessageSchema, message)).toMatchObject({ text: 'Hello', attachmentIds: [] })
  for (const input of [
    { ...message, text: ' ' },
    { ...message, messageId: '' },
    { ...message, text: 'x'.repeat(120001) },
    { ...message, initialTitle: { before: 'New', after: '' } },
    { ...message, attachmentIds: ['invalid-id'] },
  ])
    expect(() => decode(taskMessageSchema, input)).toThrow(ValidationError)
  expect(
    decode(taskMessageSchema, {
      ...message,
      text: '',
      attachmentIds: ['3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4'],
    }).attachmentIds,
  ).toHaveLength(1)
})

it('accepts only a matching unsent draft as the thread a message starts', () => {
  const createTask = {
    id: 'task',
    title: 'New thread',
    repositoryId: 'repo',
    agentId: '',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    files: [],
    draft: 'Hello',
    example: false,
  }
  const message = { id: 'task', messageId: 'message', text: 'Hello', createTask }
  expect(decode(taskMessageSchema, message).createTask).toMatchObject({ id: 'task' })
  for (const input of [
    { ...message, createTask: { ...createTask, id: 'other' } },
    { ...message, createTask: { ...createTask, status: 'running' } },
    {
      ...message,
      createTask: {
        ...createTask,
        messages: [{ id: 'old', role: 'user', text: 'Old', createdAt: createTask.createdAt }],
      },
    },
    { ...message, attachmentIds: ['3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4'] },
    { ...message, sendNow: true },
    { ...message, runId: 'run' },
  ])
    expect(() => decode(taskMessageSchema, input)).toThrow(ValidationError)
})

it('adds a new draft to its first message only when that message can start it', () => {
  const task = decode(taskMessageSchema, {
    id: 'task',
    messageId: 'message',
    text: 'Hello',
    createTask: {
      id: 'task',
      title: 'New thread',
      repositoryId: 'repo',
      agentId: '',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      messages: [],
      files: [],
      draft: 'Hello',
      example: false,
    },
  }).createTask!
  const message = { id: 'task', messageId: 'message', text: 'Hello', runId: undefined }
  // The message text replaces the draft; the caller's other fields are sent unchanged.
  expect(threadStartMessage(message, task)).toEqual({
    ...message,
    createTask: { ...task, draft: '' },
  })
  expect(threadStartMessage(message, task)?.createTask).not.toBe(task)
  for (const input of [
    null,
    'task',
    { ...message, id: 'other' },
    { ...message, attachmentIds: ['3e222e4e-63dc-40d0-b0cb-6d1bc3b9ead4'] },
    { ...message, sendNow: true },
    { ...message, runId: 'run' },
    { id: 'task', text: 'Hello' },
  ])
    expect(threadStartMessage(input, task)).toBeUndefined()
  expect(threadStartMessage(message, { ...task, status: 'running' })).toBeUndefined()
})

it('keeps runtime-owned state out of a thread start', () => {
  const createdAt = '2026-01-01T00:00:00.000Z'
  // A configured startup draft, as desktop, mobile and machine moves build it.
  const configured = decode(taskSchema, {
    id: 'task',
    title: 'New thread',
    repositoryId: 'repo',
    agentId: '',
    status: 'draft',
    createdAt,
    messages: [],
    files: [],
    draft: '',
    example: false,
    origin: 'machine-draft:old',
    pinned: true,
    harness: defaultTaskHarness('codex'),
    harnessCustomized: true,
    modelSelection: 'smart',
    autoProject: true,
    execution: 'worktree',
    worktreeBaseBranch: 'main',
    worktreeFromOrigin: true,
    setupCommand: 'pnpm install',
    draftPlan: true,
  })
  const message = { id: 'task', messageId: 'message', text: 'Hello' }
  expect(decode(taskMessageSchema, { ...message, createTask: configured }).createTask).toEqual(
    configured,
  )
  const injected: Record<string, unknown> = {
    queue: [{ id: 'queued', role: 'user', text: 'Injected', createdAt }],
    queuePaused: true,
    restartRecovery: { kind: 'turn', automatic: true },
    sessionId: 'provider-session',
    sessionAgentId: 'provider-agent',
    importedCodexSession: { sessionId: 'native', cwd: '/elsewhere' },
    providerLock: 'codex',
    checkoutLocked: true,
    activeRunId: 'run',
    runPhase: 'running',
    lastPromptAt: createdAt,
    error: 'Injected failure',
    replica: { ownerRuntimeId: 'other', threadId: 'thread', ownerName: 'Other', projectName: 'P' },
    turns: [],
    consumedMessageIds: ['message'],
    pendingLinkedCheckouts: [],
    files: [{ path: 'src/index.ts', status: 'modified' }],
    example: true,
  }
  for (const [key, value] of Object.entries(injected)) {
    const task = decodeResult(taskSchema, { ...configured, [key]: value })
    // Only schema-valid tasks reach the thread-start rule, so this checks the rule itself.
    if (!task.success) continue
    expect(() => decode(taskMessageSchema, { ...message, createTask: task.data })).toThrow(
      ValidationError,
    )
    expect(threadStartMessage(message, task.data)).toBeUndefined()
  }
  expect(
    Object.keys(injected).filter(
      (key) => decodeResult(taskSchema, { ...configured, [key]: injected[key] }).success,
    ).length,
  ).toBeGreaterThanOrEqual(12)
})
