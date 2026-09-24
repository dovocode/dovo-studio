import { useEffect } from 'react'
import { View } from 'react-native'
import { Schema } from 'effect'
import {
  executionSchema,
  accessModes,
  agentSchema,
  decode,
  defaultTaskHarness,
  projectTaskDefaultsSchema,
  providerSchema,
  runtimeSetupSchema,
  runtimeDefaultsSchema,
  supportsAccess,
  taskHarnessSchema,
  type ProjectTaskDefaults,
  type Repository,
  type RuntimeSetup,
} from '@dovo/protocol'
import { useApplicationState } from './application-state'
import { useRuntime } from './provider'
import { useAction } from '../ui/use-action'
import { Text } from '../ui/text'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { ModelSettings } from '../agents/model-settings'
export function TaskDefaultSettings(props: { repository?: Repository }) {
  const [open, setOpen] = useApplicationState(false)
  return (
    <View style={{ gap: 12 }}>
      <Action
        secondary
        label={open ? 'Hide task defaults' : 'Task defaults'}
        onPress={() => setOpen(!open)}
      />
      {open && <TaskDefaultSettingsForm {...props} />}
    </View>
  )
}
function TaskDefaultSettingsForm({ repository }: { repository?: Repository }) {
  const { connected, call } = useRuntime()
  const { busy, error, act } = useAction()
  const [setup, setSetup] = useApplicationState<RuntimeSetup | null>(null)
  const [draft, setDraft] = useApplicationState<ProjectTaskDefaults>({})
  const [loadError, setLoadError] = useApplicationState('')
  const [saved, setSaved] = useApplicationState(false)
  const [retry, setRetry] = useApplicationState(0)
  useEffect(() => {
    let active = true
    setSetup(null)
    if (!connected) return
    void call('/api/agents/setup/read', {}, runtimeSetupSchema)
      .then((value) => {
        if (active) {
          setSetup(value)
          setDraft(repository?.taskDefaults ?? (repository ? {} : value.defaults))
        }
      })
      .catch((error: unknown) => {
        if (active) setLoadError(String(error))
      })
    return () => {
      active = false
    }
  }, [call, connected, repository?.id, retry])
  const change = (value: ProjectTaskDefaults) => {
    setDraft(value)
    setSaved(false)
  }
  const harness = draft.harness
  const disabled = !connected || busy || !setup
  return (
    <View style={[styles.card, { gap: 12 }]}>
      <Text style={styles.text}>Task defaults</Text>
      <Text style={styles.muted}>
        {repository
          ? 'Project overrides. Unset values inherit this runtime’s defaults.'
          : 'Defaults for new tasks on this runtime. Projects can override them.'}{' '}
        Existing tasks keep their settings.
      </Text>
      {repository && (
        <Choice
          label="Agent configuration"
          disabled={disabled}
          value={harness ? 'custom' : 'inherit'}
          items={[
            {
              id: 'inherit',
              name: `Use runtime default (${setup?.defaults.harness.provider ?? ''})`,
            },
            { id: 'custom', name: 'Project override' },
          ]}
          onChange={(value) =>
            change({
              ...draft,
              harness:
                value === 'inherit'
                  ? undefined
                  : (setup?.defaults.harness ?? defaultTaskHarness('codex')),
            })
          }
        />
      )}
      {harness && (
        <>
          <Choice
            label="Harness"
            disabled={disabled}
            value={harness.provider}
            items={providerSchema.literals.map((id) => ({ id, name: id }))}
            onChange={(value) =>
              change({ ...draft, harness: defaultTaskHarness(decode(providerSchema, value)) })
            }
          />
          <ModelSettings
            disabled={disabled}
            agent={{ ...harness, id: 'defaults', name: 'Task defaults' }}
            onChange={(agent) =>
              change({ ...draft, harness: decode(taskHarnessSchema.omit('resources'), agent) })
            }
          />
          <Choice
            label="Access"
            disabled={disabled}
            value={harness.permission}
            items={accessModes
              .filter((mode) => supportsAccess(harness.provider, mode.id))
              .map((mode) => ({ id: mode.id, name: mode.name }))}
            onChange={(value) =>
              change({
                ...draft,
                harness: { ...harness, permission: decode(agentSchema.fields.permission, value) },
              })
            }
          />
          <Field
            label="Instructions"
            multiline
            editable={!disabled}
            value={harness.instructions}
            onChangeText={(instructions) =>
              change({ ...draft, harness: { ...harness, instructions } })
            }
          />
          <Field
            label={harness.provider === 'opencode' ? 'Server URL' : 'Executable (optional)'}
            editable={!disabled}
            value={harness.endpoint}
            onChangeText={(endpoint) => change({ ...draft, harness: { ...harness, endpoint } })}
          />
        </>
      )}
      <Choice
        label="Working directory"
        disabled={disabled}
        value={draft.execution ?? (repository ? 'inherit' : 'main')}
        items={[
          ...(repository
            ? [
                {
                  id: 'inherit',
                  name: `Use runtime default (${setup?.defaults.execution === 'worktree' ? 'Worktree' : 'Local checkout'})`,
                },
              ]
            : []),
          { id: 'main', name: 'Local checkout' },
          { id: 'worktree', name: 'New worktree' },
        ]}
        onChange={(value) =>
          change({
            ...draft,
            execution: value === 'inherit' ? undefined : decode(executionSchema, value),
          })
        }
      />
      <Field
        label="Worktree base branch"
        editable={!disabled}
        autoCapitalize="none"
        value={draft.worktreeBaseBranch ?? ''}
        placeholder={
          repository
            ? `Use runtime default (${setup?.defaults.worktreeBaseBranch ?? 'origin/main → origin/master'})`
            : 'Automatic: origin/main → origin/master'
        }
        onChangeText={(value) => change({ ...draft, worktreeBaseBranch: value || undefined })}
      />
      {repository && (
        <Choice
          label="Worktree setup"
          disabled={disabled}
          value={draft.setupCommand === undefined ? 'inherit' : 'custom'}
          items={[
            { id: 'inherit', name: 'Use runtime default' },
            { id: 'custom', name: 'Project override (empty disables setup)' },
          ]}
          onChange={(value) =>
            change({ ...draft, setupCommand: value === 'inherit' ? undefined : '' })
          }
        />
      )}
      {(!repository || draft.setupCommand !== undefined) && (
        <Field
          label="Setup command"
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          value={draft.setupCommand ?? ''}
          placeholder="pnpm install --frozen-lockfile"
          onChangeText={(setupCommand) => change({ ...draft, setupCommand })}
        />
      )}
      <Text style={styles.muted}>
        Setup runs in each new worktree using this runtime’s shell, before the agent starts.
        Five-minute limit. Failures stop startup; retrying the task retries setup. Use an idempotent
        command.
      </Text>
      <Action
        label={busy ? 'Saving…' : 'Save defaults'}
        disabled={disabled}
        onPress={() =>
          act(async () => {
            if (!setup) return
            const value = decode(projectTaskDefaultsSchema, draft)
            if (repository)
              await call(
                '/api/workspace',
                {
                  collection: 'repositories',
                  id: repository.id,
                  changes: {
                    taskDefaults: { before: repository.taskDefaults ?? null, after: value },
                  },
                },
                Schema.Struct({ revision: Schema.Number }),
                'PATCH',
              )
            else
              await call(
                '/api/agents/defaults/save',
                {
                  before: setup.defaults,
                  after: {
                    ...value,
                    harness: value.harness ?? setup.defaults.harness,
                    configured: true,
                  },
                },
                runtimeDefaultsSchema,
              ).then((defaults) => setSetup({ ...setup, defaults }))
            setSaved(true)
          })
        }
      />
      {repository && (
        <Action
          secondary
          label="Reset to runtime defaults"
          disabled={disabled}
          onPress={() => change({})}
        />
      )}
      {saved && <Text style={styles.muted}>Defaults saved for new tasks.</Text>}
      {!!(error || loadError) && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error || loadError}
          </Text>
          <Action
            secondary
            label="Reload settings"
            onPress={() => {
              setLoadError('')
              setRetry(retry + 1)
            }}
          />
        </>
      )}
    </View>
  )
}
