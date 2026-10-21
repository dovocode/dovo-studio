import { memo, useState } from 'react'
import { View } from 'react-native'
import { Pressable } from './thread-pressable'
import {
  threadTreeSummary,
  visibleThreadChildren,
  nativeOverflowFailures,
  threadNeedsInput,
  threadPhaseLabels,
  type NestedThread,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/context'
import { openNestedThread } from './open-nested-thread'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

/** Reuse the saved relationship when navigating, including when the peer is offline. */
export const NestedThreads = memo(function NestedThreads({
  thread,
  disabled = false,
  searching = false,
  acknowledgedFailures = [],
  onAcknowledgeFailure,
  hideSummary = false,
}: {
  thread: NestedThread
  disabled?: boolean
  searching?: boolean
  acknowledgedFailures?: readonly string[]
  onAcknowledgeFailure?: (key: string) => void
  hideSummary?: boolean
}) {
  const { colors, styles } = useTheme()
  const { profiles, overviews } = useRuntime()
  const [expanded, setExpanded] = useState(true)
  const [finishedExpanded, setFinishedExpanded] = useState(false)
  const navigate = (child: NestedThread) => openNestedThread(child, thread, profiles, overviews)
  const summary = threadTreeSummary(thread.children, acknowledgedFailures)
  if (!summary.total) return null
  const activeKeys = new Set(
    visibleThreadChildren(thread.children, true, acknowledgedFailures).map((child) => child.key),
  )
  const activeThreads = thread.children.filter((child) => activeKeys.has(child.key))
  const finishedThreads = thread.children.filter((child) => !activeKeys.has(child.key))
  const finishedOpen = searching || finishedExpanded
  const open = hideSummary || searching || expanded
  const parts = [
    `${summary.total} spawned ${summary.total === 1 ? 'thread' : 'threads'}`,
    summary.running ? `${summary.running} running` : '',
    summary.attention ? `${summary.attention} needs input` : '',
    summary.waiting ? `${summary.waiting} waiting` : '',
    summary.failed ? `${summary.failed} failed` : '',
    summary.offline ? `${summary.offline} offline` : '',
  ].filter(Boolean)
  const renderChild = (child: NestedThread) => (
    <View key={child.key}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open child thread ${child.title}`}
        disabled={disabled}
        style={{ paddingVertical: 10, gap: 4 }}
        onPress={() => {
          navigate(child)
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontWeight: '600',
            fontSize: 13,
            color: child.phase === 'failed' ? colors.error : colors.text,
          }}
        >
          {child.title}
        </Text>
        <Text numberOfLines={2} style={[styles.muted, { fontSize: 11 }]}>
          {[
            child.computerName,
            child.projectName,
            threadPhaseLabels[child.phase],
            !child.online ? 'Offline · saved state' : child.paused ? 'Monitor stopped' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {threadNeedsInput(child) && child.phase !== 'needs-input' && (
          <Text style={[styles.muted, { fontSize: 11 }]}>Needs input in child work</Text>
        )}
        {child.partial && (
          <Text style={[styles.muted, { fontSize: 11 }]}>Some child details unavailable</Text>
        )}
        {!!child.activity && (
          <Text numberOfLines={1} style={[styles.muted, { fontSize: 11 }]}>
            {child.activity}
          </Text>
        )}
      </Pressable>
      {child.phase === 'failed' &&
        child.failureKey &&
        onAcknowledgeFailure &&
        !acknowledgedFailures.includes(child.failureKey) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Acknowledge failure"
            disabled={disabled}
            style={{ paddingVertical: 12 }}
            onPress={() => onAcknowledgeFailure(child.failureKey!)}
          >
            <Text style={[styles.muted, { fontSize: 12 }]}>Acknowledge failure</Text>
          </Pressable>
        )}
      {!!child.nativeAgents?.length && (
        <View
          accessibilityLabel={`Native agents in ${child.title}`}
          style={{ paddingLeft: 12, gap: 4 }}
        >
          {child.nativeAgents.map((agent) => (
            <View key={agent.key}>
              <Text
                style={[
                  styles.muted,
                  { fontSize: 12 },
                  agent.status === 'failed' && !acknowledgedFailures.includes(agent.key)
                    ? { color: colors.error }
                    : {},
                ]}
              >
                {agent.name} ·{' '}
                {agent.status === 'unknown'
                  ? 'Status unavailable'
                  : agent.status === 'working'
                    ? child.online && !child.paused && agent.working
                      ? 'Running'
                      : 'Last seen working'
                    : agent.status === 'failed'
                      ? 'Failed'
                      : agent.status === 'completed'
                        ? 'Done'
                        : 'Stopped'}
              </Text>
              {agent.status === 'failed' &&
                !acknowledgedFailures.includes(agent.key) &&
                onAcknowledgeFailure && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Acknowledge failure in ${agent.name}`}
                    disabled={disabled}
                    style={{ paddingVertical: 12 }}
                    onPress={() => onAcknowledgeFailure(agent.key)}
                  >
                    <Text style={[styles.muted, { fontSize: 12 }]}>
                      Acknowledge failure in {agent.name}
                    </Text>
                  </Pressable>
                )}
            </View>
          ))}
        </View>
      )}
      {!!child.nativeAgentOverflow?.total && (
        <View style={{ paddingLeft: 12, gap: 4 }}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => navigate(child)}
            style={{ paddingVertical: 12 }}
          >
            <Text style={[styles.muted, { fontSize: 12 }]}>
              Open {child.nativeAgentOverflow.total} additional agents in {child.title}
            </Text>
          </Pressable>
          {!!child.nativeAgentOverflow.working && (
            <Text style={styles.muted}>{child.nativeAgentOverflow.working} working</Text>
          )}
          {nativeOverflowFailures(child, acknowledgedFailures) > 0 && (
            <Text style={{ color: colors.error }}>
              {nativeOverflowFailures(child, acknowledgedFailures)} additional failures
            </Text>
          )}
          {child.nativeAgentOverflow.failureKey &&
            nativeOverflowFailures(child, acknowledgedFailures) > 0 &&
            onAcknowledgeFailure && (
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={{ paddingVertical: 12 }}
                onPress={() => onAcknowledgeFailure(child.nativeAgentOverflow!.failureKey!)}
              >
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  Acknowledge {child.nativeAgentOverflow.failed} additional failures in{' '}
                  {child.title}
                </Text>
              </Pressable>
            )}
        </View>
      )}
      <NestedThreads
        thread={child}
        disabled={disabled}
        searching={searching}
        acknowledgedFailures={acknowledgedFailures}
        onAcknowledgeFailure={onAcknowledgeFailure}
      />
    </View>
  )
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
      {!hideSummary && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Spawned threads for ${thread.title}`}
          accessibilityState={{ expanded: open }}
          aria-expanded={open}
          disabled={searching}
          onPress={() => setExpanded(!open)}
          style={{ paddingVertical: 10 }}
        >
          <Text style={[styles.muted, { fontSize: 12 }]}>
            {open ? '⌄' : '›'} {parts.join(' · ')}
          </Text>
        </Pressable>
      )}
      {open && (
        <View style={{ borderLeftWidth: 1, borderColor: colors.border, paddingLeft: 10 }}>
          {activeThreads.map(renderChild)}
          {!!finishedThreads.length && (
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Finished threads for ${thread.title}`}
                accessibilityState={{ expanded: finishedOpen }}
                aria-expanded={finishedOpen}
                disabled={searching}
                onPress={() => setFinishedExpanded(!finishedOpen)}
                style={{ paddingVertical: 12, minHeight: 44 }}
              >
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {finishedOpen ? '⌄' : '›'} Finished threads · {finishedThreads.length}
                </Text>
              </Pressable>
              {finishedOpen && (
                <View style={{ paddingLeft: 10 }}>{finishedThreads.map(renderChild)}</View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  )
})
