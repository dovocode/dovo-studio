import { mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import {
  accessModes,
  supportsAccess,
  canChangeTaskProvider,
  lockedTaskProvider,
} from '@dovo/protocol'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { View } from 'react-native'
import { Sheet } from '../ui/sheet'
import { Text } from '../ui/text'
import { Schema } from 'effect'
import { agentSchema, providerSchema, type Agent } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
export function AgentEditor({
  original,
  creating,
  onClose,
}: {
  original: Agent
  creating: boolean
  onClose: () => void
}) {
  const { connected, profile, snapshot, callEffect } = useRuntime(),
    { busy, error, act } = useAction(),
    [draft, setDraft] = useApplicationState(original)
  const lockedTasks = creating
    ? []
    : (snapshot?.workspace.tasks ?? []).filter(
        (task) => !task.harness && task.agentId === original.id && !canChangeTaskProvider(task),
      )
  const providerLocked = lockedTasks.length > 0
  const providerLocks = [
    ...new Set(
      lockedTasks
        .map((task) => lockedTaskProvider(task, snapshot?.workspace.agents ?? []))
        .filter((provider) => provider !== undefined),
    ),
  ]
  const requiredProvider = providerLocks.length === 1 ? providerLocks[0] : original.provider
  const providerAllowed = !providerLocked || draft.provider === requiredProvider
  const save = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!providerAllowed) return
        const valid = decode(agentSchema, {
            ...draft,
            name: draft.name.trim(),
          }),
          changes: Record<
            string,
            {
              before: unknown
              after: unknown
            }
          > = {}
        const before = decode(
            Schema.mutable(
              Schema.Record({
                key: Schema.String,
                value: Schema.Unknown,
              }),
            ),
            original,
          ),
          after = decode(
            Schema.mutable(
              Schema.Record({
                key: Schema.String,
                value: Schema.Unknown,
              }),
            ),
            valid,
          )
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
          if (key !== 'id' && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
            changes[key] = {
              before: before[key] ?? null,
              after: after[key] ?? null,
            }
        yield* callEffect(
          '/api/workspace',
          {
            collection: 'agents',
            id: valid.id,
            changes,
            ...(creating
              ? {
                  create: valid,
                }
              : {}),
          },
          mutableStruct({
            revision: Schema.Number.pipe(Schema.finite()),
          }),
          'PATCH',
        )
        onClose()
      }),
    )
  }
  return (
    <Sheet
      title={`${creating ? 'New' : 'Edit'} agent · ${profile?.name ?? 'Computer'}`}
      busy={busy}
      onClose={onClose}
    >
      <Field
        label="Name"
        editable={!busy}
        value={draft.name}
        onChangeText={(name) =>
          setDraft({
            ...draft,
            name,
          })
        }
      />
      <Choice
        label="Provider"
        disabled={busy || (providerLocked && providerAllowed)}
        value={draft.provider}
        items={(providerLocked ? [requiredProvider] : providerSchema.literals).map((id) => ({
          id,
          name: id,
        }))}
        onChange={(value) => {
          if (providerLocked && value !== requiredProvider) return
          setDraft({
            ...draft,
            provider: decode(providerSchema, value),
            model: '',
            reasoning: '',
            serviceTier: undefined,
            cyberAccessProgram: undefined,
            acpInstallationId: undefined,
            acpMode: undefined,
            acpConfig: undefined,
            endpoint: '',
            args: [],
          })
        }}
      />
      {providerLocked && (
        <Text style={styles.muted}>
          This agent is used by an existing thread. Its provider is fixed; models and settings can
          still change.
        </Text>
      )}
      {draft.provider === 'acp' && <AcpRegistry agent={draft} onChange={setDraft} />}
      <ModelSettings
        key={draft.provider}
        agent={draft}
        onChange={setDraft}
        disabled={busy || !providerAllowed}
      />
      {(draft.provider !== 'acp' || !draft.acpInstallationId) && (
        <Field
          label={
            draft.provider === 'opencode' ? 'Server URL' : 'Executable path · blank uses default'
          }
          value={draft.endpoint}
          editable={!busy}
          onChangeText={(endpoint) =>
            setDraft({
              ...draft,
              endpoint,
            })
          }
        />
      )}
      {draft.provider === 'acp' && !draft.acpInstallationId && (
        <Field
          label="Arguments · one per line"
          editable={!busy}
          value={(draft.args ?? []).join('\n')}
          onChangeText={(value) =>
            setDraft({
              ...draft,
              args: value.split('\n').filter(Boolean),
            })
          }
          multiline
        />
      )}
      <Choice
        label="Access"
        disabled={busy}
        value={draft.permission}
        items={accessModes
          .filter((mode) => supportsAccess(draft.provider, mode.id))
          .map((mode) => ({
            id: mode.id,
            name: mode.name,
          }))}
        onChange={(value) =>
          setDraft({
            ...draft,
            permission: decode(agentSchema.fields.permission, value),
          })
        }
      />
      <Field
        label="Instructions"
        editable={!busy}
        multiline
        value={draft.instructions}
        onChangeText={(instructions) =>
          setDraft({
            ...draft,
            instructions,
          })
        }
        style={[
          styles.input,
          {
            minHeight: 150,
            textAlignVertical: 'top',
          },
        ]}
      />
      <View style={styles.row}>
        <Action
          label="Save agent"
          disabled={
            !connected ||
            busy ||
            !draft.name.trim() ||
            !providerAllowed ||
            !supportsAccess(draft.provider, draft.permission)
          }
          onPress={() => act(save)}
        />
        <Action secondary label="Cancel" disabled={busy} onPress={onClose} />
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
