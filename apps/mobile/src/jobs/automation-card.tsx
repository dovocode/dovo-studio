import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { View, Switch, StyleSheet } from 'react-native'
import { Text } from '../ui/text'
import { randomUUID } from 'expo-crypto'
import { Schema } from 'effect'
import { automationIssues, responses, type Automation } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { IconButton } from '../ui/icon-button'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { triggerSummary, linearNodes } from './linear-flow'
import { RunProgress } from './run-progress'
import { automationRuns } from './automation-summary'
import { automationStarts } from './automation-starts'
import { useNavigation } from '../shell/navigation'
export function AutomationCard({ flow, onEdit }: { flow: Automation; onEdit: () => void }) {
  const { snapshot, connected, activeId, callEffect } = useRuntime()
  const { focused } = useNavigation()
  const { busy, error, act } = useAction()
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
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
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
          <Text numberOfLines={2} style={styles.muted}>
            {triggerSummary(flow)} · {steps} {steps === 1 ? 'step' : 'steps'}
          </Text>
        </View>
        <IconButton
          label={`Edit ${flow.name}`}
          icon="settings"
          variant="plain"
          disabled={!focused || busy}
          onPress={onEdit}
        />
      </View>
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
            label={requestId ? 'Retry start' : 'Run automation'}
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
                  ? 'Scheduled'
                  : 'Enabled'
                : 'Paused'}
            </Text>
            <Switch
              accessibilityLabel={`Triggers for ${flow.name}`}
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
                      revision: Schema.Number.pipe(Schema.finite()),
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
          Edit this automation’s canvas on desktop. Runs and reviews are available here.
        </Text>
      )}
      {issues.map((issue) => (
        <Text key={issue} style={styles.error}>
          {issue}
        </Text>
      ))}
      {runs.length > 1 && (
        <Action
          secondary
          label={history ? 'Hide recent runs' : `Recent runs (${runs.length - 1})`}
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
