import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { ScrollView, View, Pressable } from 'react-native'
import { subagentElapsed, subagentMetadata, type Task } from '@dovo/protocol'
import { Text } from '../ui/text'
import { colors, styles } from '../ui/theme'
import { useRuntime } from '../runtime/provider'
export function TaskAgents({ task }: { task: Task }) {
  const { connected } = useRuntime()
  const [now, setNow] = useApplicationState(Date.now)
  const [expanded, setExpanded] = useApplicationState<string | null>(null)
  const agents = task.subagents ?? []
  const live = connected && task.status === 'running'
  const working = live ? agents.filter((agent) => agent.status === 'working').length : 0
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [working])
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
        <Text
          style={[
            styles.muted,
            {
              fontSize: 11,
              marginBottom: 12,
            },
          ]}
        >
          SPAWNED AGENTS
        </Text>
        {!agents.length && (
          <Text style={styles.muted}>
            No subagents yet. Agents spawned by a supported harness appear here as they work.
          </Text>
        )}
        {agents.map((agent) => {
          const key = `${agent.provider}:${agent.id}`
          const active = live && agent.status === 'working'
          const state =
            !live && agent.status === 'working'
              ? 'Last seen working'
              : agent.status === 'unknown'
                ? 'Status unavailable'
                : agent.status
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{
                expanded: expanded === key,
              }}
              onPress={() => setExpanded(expanded === key ? null : key)}
              style={{
                paddingVertical: 12,
                gap: 5,
              }}
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
                  <Text
                    selectable
                    style={[
                      styles.muted,
                      {
                        fontSize: 10,
                      },
                    ]}
                  >
                    {agent.id}
                  </Text>
                </View>
              )}
            </Pressable>
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
        {working} working · {agents.length} total{!connected ? ' · Offline · saved state' : ''}
      </Text>
    </View>
  )
}
