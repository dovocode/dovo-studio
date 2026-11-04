import { Effect, Schema } from 'effect'
import { useMemo, type ReactNode } from 'react'
import {
  StudioHostProvider,
  WorkspaceValueProvider,
  useWorkspace,
  type StudioHostApi,
  type WorkspaceContextValue,
} from '@dovo/studio-core'
import {
  resolveScopedSettings,
  scopedAgentEntries,
  scopedSettingsReadSchema,
  type RuntimeReadCache,
} from '../../../packages/protocol/src'
import {
  screenPull,
  screenIssue,
  screenAutomation,
  screenPipeline,
  screenIssuePage,
  screenPipelinePage,
} from './desktop-screens-data'
import sampleImage from './assets/ui-polish-image.png'
import { ComposerFixtureProvider } from './composer-fixture'
import {
  busyDesktopDraft,
  busyDesktopQuestion,
  busyDesktopWorkspace,
} from './desktop-busy-workspace'

const readCache: RuntimeReadCache = {
  closed: false,
  readEffect: () => Effect.succeed(null),
  writeEffect: () => Effect.succeed(undefined),
  removeEffect: () => Effect.succeed(undefined),
  clearEffect: () => Effect.succeed(undefined),
  closeEffect: () => Effect.succeed(undefined),
  read: async () => null,
  write: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
  close: async () => undefined,
}

export type DesktopScreenState =
  | 'git-changes'
  | 'legacy'
  | 'populated'
  | 'busy'
  | 'busy-long-draft'
  | 'idle'
  | 'empty'
  | 'loading'
  | 'error'
  | 'offline'

