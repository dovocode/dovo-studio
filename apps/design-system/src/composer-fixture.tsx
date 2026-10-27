import { TooltipProvider } from '../../../packages/studio-ui/src/components/ui/tooltip'
import { Effect, Schema } from 'effect'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  decode,
  defaultTaskHarness,
  messageSchema,
  queuedMessageSchema,
  runtimeProfile,
  runtimeRegistrySchema,
  snapshotSchema,
  taskSchema,
  workspaceSchema,
  type Task,
  type Workspace,
} from '../../../packages/protocol/src'
import {
  StudioHostProvider,
  WorkspaceValueProvider,
  type StudioHostApi,
  type WorkspaceContextValue,
} from '@dovo/studio-core'
import { ApplicationStateProvider } from '@dovo/studio-core/state'

const taskId = 'preview-task'
const repositoryId = 'preview-project'
const profile = runtimeProfile(
  { address: 'http://preview.local:51464', token: 'storybook-preview-token-123456' },
  'Preview computer',
)
const agent = {
  id: 'preview-codex',
  name: 'Codex',
  provider: 'codex',
  model: 'gpt-6.1-sol',
  reasoning: 'high',
  instructions: '',
  permission: 'workspace-write',
  endpoint: '',
}
const claudeAgent = {
  ...agent,
  id: 'preview-claude',
  name: 'Claude',
  provider: 'claude',
  model: 'claude-sonnet-4-5',
}
const attachment = {
  id: 'f8e2ad6f-951c-46c7-a3ac-8dcb4e778ac4',
  name: 'preview.png',
  mime: 'image/png',
  size: 68,
}
const initialTask = decode(taskSchema, {
  id: taskId,
  title: 'Improve the project landing page',
  repositoryId,
  agentId: agent.id,
  status: 'running',
  activeRunId: 'preview-run',
  createdAt: '2026-10-21T10:00:00.000Z',
  messages: [
    {
      id: 'preview-user-message',
      role: 'user',
      text: 'Make the landing page feel calmer and clearer.',
      createdAt: '2026-10-21T10:00:00.000Z',
    },
    {
      id: 'preview-assistant-message',
      role: 'assistant',
      text: 'I have adjusted the page hierarchy. I am checking the mobile layout now.',
      createdAt: '2026-10-21T10:01:00.000Z',
    },
  ],
  files: [],
  draft: '',
  example: false,
  queue: [
    {
      id: 'preview-queued-message-1',
      role: 'user',
      text: 'Keep the existing blue accent, but soften the background.',
      createdAt: '2026-10-21T10:02:00.000Z',
    },
    {
      id: 'preview-queued-message-2',
      role: 'user',
      text: 'Please include a mobile screenshot when you finish.',
      createdAt: '2026-10-21T10:03:00.000Z',
      attachments: [attachment],
    },
  ],
  draftAttachments: [attachment],
})
const initialWorkspace = decode(workspaceSchema, {
  version: 1,
  runtimeAddress: '',
  agents: [agent, claudeAgent],
  repositories: [
    {
      id: repositoryId,
      name: 'Dovo Studio',
      path: '/workspace/dovo-studio',
      branch: 'main',
      gitIdentity: 'github.com/dovo/studio',
    },
  ],
  tasks: [initialTask],
  automations: [],
})
const initialSnapshot = decode(snapshotSchema, {
  runtimeHost: 'Preview computer',
  revision: 1,
  owner: true,
  queuedTurnSettingsSupported: true,
  fullTurnSettingsSupported: true,
  permissionPolicySupported: true,
  defaults: {
    harness: { ...defaultTaskHarness('codex'), model: 'gpt-6.1-sol', reasoning: 'high' },
  },
  workspace: initialWorkspace,
  approvals: [],
  questions: [],
  terminals: [],
  runs: [],
  devices: [],
  pendingDevices: [],
})

export type ComposerFixtureRequest = {
  path: string
  input: unknown
  outcome: 'ok' | 'preview unsupported' | 'unhandled'
}
type FixtureState = {
  task: Task
  requests: ComposerFixtureRequest[]
  setTask: (update: (current: Task) => Task) => void
  setFailNextRequest: (fail: boolean) => void
  setConnected: (connected: boolean) => void
}
const FixtureContext = createContext<FixtureState | null>(null)

export function useComposerFixture() {
  const fixture = useContext(FixtureContext)
  if (!fixture) throw new Error('ComposerFixtureProvider is required')
  return fixture
}

function recordRequest(path: string, input: unknown, outcome: ComposerFixtureRequest['outcome']) {
  return { path, input, outcome }
}

