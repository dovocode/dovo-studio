import type { ReactNode } from 'react'
import { useState } from 'react'
import { View } from 'react-native'
import { Effect, Schema } from 'effect'
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto'
import { screenResponses, screenJiraIssue } from './screens-data'
import {
  AccountClient,
  createRuntimeReadCache,
  decode,
  snapshotSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import { type Runtime } from '../runtime/connection/context'
import { RuntimeValueProvider } from '../runtime/connection/provider'
import { MobileAccountContext } from '../runtime/connection/account-context'
import { NavigationContext } from '../shell/navigation'
import { SettingsTargetProvider } from '../runtime/preferences/settings-target'
import { TaskListViewProvider } from '../tasks/list/task-list-view'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { disconnectedRuntime } from './disconnected-runtime'

export type MobileScreenState = 'empty' | 'offline' | 'populated' | 'error' | 'loading'
const profile = {
  id: 'catalog-computer',
  name: 'Design workstation',
  connection: { address: 'http://catalog.invalid:51464', token: 'catalog-device-token-not-valid' },
}
const snapshot = decode(snapshotSchema, {
  revision: 1,
  owner: false,
  artifactsEnabled: true,
  workspace: {
    version: 1,
    runtimeAddress: '',
    jiraSources: [
      {
        id: 'catalog-jira',
        name: 'Design backlog',
        site: 'https://catalog.atlassian.net',
        project: 'CAT',
      },
    ],
    agents: [
      {
        id: 'catalog-agent',
        name: 'Codex',
        provider: 'codex',
        model: '',
        reasoning: '',
        instructions: '',
        permission: 'workspace-write',
        endpoint: '',
      },
    ],
    repositories: [
      {
        id: 'catalog-project',
        name: 'Mobile design system',
        path: '/catalog/mobile-design',
        branch: 'main',
        gitIdentity: 'github.com/example/catalog',
      },
    ],
    tasks: [
      ['running', 'Review the native navigation and page layouts'],
      ['failed', 'Check interrupted composer recovery'],
      ['done', 'Unify the settings hierarchy'],
      ['draft', 'Prepare the next visual review'],
      ['done', 'Archived navigation audit'],
    ].map(([status, title], index) => ({
      id: `catalog-task-${index}`,
      title,
      status,
      repositoryId: 'catalog-project',
      agentId: 'catalog-agent',
      createdAt: '2026-10-21T12:00:00.000Z',
      messages: [
        {
          id: `message-${index}`,
          role: 'user',
          text: 'Use the shared Dovo components and preserve native platform behavior.',
          createdAt: '2026-10-21T12:00:00.000Z',
        },
      ],
      ...(index === 2
        ? {
            messages: [
              {
                id: `message-${index}`,
                role: 'user',
                text: 'Use the shared Dovo components and preserve native platform behavior.',
                createdAt: '2026-10-21T12:00:00.000Z',
              },
              {
                id: 'catalog-assistant-message',
                role: 'assistant',
                text: 'The settings hierarchy now uses the shared components.\n\n- Consistent field labels\n- Native confirmation controls\n- Accessible action targets',
                createdAt: '2026-10-21T12:05:00.000Z',
              },
            ],
          }
        : {}),
      files: [],
      draft: index === 2 ? 'Compare these settings with the shared components.' : '',
      ...(index === 2
        ? {
            draftAttachments: [
              {
                id: 'd15067e2-7b50-4e1d-a267-fd7095428a01',
                name: 'design-notes.txt',
                mime: 'text/plain',
                size: 128,
              },
            ],
            queue: [
              {
                id: 'catalog-queue',
                role: 'user',
                text: 'Check the native sheet layout next.',
                createdAt: '2026-10-21T12:10:00.000Z',
              },
            ],
          }
        : {}),
      ...(index === 4 ? { archivedAt: '2026-10-21T12:20:00.000Z' } : {}),
      example: false,
    })),
    automations: [
      {
        id: 'catalog-job',
        name: 'Nightly UI review',
        enabled: false,
        nodes: ['trigger', 'task', 'review'].map((kind, index) => ({
          id: `catalog-node-${index}`,
          type: 'automation',
          position: { x: 0, y: index * 180 },
          data: {
            kind,
            label: ['Every evening', 'Review native layouts', 'Check accessibility'][index],
            trigger: 'schedule',
            schedule: '0 20 * * *',
            timezone: 'UTC',
            objective: 'Review shared UI components and native accessibility.',
            agentId: 'catalog-agent',
            repositoryId: 'catalog-project',
          },
        })),
        edges: [
          { id: 'catalog-edge-1', source: 'catalog-node-0', target: 'catalog-node-1' },
          { id: 'catalog-edge-2', source: 'catalog-node-1', target: 'catalog-node-2' },
        ],
      },
    ],
  },
  approvals: [],
  questions: [],
  terminals: [],
  runs: [
    {
      id: 'catalog-run',
      automationId: 'catalog-job',
      status: 'failed',
      completedNodes: ['catalog-node-0'],
      taskIds: ['catalog-task-1'],
      createdAt: '2026-10-21T12:00:00.000Z',
      error: 'A settings control did not meet the minimum touch target.',
      steps: [
        {
          nodeId: 'catalog-node-1',
          label: 'Review native layouts',
          kind: 'task',
          status: 'failed',
          taskId: 'catalog-task-1',
          attempt: 1,
          error: 'Check the confirmation action target.',
        },
      ],
    },
  ],
  devices: [],
  pendingDevices: [],
})
export const catalogScreenTask = snapshot.workspace.tasks[2]
const overview: RuntimeOverview = {
  profile,
  snapshot,
  lastSeen: '2026-10-21T12:00:00.000Z',
  pulls: { total: 1, needsAttention: 1, reviewRequested: 1, partial: false },
  pullError: '',
  connected: false,
  error: 'Catalog computer is offline. No network connection is attempted.',
}
const emptyRuntime: Runtime = { ...disconnectedRuntime, ready: true }
const offlineRuntime: Runtime = {
  ...disconnectedRuntime,
  snapshot,
  profile,
  profiles: [profile],
  overviews: [overview],
  activeId: profile.id,
  ready: true,
}
function readFixture<T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
): T['Type'] {
  if (path === '/api/snapshot' || path === '/api/overview') return decode(schema, snapshot)
  if (path === '/api/runtime/preferences/read')
    return decode(schema, {
      enableArtifacts: true,
      enableRemoteDesktop: false,
      allowWebRequests: false,
      worktreesRoot: '/Users/dominic/Projects/worktrees',
    })
  if (
    typeof input === 'object' &&
    input !== null &&
    'jiraSourceId' in input &&
    input.jiraSourceId === 'catalog-jira'
  ) {
    if (path === '/api/scm/work/issues/list')
      return decode(schema, { destination: 'catalog-destination', items: [screenJiraIssue] })
    if (path === '/api/scm/work/issues/detail')
      return decode(schema, {
        destination: 'catalog-destination',
        issue: screenJiraIssue,
        comments: [],
      })
    if (path === '/api/scm/work/options')
      return decode(schema, {
        destination: 'catalog-destination',
        provider: 'jira',
        issues: true,
        issueTypes: ['Story', 'Bug'],
        issueStates: ['To Do', 'In Progress', 'Done'],
        issueSearch: true,
        pipelines: false,
        pipelineActions: [],
      })
  }
  if (!Object.hasOwn(screenResponses, path))
    throw new Error(`No synthetic catalog response for ${path}`)
  return decode(schema, screenResponses[path])
}
const cacheValues = new Map<string, string>()
const catalogCache = createRuntimeReadCache(
  profile.connection,
  {
    getItem: async (key) => cacheValues.get(key) ?? null,
    setItem: async (key, value) => {
      cacheValues.set(key, value)
    },
    removeItem: async (key) => {
      cacheValues.delete(key)
    },
    removePrefix: async (prefix) => {
      for (const key of cacheValues.keys()) if (key.startsWith(prefix)) cacheValues.delete(key)
    },
  },
  (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
)
const populatedRuntime: Runtime = {
  ...offlineRuntime,
  connected: true,
  connection: profile.connection,
  // Refresh is a read-only synthetic no-op: the supplied snapshot is already current.
  refresh: async () => {},
  refreshAll: async () => {},
  refreshRuntime: async () => {},
  refreshEffect: () => Effect.void,
  refreshRuntimeEffect: () => Effect.void,
  cacheForRuntime: () => catalogCache,
  readCache: catalogCache,
  overviews: [{ ...overview, connected: true, error: '' }],
  read: async (path, input, schema) => readFixture(path, input, schema),
  readRuntime: async (_profile, path, input, schema) => readFixture(path, input, schema),
  readEffect: (path, input, schema) =>
    Effect.try({
      try: () => readFixture(path, input, schema),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  readRuntimeEffect: (_profile, path, input, schema) =>
    Effect.try({
      try: () => readFixture(path, input, schema),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
}
const errorRuntime: Runtime = {
  ...populatedRuntime,
  read: disconnectedRuntime.read,
  readRuntime: disconnectedRuntime.readRuntime,
  readEffect: disconnectedRuntime.readEffect,
  readRuntimeEffect: disconnectedRuntime.readRuntimeEffect,
  error: 'Synthetic catalog connection failure. Retry is disabled.',
  cacheForRuntime: disconnectedRuntime.cacheForRuntime,
  readCache: null,
  overviews: [{ ...overview, connected: true, error: 'Synthetic catalog connection failure.' }],
}
// The account client is never loaded. Sign-in is disabled by loaded=false and no saved
// session, directory, or production account storage is supplied to this catalog.
const accountClient = new AccountClient(
  {
    read: async () => null,
    write: async () => {
      throw new Error('Catalog account storage is disabled')
    },
  },
  async () => {
    throw new Error('Catalog sign-in is disabled')
  },
  'https://catalog.invalid',
)
const account = { ...accountClient.snapshot(), client: accountClient, loaded: false }

/** No runtime provider or account effects are mounted. Mutations reject through the real context. */
export function MobileScreenProviders({
  children,
  state = 'empty',
  suppressTaskWatch = false,
}: {
  children: ReactNode
  state?: MobileScreenState
  suppressTaskWatch?: boolean
}) {
  const [intent, setIntent] = useState('')
  const { colors } = useTheme()
  const selectedRuntime =
    state === 'offline'
      ? offlineRuntime
      : state === 'populated'
        ? populatedRuntime
        : state === 'error'
          ? errorRuntime
          : state === 'loading'
            ? { ...disconnectedRuntime, recovering: true, registryLoaded: false }
            : emptyRuntime
  const runtime = suppressTaskWatch ? { ...selectedRuntime, profile: null } : selectedRuntime
  return (
    <RuntimeValueProvider value={runtime}>
      <MobileAccountContext.Provider value={account}>
        <SettingsTargetProvider>
          <TaskListViewProvider>
            <NavigationContext.Provider
              value={{
                focused: true,
                navigate: (view) => setIntent(`Navigation requested: ${view}`),
                openWork: (target) => setIntent(`Open ${target.kind}: ${target.id ?? 'new'}`),
              }}
            >
              <View style={{ flex: 1, minHeight: 640 }}>
                {children}
                {!!intent && (
                  <Text accessibilityRole="status" style={{ color: colors.muted, padding: 12 }}>
                    {intent}
                  </Text>
                )}
              </View>
            </NavigationContext.Provider>
          </TaskListViewProvider>
        </SettingsTargetProvider>
      </MobileAccountContext.Provider>
    </RuntimeValueProvider>
  )
}
