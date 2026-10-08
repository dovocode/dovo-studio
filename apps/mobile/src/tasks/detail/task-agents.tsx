import { useNavigation } from '../../shell/navigation'
import { Action } from '../../ui/controls/action'
import { useForegroundInterval } from '../../runtime/state/app-active'
import { useApplicationState } from '../../runtime/state/application-state'
import { ScrollView, View, Pressable } from 'react-native'
import {
  subagentElapsed,
  subagentMetadata,
  indexTaskSubagents,
  taskFamilyRunToken,
  responses,
  type Task,
} from '@dovo/protocol'
import { useMemo } from 'react'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useRuntime } from '../../runtime/connection/provider'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../../runtime/preferences/app-preferences'
import { useAction } from '../../ui/controls/use-action'
import { Switch } from '../../ui/controls/switch'
export function TaskAgents({ task }: { task: Task }) {
  const { colors, styles } = useTheme()

  const { connected, profile, snapshot, callEffect } = useRuntime()
  const { hideFinishedSubagents } = useMobilePreferences()
  const { navigate } = useNavigation()
  const [now, setNow] = useApplicationState(Date.now)
  const [expanded, setExpanded] = useApplicationState<string | null>(null)
  const indexed = useMemo(
    () => indexTaskSubagents(snapshot?.workspace.tasks ?? []),
    [snapshot?.workspace.tasks],
  )
  const cancellation = useAction()
  const agents = indexed(task)
  const visibleAgents = agents.filter(
    (agent) =>
      !hideFinishedSubagents ||
      (!agent.finishedAt && (agent.status === 'working' || agent.status === 'unknown')),
  )
  const hidden = agents.length - visibleAgents.length
  const activeAgents = new Set(connected ? indexed(task, true) : [])
  const live = connected
  const working = activeAgents.size
  useForegroundInterval(() => setNow(Date.now()), working ? 1000 : null)
  return (
    <View
      style={{
        flex: 1,
      }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 4,
        }}
      >
        {task.delegation && (
          <Action
            secondary
            label="Back to parent thread"
            onPress={() => navigate('tasks', task.delegation?.parentTaskId, profile?.id)}
          />
        )}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Text style={[styles.muted, { fontSize: 11 }]}>SPAWNED AGENTS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.muted, { fontSize: 12 }]}>Hide finished</Text>
            <Switch
              accessibilityLabel="Hide finished"
              value={hideFinishedSubagents}
              onValueChange={(hideFinishedSubagents) =>
                updateMobilePreferences({ hideFinishedSubagents })
              }
            />
          </View>
        </View>
        {[...activeAgents].some((agent) => agent.source === 'dovo') && (
          <Action
            secondary
            label={cancellation.busy ? 'Stopping…' : 'Stop agents'}
            disabled={cancellation.busy}
            onPress={() =>
              cancellation.act(() =>
                callEffect(
                  '/api/tasks/stop-agents',
                  {
                    id: task.id,
                    runToken: taskFamilyRunToken(snapshot?.workspace.tasks ?? [], task.id),
                  },
                  responses.ok,
                ),
              )
            }
          />
        )}
        {!!cancellation.error && <Text style={{ color: colors.error }}>{cancellation.error}</Text>}
        {!agents.length && (
          <Text style={styles.muted}>
            No subagents yet. Agents spawned by a supported harness appear here as they work.
          </Text>
        )}
        {!!agents.length && !visibleAgents.length && (
          <Text style={styles.muted}>
            All subagents have finished. Turn off Hide finished to view them.
          </Text>
        )}
        {visibleAgents.map((agent, index) => {
          const key = `${agent.provider}:${agent.id}:${index}`
          const active = live && activeAgents.has(agent)
          const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
          const child = childId
            ? snapshot?.workspace.tasks.find((item) => item.id === childId)
            : undefined
          const state =
            !active && agent.status === 'working'
              ? 'Last seen working'
              : agent.status === 'unknown'
                ? 'Status unavailable'
                : agent.status
          return (
            <View key={key} style={{ paddingVertical: 12, gap: 5 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: expanded === key }}
                onPress={() => setExpanded(expanded === key ? null : key)}
                style={{ gap: 5 }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: active
                        ? colors.accent
                        : agent.status === 'failed'
                          ? colors.error
                          : colors.muted,
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: 14,
                      fontWeight: '600',
                    }}
                  >
                    {agent.name}
                  </Text>
                  <Text
                    style={[
                      styles.muted,
                      {
                        fontSize: 11,
                      },
                    ]}
                  >
                    {subagentElapsed(
                      active
                        ? agent
                        : {
                            ...agent,
                            status: agent.status === 'working' ? 'unknown' : agent.status,
                          },
                      now,
                    )}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.muted,
                    {
                      marginLeft: 14,
                    },
                  ]}
                >
                  {active ? agent.activity || 'Working' : state}
                </Text>
                <Text
                  style={[
                    styles.muted,
                    {
                      marginLeft: 14,
                      fontSize: 11,
                    },
                  ]}
                >
                  {subagentMetadata(agent) || agent.provider}
                </Text>
              </Pressable>
              {expanded === key && (
                <View
                  style={{
                    gap: 8,
                    paddingLeft: 14,
                    paddingTop: 8,
                  }}
                >
                  {!!agent.prompt && (
                    <Text selectable style={styles.muted}>
                      {agent.prompt}
                    </Text>
                  )}
                  {!!agent.activity && (
                    <Text selectable style={styles.muted}>
                      {agent.activity}
                    </Text>
                  )}
                  {childId && (
                    <Action
                      secondary
                      label={`Open child thread · ${agent.provider}`}
                      onPress={() => navigate('tasks', childId, profile?.id)}
                    />
                  )}
                  {active && child?.activeRunId && (
                    <Action
                      secondary
                      label="Stop child"
                      disabled={cancellation.busy}
                      onPress={() =>
                        cancellation.act(() =>
                          callEffect(
                            '/api/tasks/cancel',
                            {
                              id: child.id,
                              runId: child.activeRunId,
                            },
                            responses.ok,
                          ),
                        )
                      }
                    />
                  )}
                  <Text
                    selectable
                    style={[
                      styles.muted,
                      {
                        fontSize: 10,
                      },
                    ]}
                  >
                    {agent.source === 'dovo' ? 'Dovo child agent' : agent.id}
                  </Text>
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
      <Text
        style={[
          styles.muted,
          {
            padding: 16,
            borderTopWidth: 0.5,
            borderTopColor: colors.border,
          },
        ]}
      >
        {working} working · {agents.length} total{hidden > 0 ? ` · ${hidden} hidden` : ''}
        {!connected ? ' · Offline · saved state' : ''}
      </Text>
    </View>
  )
}
