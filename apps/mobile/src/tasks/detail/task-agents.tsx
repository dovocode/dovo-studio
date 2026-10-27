import {
  buildThreadTree,
  nativeFailureKey,
  threadFailureKey,
  taskFailureVersion,
  subagentVisible,
  taskFamilyIds,
  threadDescendants,
  unlistedThreadBranches,
  visibleThreadChildren,
} from '@dovo/protocol'
import { NestedThreads } from '../list/nested-threads'
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
  type Subagent,
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
export function TaskAgents({
  task,
  onOpenThread,
}: {
  task: Task
  onOpenThread: (thread: { taskId: string; agent: Subagent }) => void
}) {
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
  const tree = useMemo(
    () =>
      buildThreadTree(
        (snapshot?.workspace.tasks ?? []).map((item) => {
          const repository = (snapshot?.workspace.repositories ?? []).find(
            (repository) => repository.id === item.repositoryId,
          )
          return {
            key: JSON.stringify([profile?.id ?? null, item.id]),
            task: item,
            needsInput: false,
            projectName:
              repository?.kind === 'scratch' ? 'General' : (repository?.name ?? 'No project'),
            source: {
              runtimeId: profile?.id ?? null,
              name: profile?.name ?? 'This computer',
              online: connected,
              snapshot,
            },
          }
        }),
      ),
    [snapshot, profile, connected],
  )
  const thread = tree.nodes.get(JSON.stringify([profile?.id ?? null, task.id]))
  const agents = indexed(task)
  const listed = new Set(
    [
      task.id,
      ...agents.filter((agent) => agent.source === 'dovo').map((agent) => agent.taskId ?? agent.id),
    ].map((id) => JSON.stringify([profile?.id ?? null, id])),
  )
  const branches = thread ? unlistedThreadBranches(thread, listed) : []
  const remote = branches.flatMap((branch) => threadDescendants(branch.children))
  const visibleBranches = branches.map((branch) => ({
    ...branch,
    children: visibleThreadChildren(
      branch.children,
      hideFinishedSubagents,
      task.acknowledgedSubagentFailures,
    ),
  }))
  const visibleRemote = visibleBranches.flatMap((branch) => threadDescendants(branch.children))
  const ownerFor = (agent: Subagent) =>
    (snapshot?.workspace.tasks ?? []).find((item) => item.subagents?.includes(agent))
  const failureKey = (agent: Subagent) => {
    const child =
      agent.source === 'dovo'
        ? (snapshot?.workspace.tasks ?? []).find((item) => item.id === (agent.taskId ?? agent.id))
        : undefined
    return child
      ? threadFailureKey(
          snapshot?.runtimeId ?? profile?.id ?? null,
          child.id,
          taskFailureVersion(child),
        )
      : nativeFailureKey(ownerFor(agent)?.id ?? task.id, agent)
  }
  const visibleAgents = agents.filter((agent) =>
    subagentVisible(
      agent,
      hideFinishedSubagents,
      task.acknowledgedSubagentFailures?.includes(failureKey(agent)),
    ),
  )
  const hidden = agents.length - visibleAgents.length + remote.length - visibleRemote.length
  const activeAgents = new Set(connected ? indexed(task, true) : [])
  const family = taskFamilyIds(snapshot?.workspace.tasks ?? [], task.id)
  const canStopRemote =
    connected &&
    (snapshot?.workspace.tasks ?? []).some(
      (item) =>
        family.has(item.id) &&
        item.threadWatches?.some(
          (watch) =>
            watch.delegated && !watch.stopRequested && watch.snapshot?.phase !== 'completed',
        ),
    )
  const acknowledgeFailure = (key: string) =>
    cancellation.act(() =>
      callEffect('/api/tasks/acknowledge-subagent-failure', { id: task.id, key }, responses.ok),
    )
  const live = connected
  const working =
    activeAgents.size +
    remote.filter((child) => child.online && !child.paused && child.phase === 'running').length
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
        {(activeAgents.size > 0 || canStopRemote) && (
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
        {!agents.length && !remote.length && (
          <Text style={styles.muted}>
            No subagents yet. Agents spawned by a supported harness appear here as they work.
          </Text>
        )}
        {(!!agents.length || !!remote.length) && !visibleAgents.length && !visibleRemote.length && (
          <Text style={styles.muted}>
            All subagents have finished. Turn off Hide finished to view them.
          </Text>
        )}
        {visibleBranches.map((branch) => (
          <NestedThreads
            key={branch.key}
            thread={branch}
            disabled={cancellation.busy}
            acknowledgedFailures={task.acknowledgedSubagentFailures}
            onAcknowledgeFailure={acknowledgeFailure}
          />
        ))}
        {visibleAgents.map((agent, index) => {
          const key = `${agent.provider}:${agent.id}:${index}`
          const active = live && activeAgents.has(agent)
          const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
          const child = childId
            ? snapshot?.workspace.tasks.find((item) => item.id === childId)
            : undefined
          const owner = snapshot?.workspace.tasks.find((item) => item.subagents?.includes(agent))
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
                  {agent.status === 'failed' &&
                    !task.acknowledgedSubagentFailures?.includes(failureKey(agent)) && (
                      <Action
                        secondary
                        label="Acknowledge failure"
                        disabled={cancellation.busy}
                        onPress={() => acknowledgeFailure(failureKey(agent))}
                      />
                    )}
                  {!!agent.prompt && (
                    <Text selectable style={styles.muted}>
                      {agent.prompt}
                    </Text>
                  )}
                  {!!agent.result && (
                    <Text selectable style={styles.muted}>
                      {agent.result}
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
                  {agent.source !== 'dovo' && owner && (
                    <Action
                      secondary
                      label={`View native thread · ${agent.provider}`}
                      onPress={() => onOpenThread({ taskId: owner.id, agent })}
                    />
                  )}
                  {active &&
                    agent.source !== 'dovo' &&
                    agent.canStopIndividual !== false &&
                    owner && (
                      <Action
                        secondary
                        label="Stop child"
                        disabled={cancellation.busy}
                        onPress={() =>
                          cancellation.act(() =>
                            callEffect(
                              '/api/tasks/stop-agents',
                              {
                                id: owner.id,
                                childId: agent.id,
                                runToken: taskFamilyRunToken(
                                  snapshot?.workspace.tasks ?? [],
                                  owner.id,
                                ),
                              },
                              responses.ok,
                            ),
                          )
                        }
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
        {working} working · {agents.length + remote.length} total
        {hidden > 0 ? ` · ${hidden} hidden` : ''}
        {!connected ? ' · Offline · saved state' : ''}
      </Text>
    </View>
  )
}
