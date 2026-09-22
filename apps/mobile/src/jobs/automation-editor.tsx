import { useRef, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { randomUUID } from 'expo-crypto'
import {
  automationIssues,
  type Automation,
  type AutomationData,
  type AutomationNode,
} from '@dovo/protocol'
import { z } from 'zod'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Field } from '../ui/field'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { linearNodes, newAutomationNode, withLinearNodes, scheduleChoices } from './linear-flow'
import { StepFields } from './step-fields'
import { useNavigation } from '../shell/navigation'

export function AutomationEditor({ flow, onClose }: { flow?: Automation; onClose: () => void }) {
  const { snapshot, call, connected } = useRuntime()
  const { focused } = useNavigation()
  const focus = useRef(focused)
  focus.current = focused
  const { busy, error, act } = useAction()
  const [baseline] = useState(flow)
  const workspace = snapshot?.workspace ?? { agents: [], repositories: [] }
  const [draft, setDraft] = useState<Automation>(() => {
    if (flow) return flow
    const defaults = {
      repositoryId: workspace.repositories[0]?.id ?? '',
      agentId: workspace.agents[0]?.id ?? '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    return withLinearNodes({ id: randomUUID(), name: '', nodes: [], edges: [], enabled: false }, [
      newAutomationNode(randomUUID(), 'trigger', defaults),
      newAutomationNode(randomUUID(), 'task', defaults),
    ])
  })
  const ordered = linearNodes(draft)
  const trigger = ordered?.[0]
  const [expanded, setExpanded] = useState(() => ordered?.[1]?.id ?? '')
  const [attempted, setAttempted] = useState(false)
  const [customSchedule, setCustomSchedule] = useState(
    () => !scheduleChoices.some((item) => item.id === trigger?.data.schedule),
  )
  const issues = automationIssues(draft, workspace)
  const updateNodes = (nodes: AutomationNode[]) =>
    setDraft((value) => withLinearNodes(value, nodes))
  const updateNode = (id: string, patch: Partial<AutomationData>) => {
    if (ordered)
      updateNodes(
        ordered.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      )
  }
  const move = (index: number, offset: number) => {
    if (!ordered || index + offset < 1 || index + offset >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    updateNodes(next)
  }
  const add = (kind: 'task' | 'review') => {
    if (!ordered) return
    const node = newAutomationNode(randomUUID(), kind, {
      repositoryId: workspace.repositories[0]?.id ?? '',
      agentId: workspace.agents[0]?.id ?? '',
      timezone: trigger?.data.timezone || 'UTC',
    })
    updateNodes([...ordered, node])
    setExpanded(node.id)
  }
  // Native stacks retain screens. Hide their presenter without discarding the editor's draft.
  if (!focused) return null
  return (
    <Sheet
      title={baseline ? 'Edit automation' : 'New automation'}
      busy={busy}
      onClose={() => {
        if (focus.current) onClose()
      }}
    >
      {!ordered || !trigger ? (
        <Text style={styles.muted}>
          This automation has canvas connections that cannot be edited here. Use the desktop canvas
          to preserve its branches and dependencies.
        </Text>
      ) : (
        <>
          <Field
            label="Automation name"
            value={draft.name}
            editable={!busy}
            onChangeText={(name) => setDraft((value) => ({ ...value, name }))}
            placeholder="Morning repository review"
          />
          <Choice
            label="Trigger"
            value={trigger.data.trigger}
            items={[
              { id: 'manual', name: 'Manual' },
              { id: 'schedule', name: 'Schedule' },
              { id: 'webhook', name: 'Webhook' },
            ]}
            disabled={busy}
            onChange={(value) => {
              if (value === 'manual' || value === 'schedule' || value === 'webhook')
                updateNode(trigger.id, { trigger: value })
            }}
          />
          {trigger.data.trigger === 'schedule' && (
            <>
              <Choice
                label="Schedule"
                value={customSchedule ? 'custom' : trigger.data.schedule}
                items={scheduleChoices}
                disabled={busy}
                onChange={(schedule) => {
                  setCustomSchedule(schedule === 'custom')
                  if (schedule !== 'custom') updateNode(trigger.id, { schedule })
                }}
              />
              {customSchedule && (
                <Field
                  label="Cron expression"
                  value={trigger.data.schedule}
                  editable={!busy}
                  onChangeText={(schedule) => updateNode(trigger.id, { schedule })}
                  placeholder="0 9 * * 1-5"
                />
              )}
              <Field
                label="Time zone"
                value={trigger.data.timezone}
                editable={!busy}
                onChangeText={(timezone) => updateNode(trigger.id, { timezone })}
                placeholder="Europe/Amsterdam"
              />
              <Text style={styles.muted}>Schedules use this time zone, even when you travel.</Text>
            </>
          )}
          {trigger.data.trigger === 'webhook' && (
            <Text style={styles.muted}>
              After saving, configure the webhook credential on the host desktop. Each delivery
              needs a unique X-Idempotency-Key.
            </Text>
          )}
          <Text accessibilityRole="header" style={[styles.title, { marginTop: 8 }]}>
            Steps
          </Text>
          {ordered.slice(1).map((node, stepIndex) => {
            const index = stepIndex + 1
            const open = expanded === node.id
            return (
              <View
                key={node.id}
                style={{
                  gap: 10,
                  paddingVertical: 8,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                }}
              >
                <Pressable
                  testID={`Edit step ${index}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setExpanded(open ? '' : node.id)}
                  style={[styles.row, { minHeight: 44, flexWrap: 'nowrap' }]}
                >
                  <Text style={[styles.muted, { width: 20 }]}>{index}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={2} style={[styles.text, { fontWeight: '600' }]}>
                      {node.data.label || 'Untitled step'}
                    </Text>
                    <Text style={styles.muted}>
                      {node.data.kind === 'review' ? 'Approval gate' : 'Agent task'}
                    </Text>
                  </View>
                  <Icon name={open ? 'down' : 'next'} size={14} color={colors.muted} />
                </Pressable>
                {open && (
                  <>
                    <StepFields
                      data={node.data}
                      workspace={workspace}
                      disabled={busy}
                      onChange={(patch) => updateNode(node.id, patch)}
                    />
                    <View style={[styles.row, { justifyContent: 'flex-end' }]}>
                      <IconButton
                        icon="moveUp"
                        variant="plain"
                        label="Move up"
                        disabled={busy || index === 1}
                        onPress={() => move(index, -1)}
                      />
                      <IconButton
                        icon="moveDown"
                        variant="plain"
                        label="Move down"
                        disabled={busy || index === ordered.length - 1}
                        onPress={() => move(index, 1)}
                      />
                      <IconButton
                        icon="trash"
                        variant="plain"
                        color={colors.error}
                        label="Remove step"
                        disabled={busy}
                        onPress={() => updateNodes(ordered.filter((item) => item.id !== node.id))}
                      />
                    </View>
                  </>
                )}
              </View>
            )
          })}
          <View style={styles.row}>
            <Action secondary label="Add task" disabled={busy} onPress={() => add('task')} />
            <Action secondary label="Add review" disabled={busy} onPress={() => add('review')} />
          </View>
          <Text style={styles.muted}>
            {baseline?.enabled
              ? 'Changes apply to future runs. Current runs keep their original steps.'
              : 'Saved with automatic triggers paused. You can run it manually, then enable triggers when ready.'}
          </Text>
          {attempted &&
            issues.map((issue) => (
              <Text key={issue} accessibilityRole="alert" style={styles.error}>
                {issue}
              </Text>
            ))}
          {!connected && (
            <Text style={styles.muted}>Reconnect to save changes on this computer.</Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label="Save automation"
            disabled={!connected || busy}
            onPress={() => {
              setAttempted(true)
              if (issues.length) return
              act(async () => {
                if (!focus.current) return
                await call(
                  '/api/workspace',
                  {
                    collection: 'automations',
                    id: draft.id,
                    ...(baseline
                      ? {
                          changes: {
                            name: { before: baseline.name, after: draft.name.trim() },
                            nodes: { before: baseline.nodes, after: draft.nodes },
                            edges: { before: baseline.edges, after: draft.edges },
                          },
                        }
                      : {
                          create: { ...draft, name: draft.name.trim(), enabled: false },
                          changes: {},
                        }),
                  },
                  z.object({ revision: z.number() }),
                  'PATCH',
                )
                onClose()
              })
            }}
          />
        </>
      )}
    </Sheet>
  )
}