function ScreenWorkspace({
  children,
  state,
  navigate,
}: {
  children: ReactNode
  state: DesktopScreenState
  navigate: (viewId: string) => void
}) {
  const root = useWorkspace()
  const value = useMemo<WorkspaceContextValue>(() => {
    const source =
      state === 'busy' || state === 'busy-long-draft'
        ? busyDesktopWorkspace(
            root.workspace,
            state === 'busy-long-draft' ? busyDesktopDraft : undefined,
          )
        : root.workspace
    const workspace =
      state === 'empty'
        ? { ...root.workspace, tasks: [], repositories: [], agents: [], automations: [] }
        : {
            ...source,
            tasks:
              state === 'idle'
                ? root.workspace.tasks.map((task) => ({
                    ...task,
                    status: 'done' as const,
                    activeRunId: undefined,
                    pullRequest: undefined,
                    workItem: undefined,
                  }))
                : source.tasks,
            // Live runtimes always include a scratch project for the welcome composer.
            repositories: [
              ...source.repositories,
              {
                id: 'preview-scratch',
                kind: 'scratch' as const,
                name: 'No project',
                path: '/preview/scratch',
                branch: '',
              },
            ],
            automations: root.workspace.automations.length
              ? root.workspace.automations
              : [screenAutomation],
          }
    const snapshot = root.snapshot
      ? {
          ...root.snapshot,
          workspace,
          questions:
            state === 'busy' || state === 'busy-long-draft'
              ? [...root.snapshot.questions, busyDesktopQuestion]
              : root.snapshot.questions,
          artifactsEnabled: true,
          scopedAgentsSupported: state !== 'legacy',
          taskBehaviorSupported: state !== 'legacy',
          threadBehaviorSupported: state !== 'legacy',
          terminals: [
            {
              id: 'preview-terminal',
              taskId: 'preview-task',
              title: 'Project shell',
              exited: false,
            },
          ],
        }
      : null
    const profile = root.runtimeRegistry.profiles[0]
    const unavailable = async (): Promise<never> => {
      throw new Error('Catalog preview: runtime and account mutations are disabled.')
    }
    const request: WorkspaceContextValue['request'] = async (path, input, schema, method) => {
      if (state === 'loading') return new Promise<never>(() => undefined)
      if (state === 'error' || state === 'offline')
        throw new Error(
          state === 'offline' ? 'Preview computer is offline.' : 'Synthetic runtime read failed.',
        )
      const reads: Record<string, unknown> = {
        '/api/runtime/preferences/read': {},
        '/api/tasks/codex-sessions/list': { sessions: [] },
        '/api/tasks/pi-sessions/list': { sessions: [] },
        '/api/scm/work/pipelines/definitions': { items: [{ id: 'checks.yml', name: 'Checks' }] },
        '/api/scm/repositories/git-status': { initialized: true, remotes: ['origin'] },
        '/api/scm/instructions/read': {
          text: '# Project instructions\n\nKeep changes focused. Run the relevant checks before opening a pull request.\n',
          version: 'preview-1',
        },
        '/api/tasks/commits/read': { commits: [], hasMore: false },
        '/api/commands/read': { settings: {}, defaultShell: '/bin/bash' },
        '/api/runtime/diagnostics': {
          ready: true,
          checkedAt: '2026-10-21T10:00:00.000Z',
          warnings: [],
          roots: {
            database: '/preview/dovo.sqlite',
            worktrees: '/preview/worktrees',
            worktreesSource: 'default',
          },
          storage: { available: true, freeBytes: 128000000000, error: null },
          schedulers: {
            tasks: { lastSuccess: '2026-10-21T10:00:00.000Z', error: null },
            jobs: { lastSuccess: '2026-10-21T10:00:00.000Z', error: null },
            errors: [],
          },
          queues: { queued: 2, paused: 0, waitingQuestions: 0, waitingApprovals: 0 },
          operations: [],
          uncertain: { count: 0, actions: [] },
          backups: {
            entries: [],
            failure: null,
            active: false,
            maxCount: 10,
            maxBytes: 1000000000,
          },
        },
        '/api/memory/settings/read': {},
        '/api/memory/projects/read': {
          projects: workspace.repositories.map((entry) => ({
            id: entry.id,
            name: entry.name,
            registered: true,
          })),
        },
        '/api/memory/list': { entries: [], total: 0 },
        '/api/activity': { events: [] },
        '/api/snapshot': snapshot,
        '/api/artifacts/list': { artifacts: [], links: [] },
        '/api/tasks/files/list': { files: ['src/navigation.tsx', 'README.md'] },
        '/api/scm/changes': {
          files:
            state === 'git-changes'
              ? [
                  {
                    path: 'src/navigation.tsx',
                    before: 'export const label = "Tasks"\n',
                    after: 'export const label = "Threads"\n',
                    viewed: false,
                  },
                  {
                    path: 'README.md',
                    before: '# Workspace\n',
                    after: '# Dovo workspace\n',
                    viewed: false,
                  },
                ]
              : [],
        },
        '/api/scm/inspect': { path: '/workspace/dovo-studio', branch: 'feature/navigation' },
        '/api/terminals/ticket': { ticket: 'catalog-preview' },
        '/api/review/read': { files: [], groups: [] },
        '/api/tasks/waiting': { dependencies: [] },
        '/api/artifacts/library': { artifacts: [] },
        '/api/agents/title-settings/read': {},
        '/api/usage/history/read': { sourceId: 'preview', records: [], notices: [] },
        '/api/scm/connections/read': { connections: [] },
        '/api/scm/connections/github/read': {
          status: 'verified',
          stage: 'account',
          host: 'github.com',
          login: 'preview-author',
          checkedAt: '2026-10-21T10:00:00.000Z',
          message: 'Connected',
        },
        '/api/scm/worktrees/read': { root: '/preview/worktrees', worktrees: [] },
        '/api/commands/cua/check': {
          path: null,
          available: false,
          version: null,
          detail: 'Computer use is not installed on this preview computer.',
          daemon: null,
          permissions: null,
          platform: 'linux',
        },
        '/api/tasks/files/directory': {
          entries: [
            { path: 'README.md', kind: 'file' },
            { path: 'src', kind: 'directory' },
          ],
          truncated: false,
        },
        '/api/scm/action-state': {
          dirty: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          tracking: true,
          canPush: false,
        },

        '/api/device-hosts': { enabled: false, hosts: [] },
        '/api/previews/browser/profiles/read': { profiles: [{ id: 'default', name: 'Default' }] },
        '/api/previews/devices': { host: 'Preview computer', devices: [], diagnostics: [] },

        '/api/scm/source/identity': {
          readerIdentity: 'preview-reader',
          destination: 'preview-destination',
        },
        '/api/scm/pulls/detail': screenPull,
        '/api/scm/pulls/overview': { pulls: [screenPull.pull], page: 1, hasMore: false },
        '/api/scm/work/options': {
          provider: 'github',
          issues: true,
          pipelines: true,
          pipelineActions: [],
        },
        '/api/scm/work/issues/list': screenIssuePage,
        '/api/scm/work/issues/detail': screenIssue,
        '/api/scm/work/pipelines/list': screenPipelinePage,
        '/api/scm/work/pipelines/detail': screenPipeline,
        '/api/scm/work/issues/discussion': screenIssue,
      }
      if (
        path === '/api/attachments/read' &&
        typeof input === 'object' &&
        input !== null &&
        'id' in input &&
        (input.id === 'e173b499-5caf-45ab-884c-355ee729af43' ||
          input.id === 'f8e2ad6f-951c-46c7-a3ac-8dcb4e778ac4')
      )
        return Schema.decodeUnknownSync(schema)({
          attachment: {
            id: input.id,
            name: 'workspace.png',
            mime: 'image/png',
            size: 12400,
          },
          data: btoa(
            String.fromCharCode(...new Uint8Array(await (await fetch(sampleImage)).arrayBuffer())),
          ),
        })
      if (path === '/api/tasks/files/read') {
        const file = Schema.decodeUnknownSync(Schema.Struct({ path: Schema.String }))(input)
        return Schema.decodeUnknownSync(schema)({
          path: file.path,
          contents: file.path.endsWith('.md')
            ? '# Dovo UI catalog\n\nSynthetic project files for the real preview panel.\n'
            : 'export const navigationLabel = "Projects"\n',
        })
      }
      if (path in reads) return Schema.decodeUnknownSync(schema)(reads[path])
      if (path === '/api/agents/settings/read' && snapshot) {
        const inputValue = Schema.decodeUnknownSync(scopedSettingsReadSchema)(input)
        const repository = workspace.repositories.find(
          (entry) => entry.id === inputValue.repositoryId,
        )
        return Schema.decodeUnknownSync(schema)({
          value: {},
          inherited: {
            ...resolveScopedSettings(snapshot.defaults, repository, inputValue.scope),
            ...(inputValue.includeAgents
              ? {
                  agents: scopedAgentEntries(
                    snapshot.defaults,
                    repository,
                    workspace.agents,
                    inputValue.scope,
                  ).map(({ agent }) => agent),
                }
              : {}),
          },
        })
      }
      // Only the composer's explicitly implemented synthetic read endpoints are allowed.
      // Unknown endpoints fail locally; no browser fetch or real runtime is involved.
      if (
        method !== 'GET' &&
        ![
          '/api/agents/availability',
          '/api/scm/branches',
          '/api/agents/models/cached',
          '/api/agents/models',
          '/api/tasks/files',
          '/api/attachments/read',
        ].includes(path)
      )
        throw new Error(`Catalog preview: no response for ${path}.`)
      return root.request(path, input, schema, method)
    }
    return {
      ...root,
      readCache,
      runtimeReadCache: () => readCache,
      workspace,
      snapshot,
      ready: state !== 'loading',
      connected: state !== 'offline',
      syncError: state === 'error' ? 'Synthetic workspace synchronization failed.' : null,
      request,
      requestEffect: (path, input, schema, method) =>
        Effect.tryPromise(() => request(path, input, schema, method)),
      readRuntime: (_profile, path, input, schema, method) => request(path, input, schema, method),
      readRuntimeEffect: (_profile, path, input, schema, method) =>
        Effect.tryPromise(() => request(path, input, schema, method)),
      runtimes: profile
        ? [
            {
              profile,
              snapshot,
              connected: state !== 'offline',
              lastSeen: null,
              error: state === 'offline' ? 'Preview computer is offline.' : null,
              pulls: null,
              pullError: null,
            },
          ]
        : [],
      connect: unavailable,
      disconnect: unavailable,
      forgetRuntime: unavailable,
      switchRuntime: async () => undefined,
    }
  }, [root, state])
  const api = useMemo<StudioHostApi>(
    () => ({
      navigate: (target) => navigate(target.viewId),
      registerCommand: () => () => undefined,
      appInfo: { version: 'Catalog preview', channel: 'dev' },
      browser: async () => ({ url: '', title: 'New tab', back: false, forward: false }),
    }),
    [navigate],
  )
  return (
    <StudioHostProvider api={api}>
      <WorkspaceValueProvider value={value}>{children}</WorkspaceValueProvider>
    </StudioHostProvider>
  )
}
export function DesktopScreenFixture({
  children,
  state,
  navigate,
}: {
  children: ReactNode
  state: DesktopScreenState
  navigate: (viewId: string) => void
}) {
  return (
    <ComposerFixtureProvider>
      <ScreenWorkspace state={state} navigate={navigate}>
        {children}
      </ScreenWorkspace>
    </ComposerFixtureProvider>
  )
}
