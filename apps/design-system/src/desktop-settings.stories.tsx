import type { Meta, StoryObj } from '@storybook/react-vite'
import { Effect, Schema } from 'effect'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import {
  decode,
  resolveScopedSettings,
  runtimeDefaultsSchema,
  scopedSettingsReadSchema,
  scopedSettingsSaveSchema,
  sharedProjectKey,
  type ScopedSettingsValue,
  type SettingsScope,
  type RuntimeReadCache,
} from '../../../packages/protocol/src'
import { WorkspaceValueProvider, useWorkspace, type WorkspaceContextValue } from '@dovo/studio-core'
import { SettingsTargetProvider } from '../../../packages/studio-core/src/settings-target'
import { HostSettingsPage } from '../../../packages/studio-ui/src/host-settings-page'
import { SettingsScopePage } from '../../../packages/studio-ui/src/settings-scope-page'
import { TaskBehaviorSettings } from '../../../packages/studio-ui/src/task-behavior-settings'
import { SettingRow, SettingsGroup, Toggle } from '../../../packages/studio-ui/src/settings-layout'
import { ComposerFixtureProvider } from './composer-fixture'

const meta = {
  title: 'Dovo/Settings/Desktop settings',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'SettingsNav in studio-shell owns desktop navigation, categories, search, and storage labels. SettingsScopePage and HostSettingsPage in studio-ui own target/computer composition; TaskBehaviorSettings owns lifecycle fields and source controls. The stories supply schema-shaped in-memory API responses, so edits never reach a computer, account, file, or network service.',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const projectId = 'preview-project'
const emptyRuntimeReadCache: RuntimeReadCache = {
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

const initialValues: Record<string, ScopedSettingsValue> = {
  global: { taskBehavior: { settleInactive: false, inactiveDays: 5 } },
  environment: { taskBehavior: { settleMerged: true, settleInactive: true, inactiveDays: 10 } },
  [`project:${projectId}`]: { taskBehavior: { settleClosed: true, inactiveDays: 3 } },
  [`environment-project:${projectId}`]: { taskBehavior: { continueAfterRestart: false } },
}

function scopeKey(scope: SettingsScope, repository?: string) {
  return scope === 'global' || scope === 'environment' ? scope : `${scope}:${repository ?? ''}`
}

function LocalSettingsWorkspace({
  children,
  offline = false,
}: {
  children: ReactNode
  offline?: boolean
}) {
  const root = useWorkspace()
  const [values, setValues] = useState(initialValues)
  const profile = root.runtimeRegistry.profiles[0]
  const originalRepository = root.workspace.repositories[0]
  if (!profile || !root.snapshot || !originalRepository)
    throw new Error('Desktop settings stories require the local composer fixture.')

  const valuesFor = (scope: SettingsScope, repository?: string) =>
    values[scopeKey(scope, repository)] ?? {}
  const repository = {
    ...originalRepository,
    taskBehavior: valuesFor('environment-project', originalRepository.id).taskBehavior,
  }
  const workspace = {
    ...root.workspace,
    repositories: root.workspace.repositories.map((entry) =>
      entry.id === repository.id ? repository : entry,
    ),
  }
  const projectKey = sharedProjectKey(repository)
  const shared = [
    { key: 'global', updatedAt: 1, changeId: 'preview-global', value: valuesFor('global') },
    ...(projectKey
      ? [
          {
            key: projectKey,
            updatedAt: 2,
            changeId: 'preview-project',
            value: valuesFor('project', repository.id),
          },
        ]
      : []),
  ]
  const defaults = decode(runtimeDefaultsSchema, {
    ...root.snapshot.defaults,
    scopedSettings: { environment: valuesFor('environment'), shared },
  })
  const snapshot = {
    ...root.snapshot,
    workspace,
    taskBehaviorSupported: true,
    threadBehaviorSupported: true,
    defaults,
  }
  const runtime = {
    profile,
    snapshot,
    connected: !offline,
    lastSeen: '2026-10-21T10:00:00.000Z',
    error: offline ? 'This preview computer is intentionally offline.' : null,
    pulls: null,
    pullError: null,
  }
  const current = useRef({ values, defaults, repository, projectKey })
  current.current = { values, defaults, repository, projectKey }

  const request = useCallback<WorkspaceContextValue['request']>(async (path, input, schema) => {
    if (path === '/api/runtime/preferences/read') return Schema.decodeUnknownSync(schema)({})
    if (path === '/api/agents/settings/read') {
      const parsed = Schema.decodeUnknownSync(scopedSettingsReadSchema)(input)
      const fixture = current.current
      const settingValues = fixture.values[scopeKey(parsed.scope, parsed.repositoryId)] ?? {}
      const inherited = resolveScopedSettings(fixture.defaults, fixture.repository, parsed.scope)
      return Schema.decodeUnknownSync(schema)({
        value: settingValues,
        inherited,
        projectKey: parsed.scope === 'project' ? fixture.projectKey : undefined,
      })
    }
    if (path === '/api/agents/settings/save') {
      const parsed = Schema.decodeUnknownSync(scopedSettingsSaveSchema)(input)
      const saved: ScopedSettingsValue = parsed.after
      setValues((current) => ({
        ...current,
        [scopeKey(parsed.scope, parsed.repositoryId)]: saved,
      }))
      const fixture = current.current
      return Schema.decodeUnknownSync(schema)({
        value: saved,
        inherited: resolveScopedSettings(fixture.defaults, fixture.repository, parsed.scope),
        projectKey: parsed.scope === 'project' ? fixture.projectKey : undefined,
      })
    }
    throw new Error(`Unsupported local settings preview request: ${path}`)
  }, [])
  const requestEffect = useCallback<WorkspaceContextValue['requestEffect']>(
    (path, input, schema, method) => Effect.tryPromise(() => request(path, input, schema, method)),
    [request],
  )
  const readRuntime = useCallback<WorkspaceContextValue['readRuntime']>(
    (_profile, path, input, schema) => request(path, input, schema),
    [request],
  )
  const readRuntimeEffect = useCallback<WorkspaceContextValue['readRuntimeEffect']>(
    (_profile, path, input, schema) => Effect.tryPromise(() => request(path, input, schema)),
    [request],
  )
  const refreshRuntime = useCallback<WorkspaceContextValue['refreshRuntime']>(async () => {
    throw new Error('The preview computer remains offline; no connection was attempted.')
  }, [])
  const value: WorkspaceContextValue = {
    ...root,
    workspace,
    snapshot,
    connected: !offline,
    activeRuntimeId: profile.id,
    runtimes: [runtime],
    request,
    requestEffect,
    readRuntime,
    readRuntimeEffect,
    refreshRuntime,
    runtimeReadCache: () => emptyRuntimeReadCache,
  }
  return <WorkspaceValueProvider value={value}>{children}</WorkspaceValueProvider>
}

function ScopedLifecycleSettingsPage() {
  return (
    <SettingsTargetProvider>
      <SettingsScopePage
        title="Task behavior"
        description="Lifecycle defaults apply to existing tasks and follow the selected inheritance level."
      >
        {({ scope, repository }) => <TaskBehaviorSettings scope={scope} repository={repository} />}
      </SettingsScopePage>
    </SettingsTargetProvider>
  )
}

function HostSettingsExample() {
  const [preview, setPreview] = useState(true)
  return (
    <HostSettingsPage
      title="Computer settings"
      description="Settings that belong to one paired computer."
      initialRuntimeId="preview-codex"
      localSettings={
        <SettingsGroup title="This device">
          <SettingRow
            label="Desktop quick input preview"
            description="This local app preference remains available when the paired computer is offline."
          >
            <Toggle label="Desktop quick input preview" checked={preview} onChange={setPreview} />
          </SettingRow>
        </SettingsGroup>
      }
    >
      <p>Connected computer settings would render here.</p>
    </HostSettingsPage>
  )
}

const withSettingsFixture = (children: ReactNode, offline = false) => (
  <ComposerFixtureProvider>
    <LocalSettingsWorkspace offline={offline}>{children}</LocalSettingsWorkspace>
  </ComposerFixtureProvider>
)

export const ScopedLifecycleSettings: Story = {
  render: () => withSettingsFixture(<ScopedLifecycleSettingsPage />),
  parameters: {
    docs: {
      description: {
        story:
          'This is the production scoped settings page and lifecycle editor. Change the project/computer targets or choose a level in Settings inheritance, change a lifecycle value, use View inheritance or Use inherited value, then save. Reads and saves go only to the in-memory schema adapter; source badges reflect synthetic global, computer, and project values.',
      },
    },
  },
}

export const OfflineComputerSettings: Story = {
  render: () => withSettingsFixture(<HostSettingsExample />, true),
  parameters: {
    docs: {
      description: {
        story:
          'Uses the production HostSettingsPage to show its offline state and retry error. The local-device quick-input switch remains available. Retry is handled by the fixture with a clear local error and does not contact a computer.',
      },
    },
  },
}
