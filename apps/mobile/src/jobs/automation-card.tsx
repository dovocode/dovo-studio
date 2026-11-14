import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { View } from 'react-native'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { randomUUID } from 'expo-crypto'
import { Schema } from 'effect'
import {
  automationBotJobSummary,
  automationIssues,
  responses,
  type Automation,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsAction as Action } from '../screens/settings-controls'
import { IconButton } from '../ui/controls/icon-button'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { triggerSummary, linearNodes } from './linear-flow'
import { RunProgress } from './run-progress'
import { automationRuns } from './automation-summary'
import { automationStarts } from './automation-starts'
import { useNavigation } from '../shell/navigation'
import { SettingsSheet } from '../screens/settings-theme'
export function AutomationCard({
  flow,
  onEdit,
  onDeleted,
}: {
  flow: Automation
  onEdit: () => void
  onDeleted: () => void
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { snapshot, connected, activeId, callEffect } = useRuntime()
  const botJob = automationBotJobSummary(flow, snapshot?.workspace.tasks ?? [])
  const { focused } = useNavigation()
  const { busy, error, act } = useAction()
  const [deletingOn, setDeletingOn] = useApplicationState<string | null>(null)
  const [history, setHistory] = useApplicationState(false)
  const requestId = activeId ? automationStarts.get(activeId, flow.id) : undefined
  const { history: runs, active, latest } = automationRuns(flow.id, snapshot?.runs ?? [])
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')
  const issues = automationIssues(
    flow,
    snapshot?.workspace ?? {
      agents: [],
      repositories: [],
    },
  )
  const automatic = trigger?.data.trigger !== 'manual'
  const steps = flow.nodes.filter((node) => node.data.kind !== 'trigger').length
  const recoverable = latest?.status === 'failed' || latest?.status === 'cancelled'
  return (
    <View
      testID={`Automation ${flow.id}`}
      style={{
        gap: 8,
        padding: 16,
        borderRadius: 24,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
            gap: 3,
          }}
        >
          {botJob && (
            <Text numberOfLines={2} style={styles.muted}>
              {botJob}
            </Text>
          )}
          <Text numberOfLines={2} style={styles.muted}>
            {triggerSummary(flow)} · {steps} {steps === 1 ? uiText('step') : uiText('steps')}
          </Text>
        </View>
        <IconButton
          label={uiText('Edit {value0}', { value0: flow.name })}
          icon="settings"
          variant="plain"
          disabled={!focused || busy}
          onPress={onEdit}
        />
      </View>
      {!flow.enabled && (
        <Text style={styles.text}>
          <InterfaceText>
            {
              'Test run performs real work. Triggers stay disabled and the next scheduled time stays unchanged.'
            }
          </InterfaceText>
        </Text>
      )}
      {latest ? <RunProgress key={latest.id} run={latest} /> : null}
      <View
        style={[
          styles.row,
          {
            justifyContent: 'space-between',
          },
        ]}
      >
        {(!active || !!requestId) && (
          <Action
            secondary={recoverable}
            label={
              requestId
                ? uiText('Retry start')
                : !flow.enabled
                  ? uiText('Test run')
                  : uiText('Run automation')
            }
            disabled={!focused || !connected || !activeId || busy || issues.length > 0}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  if (!focused || !activeId) return
                  const requestId = automationStarts.begin(activeId, flow.id, randomUUID)
                  yield* callEffect(
                    '/api/jobs/run',
                    {
                      id: flow.id,
                      requestId,
                    },
                    responses.job,
                  )
                  automationStarts.complete(activeId, flow.id, requestId)
                }),
              )
            }
          />
        )}
        {automatic && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              minHeight: 44,
            }}
          >
            <Text style={styles.muted}>
              {flow.enabled
                ? trigger?.data.trigger === 'schedule'
                  ? uiText('Scheduled')
                  : uiText('Enabled')
                : uiText('Paused')}
            </Text>
            <Switch
              accessibilityLabel={uiText('Triggers for {value0}', { value0: flow.name })}
              value={!!flow.enabled}
              disabled={!focused || !connected || busy || (!flow.enabled && issues.length > 0)}
              onValueChange={(enabled) =>
                act(() =>
                  callEffect(
                    '/api/workspace',
                    {
                      collection: 'automations',
                      id: flow.id,
                      changes: {
                        enabled: {
                          before: flow.enabled ?? null,
                          after: enabled,
                        },
                      },
                    },
                    mutableStruct({
                      revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
                    }),
                    'PATCH',
                  ),
                )
              }
            />
          </View>
        )}
      </View>
      {!linearNodes(flow) && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Edit this automation’s canvas on desktop. Runs and reviews are available here.'}
          </InterfaceText>
        </Text>
      )}
      {issues.map((issue) => (
        <Text key={issue} style={styles.error}>
          {issue}
        </Text>
      ))}
      <Action
        destructive
        secondary
        label={uiText('Delete automation')}
        disabled={!focused || !connected || !activeId || busy || !!active}
        onPress={() => setDeletingOn(activeId)}
      />
      {deletingOn && (
        <SettingsSheet
          title={uiText('Delete “{value0}”?', { value0: flow.name })}
          presentation="dialog"
          onClose={() => {
            if (!busy) setDeletingOn(null)
          }}
        >
          <View style={{ gap: 12 }}>
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'This removes the automation and its triggers. Existing threads and run history are kept.'
                }
              </InterfaceText>
            </Text>
            {error && <Text style={styles.error}>{error}</Text>}
            <Action
              destructive
              label={uiText('Delete automation')}
              wide
              disabled={!focused || !connected || busy || !!active || deletingOn !== activeId}
              onPress={() =>
                act(() =>
                  mobileWorkflow(function* () {
                    if (!focused || deletingOn !== activeId) return
                    yield* callEffect('/api/jobs/delete', { id: flow.id }, responses.ok)
                    setDeletingOn(null)
                    onDeleted()
                  }),
                )
              }
            />
            <Action
              label={uiText('Cancel')}
              secondary
              disabled={busy}
              onPress={() => setDeletingOn(null)}
            />
          </View>
        </SettingsSheet>
      )}
      {runs.length > 1 && (
        <Action
          secondary
          label={
            history
              ? uiText('Hide recent runs')
              : uiText('Recent runs ({value0})', { value0: runs.length - 1 })
          }
          disabled={!focused}
          onPress={() => setHistory(!history)}
        />
      )}
      {history &&
        runs
          .filter((run) => run.id !== latest?.id)
          .slice(0, 9)
          .map((run) => (
            <View
              key={run.id}
              style={{
                borderTopWidth: 0.5,
                borderColor: colors.border,
                paddingTop: 4,
              }}
            >
              <RunProgress run={run} anotherActive={!!active} />
            </View>
          ))}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
