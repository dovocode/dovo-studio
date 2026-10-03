import { changeAgentProvider, changeAgentConnection, agentConnectionValue } from '@dovo/protocol'
import { randomUUID } from 'expo-crypto'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { agentPresetSchema } from '@dovo/protocol'
import { Effect } from 'effect'
import { parseAgentEnvironment, formatAgentEnvironment } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import {
  selectableAccessModes,
  supportsAccess,
  canChangeTaskProvider,
  lockedTaskProvider,
} from '@dovo/protocol'
import { ModelSettings } from './model-settings'
import { AcpRegistry } from './acp-registry'
import { View } from 'react-native'
import { Sheet } from '../ui/layout/sheet'
import { Text } from '../ui/content/text'
import { Schema } from 'effect'
import { agentSchema, providerSchema, type Agent } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
export function AgentEditor({
  original,
  creating,
  onClose,
  global = false,
}: {
  original: Agent
  creating: boolean
  onClose: () => void
  global?: boolean
}) {
  const { connected, profile, snapshot, callEffect } = useRuntime(),
    { busy, error, act } = useAction(),
    [draft, setDraft] = useApplicationState(original)
  const [environment, setEnvironment] = useApplicationState(formatAgentEnvironment(original.env))
  const { globalAgentPresets } = useMobilePreferences()
  const [scope, setScope] = useApplicationState(global ? 'global' : 'server')
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
            env: parseAgentEnvironment(environment),
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
        if (scope === 'global') {
          if (valid.acpInstallationId)
            return yield* Effect.fail(
              new Error('Installed ACP agents belong to their server. Use a server configuration.'),
            )
          const preset = decode(agentPresetSchema, valid)
          if (original.globalPreset && !globalAgentPresets.some((item) => item.id === original.id))
            preset.id = randomUUID()
          updateMobilePreferences({
            globalAgentPresets: [
              ...globalAgentPresets.filter((agent) => agent.id !== preset.id),
              preset,
            ],
          })
          onClose()
          return
        }
        if (original.globalPreset) after.serverOverride = true
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
            ...(creating || !snapshot?.workspace.agents.some((agent) => agent.id === valid.id)
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
      <Choice
        label="Configuration scope"
        value={scope}
        onChange={setScope}
        items={[
          { id: 'server', name: `This server · ${profile?.name ?? 'Computer'}` },
          { id: 'global', name: 'Global · Servers connected to this app' },
        ]}
      />
      <Text style={styles.muted}>
        Global presets apply on reconnect. Server overrides keep their own settings.
      </Text>
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
          setDraft(changeAgentProvider(draft, decode(providerSchema, value)))
        }}
      />
      {providerLocked && (
        <Text style={styles.muted}>
          This agent is used by an existing thread. Its provider is fixed; models and settings can
          still change.
        </Text>
      )}
      {draft.provider === 'acp' && (
        <AcpRegistry agent={draft} onChange={setDraft} showRegistry={false} />
      )}
      <ModelSettings
        key={draft.provider}
        agent={draft}
        onChange={setDraft}
        disabled={busy || !providerAllowed}
      />
      <Field
        label={
          draft.provider === 'opencode'
            ? 'Server URL · blank starts OpenCode automatically'
            : 'Executable path · blank uses default'
        }
        value={agentConnectionValue(draft)}
        editable={!busy}
        onChangeText={(endpoint) => setDraft(changeAgentConnection(draft, endpoint))}
      />
      {draft.provider === 'opencode' && !draft.endpoint.trim() && (
        <Field
          label="OpenCode executable path · optional"
          value={draft.executablePath ?? ''}
          editable={!busy}
          onChangeText={(executablePath) => setDraft({ ...draft, executablePath })}
        />
      )}
      {(draft.provider === 'codex' || draft.provider === 'claude') && (
        <Field
          label={
            draft.provider === 'codex' ? 'CODEX_HOME directory' : 'CLAUDE_CONFIG_DIR directory'
          }
          value={draft.configDirectory ?? ''}
          onChangeText={(configDirectory) => setDraft({ ...draft, configDirectory })}
          editable={!busy}
        />
      )}
      {(draft.provider !== 'opencode' || !draft.endpoint.trim()) && (
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
      <>
        <Field
          label="Environment variables · NAME=value per line"
          value={environment}
          onChangeText={setEnvironment}
          editable={!busy}
          multiline
        />
        <Text style={styles.muted}>
          Saved as readable configuration. Keep secrets in the server's environment. Claude flags
          use --name or --name=value.
        </Text>
      </>
      <Choice
        label="Access"
        disabled={busy}
        value={draft.permission}
        items={selectableAccessModes(draft.permission)
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
      {original.globalPreset && (
        <Action
          secondary
          label="Use global preset on this server"
          disabled={!connected || busy}
          onPress={() =>
            act(() =>
              runClientEffect(
                callEffect(
                  '/api/agents/presets/reset',
                  { id: original.id },
                  mutableStruct({ ok: Schema.Boolean }),
                ).pipe(Effect.tap(() => Effect.sync(onClose))),
              ),
            )
          }
        />
      )}
      <View style={styles.row}>
        <Action
          label="Save agent"
          disabled={
            (scope === 'server' && !connected) ||
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