export function ComposerFixtureProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace)
  const [revision, setRevision] = useState(initialSnapshot.revision)
  const [requests, setRequests] = useState<ComposerFixtureRequest[]>([])
  const [failNextRequest, setFailNextRequest] = useState(false)
  const [connected, setConnected] = useState(true)
  const task = workspace.tasks.find((item) => item.id === taskId) ?? initialTask
  const setWorkspaceAndRevision: WorkspaceContextValue['setWorkspace'] = useCallback((update) => {
    setWorkspace(update)
    setRevision((current) => current + 1)
  }, [])
  const setTask = useCallback(
    (update: (current: Task) => Task) =>
      setWorkspaceAndRevision((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === taskId ? update(item) : item)),
      })),
    [setWorkspaceAndRevision],
  )
  const request = useCallback<WorkspaceContextValue['request']>(
    async (path, input, schema) => {
      const payload = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(input)
      if (path === '/api/tasks/queue') {
        const action = payload.action
        if (
          ![
            'pause',
            'resume',
            'pause-message',
            'resume-message',
            'edit',
            'move',
            'up',
            'down',
            'restore',
            'steer',
          ].includes(String(action))
        )
          throw new Error(`Queue action ${String(action)} is not supported in this preview.`)
        const editedText = payload.text
        if (action === 'edit' && typeof editedText !== 'string')
          throw new Error('Editing a queued message requires replacement text.')
        const replacementText = typeof editedText === 'string' ? editedText : undefined
        const attachmentIds =
          payload.attachmentIds === undefined
            ? undefined
            : Schema.decodeUnknownSync(Schema.Array(Schema.String))(payload.attachmentIds)
        if (action === 'steer') {
          setRequests((current) => [...current, recordRequest(path, input, 'preview unsupported')])
          throw new Error('Steering queued messages is not available in this local preview.')
        }
        setTask((current) => {
          const queue = [...(current.queue ?? [])]
          const messageId = typeof payload.messageId === 'string' ? payload.messageId : ''
          const index = queue.findIndex((message) => message.id === messageId)
          if (action === 'pause' || action === 'resume')
            return { ...current, queuePaused: action === 'pause' }
          if (index < 0) return current
          if (action === 'pause-message' || action === 'resume-message') {
            queue[index] = { ...queue[index], paused: action === 'pause-message' || undefined }
            return {
              ...current,
              queuePaused: action === 'resume-message' ? false : current.queuePaused,
              queue,
            }
          }
          if (action === 'move') {
            const [message] = queue.splice(index, 1)
            const beforeMessageId = payload.beforeMessageId
            const destination =
              typeof beforeMessageId === 'string'
                ? queue.findIndex((item) => item.id === beforeMessageId)
                : queue.length
            queue.splice(destination < 0 ? queue.length : destination, 0, message)
          } else if (action === 'up') {
            if (index > 0) [queue[index - 1], queue[index]] = [queue[index], queue[index - 1]]
          } else if (action === 'down') {
            if (index < queue.length - 1)
              [queue[index + 1], queue[index]] = [queue[index], queue[index + 1]]
          } else if (action === 'edit')
            queue[index] = decode(queuedMessageSchema, {
              ...queue[index],
              text: replacementText ?? queue[index].text,
              turnSettings: payload.turnSettings ?? undefined,
              attachments: attachmentIds
                ? queue[index].attachments?.filter((file) => attachmentIds.includes(file.id))
                : queue[index].attachments,
            })
          else if (action === 'restore')
            return {
              ...current,
              queue: queue.filter((message) => message.id !== messageId),
              draft: queue[index]?.text ?? current.draft,
            }
          else throw new Error(`Queue action ${String(action)} is not supported in this preview.`)
          return { ...current, queue }
        })
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({ ok: true })
      }
      if (path === '/api/attachments/read') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({
          attachment,
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4l8AAAAASUVORK5CYII=',
        })
      }
      if (path === '/api/tasks/files') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({
          files: ['src/App.tsx', 'src/components/Hero.tsx', 'README.md', 'package.json'],
        })
      }
      if (path === '/api/tasks/title') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({ title: 'A clearer project landing page' })
      }
      if (path === '/api/agents/availability') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)([
          { id: 'harness:codex', available: true },
          { id: 'harness:claude', available: true },
          { id: 'agent:preview-codex', available: true },
          { id: 'agent:preview-claude', available: true },
        ])
      }
      if (path === '/api/scm/branches') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({
          current: 'main',
          revision: 'preview-revision',
          originDefault: 'main',
          branches: [
            { name: 'main', ref: 'main', remote: false, checkedOut: true },
            {
              name: 'feature/design-preview',
              ref: 'feature/design-preview',
              remote: false,
              checkedOut: false,
            },
          ],
        })
      }
      if (path === '/api/agents/models/cached') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)(null)
      }
      if (path === '/api/agents/models') {
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({
          models: [
            {
              id: 'gpt-6.1-sol',
              name: 'GPT-6.1-Sol',
              isDefault: true,
              defaultReasoning: 'high',
              reasoning: [
                { id: 'medium', name: 'Medium' },
                { id: 'high', name: 'High' },
                { id: 'xhigh', name: 'Extra High' },
              ],
            },
            {
              id: 'gpt-6-sol',
              name: 'GPT-6-Sol',
              reasoning: [{ id: 'high', name: 'High' }],
            },
          ],
          reasoning: [],
          codex: { fastModeBlocked: false, daybreakPrograms: [] },
        })
      }
      if (path === '/api/attachments/remove') {
        setTask((current) => ({
          ...current,
          draftAttachments: current.draftAttachments?.filter((file) => file.id !== payload.id),
        }))
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({
          ok: true,
          revision: initialSnapshot.revision + 1,
        })
      }
      if (path === '/api/attachments/upload' || path === '/api/attachments/replace') {
        setRequests((current) => [...current, recordRequest(path, input, 'preview unsupported')])
        throw new Error(
          'Uploading and editing files is unavailable in this local preview. Use the included synthetic attachment to preview or remove it.',
        )
      }
      if (
        path === '/api/tasks/message' ||
        path === '/api/tasks/steer' ||
        path === '/api/tasks/cancel' ||
        path === '/api/tasks/compact'
      ) {
        if (failNextRequest) {
          setFailNextRequest(false)
          setRequests((current) => [...current, recordRequest(path, input, 'preview unsupported')])
          throw new Error('This action was set to fail for the composer preview.')
        }
        if (path === '/api/tasks/cancel')
          setTask((current) => ({ ...current, status: 'cancelled', activeRunId: undefined }))
        if (path === '/api/tasks/message' || path === '/api/tasks/steer') {
          const messageInput = {
            id: payload.messageId,
            role: 'user',
            text: payload.text,
            createdAt: new Date().toISOString(),
            attachments: [],
          }
          setTask((current) => {
            const selected =
              current.draftAttachments?.filter(
                (file) =>
                  Array.isArray(payload.attachmentIds) && payload.attachmentIds.includes(file.id),
              ) ?? []
            const submitted = { ...messageInput, attachments: selected }
            return current.status === 'running'
              ? {
                  ...current,
                  queue: [...(current.queue ?? []), decode(queuedMessageSchema, submitted)],
                }
              : {
                  ...current,
                  messages: [...current.messages, decode(messageSchema, submitted)],
                }
          })
        }
        setRequests((current) => [...current, recordRequest(path, input, 'ok')])
        return Schema.decodeUnknownSync(schema)({ ok: true })
      }
      setRequests((current) => [...current, recordRequest(path, input, 'unhandled')])
      throw new Error(`No local preview response is configured for ${path}.`)
    },
    [failNextRequest, setTask],
  )
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      previewTask: async (_connection, _taskId, _changes, action) => action(),
      workspace,
      setWorkspace: setWorkspaceAndRevision,
      ready: true,
      storageError: null,
      connection: profile.connection,
      snapshot: { ...initialSnapshot, revision, workspace },
      connected,
      syncError: null,
      connect: async () => undefined,
      cancelPairing: async () => undefined,
      disconnect: async () => undefined,
      request,
      requestEffect: (path, input, schema) => Effect.tryPromise(() => request(path, input, schema)),
      flush: async () => undefined,
      runtimeRegistry: decode(runtimeRegistrySchema, {
        version: 1,
        activeId: profile.id,
        profiles: [profile],
        pendingPairings: [],
      }),
      activeRuntimeId: profile.id,
      localRuntimeId: profile.id,
      runtimes: [],
      switchRuntime: async () => undefined,
      forgetRuntime: async () => undefined,
      refreshRuntimes: async () => undefined,
      refreshRuntime: async () => undefined,
      retrySync: async () => undefined,
      discardAndReload: async () => undefined,
      syncConflicts: [],
      resolveSyncConflict: async () => undefined,
      pendingMessages: () => [],
      mutationStatus: () => ({ pending: 0, error: null }),
      discardMutations: async () => undefined,
      pendingSync: false,
      readCache: null,
      readRuntime: async (_profile, path, input, schema) => request(path, input, schema),
      readRuntimeEffect: (_profile, path, input, schema) =>
        Effect.tryPromise(() => request(path, input, schema)),
      runtimeReadCache: () => {
        throw new Error('Runtime cache reads are not available in this local preview.')
      },
    }),
    [workspace, request, revision, connected],
  )
  const hostApi: StudioHostApi = {
    navigate: () => undefined,
    registerCommand: () => () => undefined,
  }
  return (
    <ApplicationStateProvider>
      <TooltipProvider>
        <StudioHostProvider api={hostApi}>
          <WorkspaceValueProvider value={value}>
            <FixtureContext.Provider
              value={{ task, requests, setTask, setFailNextRequest, setConnected }}
            >
              {children}
            </FixtureContext.Provider>
          </WorkspaceValueProvider>
        </StudioHostProvider>
      </TooltipProvider>
    </ApplicationStateProvider>
  )
}
