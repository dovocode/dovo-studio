import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { automationHref } from '../shell/source-route'
import {
  routineChangeForRun,
  routineAutomaticPause,
  routineFieldChangeText,
  routineProvenanceSchema,
  type RoutineChange,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import { useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { SettingsAction as Action } from '../screens/settings-controls'
import { requestMessageReveal } from '../tasks/conversation/message-reveal'
import { Text } from '../ui/content/text'
import { formatDateTime } from '../ui/content/format-date'
import { useTheme } from '../ui/theme'

type ProvenanceState = { supported: boolean; changes?: RoutineChange[]; error: string }

/** Loads one routine's recorded changes and reloads after the computer saves a change. */
function useRoutineProvenance(automationId: string): ProvenanceState {
  const { callEffect, connected, snapshot, profile } = useRuntime()
  const supported = snapshot?.routineProvenanceSupported === true
  const saved = snapshot?.workspace.automations.find((item) => item.id === automationId)
  const revision = saved ? JSON.stringify(saved) : ''
  const [changes, setChanges] = useState<RoutineChange[]>()
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const version = ++generation.current
    setChanges(undefined)
    setError('')
    if (!supported || !connected) return
    runClientEffect(
      callEffect('/api/jobs/provenance', { id: automationId }, routineProvenanceSchema),
    )
      .then((result) => {
        if (version === generation.current) setChanges(result.changes)
      })
      .catch((cause: unknown) => {
        if (version === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      })
  }, [automationId, revision, supported, connected, profile?.id])
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  return { supported, changes, error }
}

/** The owner's words with a link to their message while it still exists. */
function RoutineSource({ change }: { change: RoutineChange | undefined }) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { profile, connected } = useRuntime()
  const { navigate, focused } = useNavigation()
  if (!change) return <Text style={styles.muted}>{uiText('Source not recorded')}</Text>
  const source = change.source
  // "Because you said" is only for a quote that the agent cited and the runtime verified.
  const quote = source.kind === 'owner' ? `${source.quote}${source.truncated ? '…' : ''}` : ''
  return (
    <View style={{ gap: 4 }}>
      <Text selectable style={styles.text}>
        {source.kind === 'owner'
          ? source.cited
            ? uiText('Because you said: "{value0}"', { value0: quote })
            : uiText('During your request: "{value0}"', { value0: quote })
          : source.kind === 'person'
            ? source.deviceName
              ? uiText('Changed by you in the editor on {value0}', { value0: source.deviceName })
              : uiText('Changed by you in the editor')
            : uiText('Changed by an agent without an owner message')}
      </Text>
      {source.kind === 'agent' &&
        source.runId &&
        (source.runAvailable ? (
          <Action
            label={uiText('Open responsible run')}
            secondary
            disabled={!focused || !connected || !profile}
            onPress={() => {
              if (profile)
                router.push(automationHref(profile.id, change.automationId, source.runId))
            }}
          />
        ) : (
          <Text style={styles.muted}>{uiText('Responsible run unavailable')}</Text>
        ))}
      {source.kind === 'owner' &&
        (source.linkAvailable ? (
          <Action
            label={uiText('Open source message')}
            secondary
            disabled={!focused || !connected || !profile}
            onPress={() => {
              if (!profile) return
              requestMessageReveal(profile.connection, source.taskId, source.messageId)
              navigate('tasks', source.taskId, profile.id)
            }}
          />
        ) : (
          <Text style={styles.muted}>{uiText('Source message unavailable')}</Text>
        ))}
    </View>
  )
}

/** The change in effect when this run started. */
export function RunRoutineSource({
  automationId,
  runCreatedAt,
}: {
  automationId: string
  runCreatedAt: string
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const state = useRoutineProvenance(automationId)
  if (!state.supported) return null
  return (
    <View testID="Run source" style={{ gap: 4 }}>
      <Text style={{ fontWeight: '600' }}>{uiText('Why this run happened')}</Text>
      {state.error ? (
        <Text style={styles.error}>{state.error}</Text>
      ) : state.changes ? (
        <RoutineSource change={routineChangeForRun(state.changes, runCreatedAt)} />
      ) : null}
    </View>
  )
}

/** The latest source, with every recorded change on request. */
export function RoutineHistory({ automationId }: { automationId: string }) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const { focused } = useNavigation()
  const state = useRoutineProvenance(automationId)
  const { snapshot } = useRuntime()
  const flow = snapshot?.workspace.automations.find((flow) => flow.id === automationId)
  const paused =
    flow &&
    snapshot?.routineRunProvenanceSupported &&
    routineAutomaticPause(flow, state.changes ?? [])
  const [open, setOpen] = useState(false)
  if (!state.supported) return null
  const changes = state.changes ?? []
  return (
    <View testID="Routine change history" style={{ gap: 6 }}>
      {!!paused && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: '600' }}>{uiText('Paused by an automation run')}</Text>
          <RoutineSource change={paused} />
        </View>
      )}
      <Text style={{ fontWeight: '600' }}>{uiText('Change history')}</Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {state.changes && !open && <RoutineSource change={changes[0]} />}
      {changes.length > 0 && (
        <Action
          secondary
          label={
            open
              ? uiText('Hide change history')
              : uiText('Show change history ({value0})', { value0: changes.length })
          }
          disabled={!focused}
          onPress={() => setOpen(!open)}
        />
      )}
      {open &&
        changes.map((change) => (
          <View
            key={change.id}
            style={{ gap: 4, borderTopWidth: 0.5, borderColor: colors.border, paddingTop: 6 }}
          >
            <Text style={styles.muted}>
              {change.action === 'created'
                ? uiText('Created on {value0}', { value0: formatDateTime(change.at) })
                : uiText('Changed on {value0}', { value0: formatDateTime(change.at) })}
            </Text>
            <RoutineSource change={change} />
            {change.changes.map((field, index) => (
              <Text key={index} style={styles.muted}>
                {routineFieldChangeText(field)}
              </Text>
            ))}
          </View>
        ))}
    </View>
  )
}
