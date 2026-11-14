import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { RoutineOptions } from './routine-options'
import { defaultGithubTrigger, githubEventChoices } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/content/text'
import { randomUUID } from 'expo-crypto'
import {
  automationIssues,
  type Automation,
  type AutomationData,
  type AutomationNode,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { useRuntime } from '../runtime/connection/provider'
import { SettingsSheet as Sheet } from '../screens/settings-theme'
import { SettingsField as Field } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'
import { SettingsAction as Action } from '../screens/settings-controls'
import { Icon } from '../ui/controls/icon'
import { IconButton } from '../ui/controls/icon-button'
import { useSettingsTheme as useTheme } from '../screens/settings-theme'
import { useAction } from '../ui/controls/use-action'
import { linearNodes, newAutomationNode, withLinearNodes, scheduleChoices } from './linear-flow'
import { StepFields } from './step-fields'
import { useNavigation } from '../shell/navigation'
export function AutomationEditor({ flow, onClose }: { flow?: Automation; onClose: () => void }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const { snapshot, connected, callEffect } = useRuntime()
  const { focused } = useNavigation()
  const focus = useRef(focused)
  focus.current = focused
  const { busy, error, act } = useAction()
  const [baseline] = useApplicationState(flow)
  const workspace = snapshot?.workspace ?? {
    agents: [],
    repositories: [],
  }
  const [draft, setDraft] = useApplicationState<Automation>(() => {
    if (flow) return flow
    const defaults = {
      repositoryId: workspace.repositories[0]?.id ?? '',
      agentId: workspace.agents[0]?.id ?? '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }
    return withLinearNodes(
      {
        id: randomUUID(),
        name: '',
        nodes: [],
        edges: [],
        enabled: false,
      },
      [
        newAutomationNode(randomUUID(), 'trigger', defaults),
        newAutomationNode(randomUUID(), 'task', defaults),
      ],
    )
  })
  const ordered = linearNodes(draft)
  const trigger = ordered?.[0]
  const [expanded, setExpanded] = useApplicationState(() => ordered?.[1]?.id ?? '')
  const [attempted, setAttempted] = useApplicationState(false)
  const [customSchedule, setCustomSchedule] = useApplicationState(
    () => !scheduleChoices.some((item) => item.id === trigger?.data.schedule),
  )
  const issues = automationIssues(draft, workspace)
  const updateNodes = (nodes: AutomationNode[]) =>
    setDraft((value) => withLinearNodes(value, nodes))
  const updateNode = (id: string, patch: Partial<AutomationData>) => {
    if (ordered)
      updateNodes(
        ordered.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...patch,
                },
              }
            : node,
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
      title={baseline ? uiText('Edit automation') : uiText('New automation')}
      busy={busy}
      onClose={() => {
        if (focus.current) onClose()
      }}
    >
      {!ordered || !trigger ? (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'This automation has canvas connections that cannot be edited here. Use the desktop canvas to preserve its branches and dependencies.'
            }
          </InterfaceText>
        </Text>
      ) : (
        <>
          <Field
            label={uiText('Automation name')}
            value={draft.name}
            editable={!busy}
            onChangeText={(name) =>
              setDraft((value) => ({
                ...value,
                name,
              }))
            }
            placeholder={uiText('Morning repository review')}
          />
          <RoutineOptions
            key={draft.id}
            flow={draft}
            jsonMonitoringSupported={snapshot?.routineJsonMonitoringSupported}
            mcpMonitoringSupported={snapshot?.routineMcpMonitoringSupported}
            findingGroupsSupported={snapshot?.routineFindingGroupsSupported}
            disabled={busy}
            onSave={(options) => setDraft((current) => ({ ...current, ...options }))}
          />
          <Choice
            label={uiText('Trigger')}
            value={trigger.data.trigger}
            items={[
              {
                id: 'manual',
                name: uiText('Manual'),
              },
              {
                id: 'schedule',
                name: uiText('Schedule'),
              },
              { id: 'once', name: uiText('One time') },
              {
                id: 'webhook',
                name: uiText('Webhook'),
              },
              { id: 'github', name: uiText('GitHub event') },
            ]}
            disabled={busy}
            onChange={(value) => {
              if (
                value === 'manual' ||
                value === 'schedule' ||
                value === 'once' ||
                value === 'webhook' ||
                value === 'github'
              )
                updateNode(trigger.id, {
                  trigger: value,
                  ...(value === 'github'
                    ? { github: trigger.data.github ?? { ...defaultGithubTrigger } }
                    : {}),
                })
            }}
          />
          {trigger.data.trigger === 'once' && (
            <>
              <Field
                label={uiText('Run at')}
                value={trigger.data.runAt ?? ''}
                editable={!busy}
                onChangeText={(runAt) => updateNode(trigger.id, { runAt: runAt.replace(' ', 'T') })}
                placeholder="2026-10-28T09:00"
              />
              <Field
                label={uiText('Time zone')}
                value={trigger.data.timezone}
                editable={!busy}
                onChangeText={(timezone) => updateNode(trigger.id, { timezone })}
                placeholder={uiText('Europe/Amsterdam')}
              />
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'Enter YYYY-MM-DD HH:mm in this time zone. Runs once, including when this computer comes back online after the time has passed. The trigger turns off after the run starts.'
                  }
                </InterfaceText>
              </Text>
            </>
          )}
          {trigger.data.trigger === 'schedule' && (
            <>
              <Choice
                label={uiText('Schedule')}
                value={customSchedule ? 'custom' : trigger.data.schedule}
                items={scheduleChoices}
                disabled={busy}
                onChange={(schedule) => {
                  setCustomSchedule(schedule === 'custom')
                  if (schedule !== 'custom')
                    updateNode(trigger.id, {
                      schedule,
                    })
                }}
              />
              {customSchedule && (
                <Field
                  label={uiText('Cron expression')}
                  value={trigger.data.schedule}
                  editable={!busy}
                  onChangeText={(schedule) =>
                    updateNode(trigger.id, {
                      schedule,
                    })
                  }
                  placeholder="0 9 * * 1-5"
                />
              )}
              <Field
                label={uiText('Time zone')}
                value={trigger.data.timezone}
                editable={!busy}
                onChangeText={(timezone) =>
                  updateNode(trigger.id, {
                    timezone,
                  })
                }
                placeholder={uiText('Europe/Amsterdam')}
              />
              <Text style={styles.muted}>
                <InterfaceText>
                  {'Schedules use this time zone, even when you travel.'}
                </InterfaceText>
              </Text>
            </>
          )}
          {trigger.data.trigger === 'github' &&
            (() => {
              const github = trigger.data.github ?? defaultGithubTrigger
              const update = (patch: Partial<typeof github>) =>
                updateNode(trigger.id, { github: { ...github, ...patch } })
              return (
                <>
                  <Field
                    label={uiText('GitHub host')}
                    value={github.host}
                    editable={!busy}
                    onChangeText={(host) => update({ host })}
                    placeholder={uiText('github.com')}
                  />
                  <Field
                    label={uiText('GitHub repository')}
                    value={github.repository}
                    editable={!busy}
                    onChangeText={(repository) => update({ repository })}
                    placeholder={uiText('owner/repository')}
                  />
                  <Choice
                    label={uiText('GitHub event')}
                    value={github.event}
                    items={githubEventChoices.map((item) => ({ ...item }))}
                    disabled={busy}
                    onChange={(value) => {
                      const choice = githubEventChoices.find((item) => item.id === value)
                      if (choice)
                        update({
                          event: choice.id,
                          ...(choice.id === 'pull_request.synchronized'
                            ? { actor: '', requireWriteAccess: false }
                            : {}),
                        })
                    }}
                  />
                  <Field
                    label={uiText('Label filter (optional)')}
                    value={github.label}
                    editable={!busy}
                    onChangeText={(label) => update({ label })}
                  />
                  {github.event !== 'pull_request.synchronized' && (
                    <>
                      <Field
                        label={uiText('Actor login (optional)')}
                        value={github.actor}
                        editable={!busy}
                        onChangeText={(actor) => update({ actor })}
                        placeholder={uiText('octocat')}
                      />
                      <Choice
                        label={uiText('Require actor write access')}
                        value={github.requireWriteAccess ? 'yes' : 'no'}
                        items={[
                          { id: 'no', name: uiText('Any actor') },
                          { id: 'yes', name: uiText('Actors with write access') },
                        ]}
                        disabled={busy}
                        onChange={(value) => update({ requireWriteAccess: value === 'yes' })}
                      />
                    </>
                  )}
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {
                        'Uses the selected computer’s gh login. Polls every minute while the runtime is running. Enabling a trigger starts with new events.'
                      }
                    </InterfaceText>
                  </Text>
                  {github.event === 'pull_request.synchronized' && (
                    <Text style={styles.muted}>
                      <InterfaceText>
                        {
                          'Detects PR head changes after the first observation. Pushes between polls are combined; pusher filters are unavailable.'
                        }
                      </InterfaceText>
                    </Text>
                  )}
                  {github.event === 'discussion.updated' && (
                    <Text style={styles.muted}>
                      <InterfaceText>
                        {'Detects the latest discussion edit; edits between polls are combined.'}
                      </InterfaceText>
                    </Text>
                  )}
                </>
              )
            })()}
          {trigger.data.trigger === 'webhook' && (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'After saving, configure the webhook credential on the host desktop. Each delivery needs a unique X-Idempotency-Key.'
                }
              </InterfaceText>
            </Text>
          )}
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              {
                marginTop: 8,
              },
            ]}
          >
            <InterfaceText>{'Steps'}</InterfaceText>
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
                  accessibilityState={{
                    expanded: open,
                  }}
                  onPress={() => setExpanded(open ? '' : node.id)}
                  style={[
                    styles.row,
                    {
                      minHeight: 44,
                      flexWrap: 'nowrap',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.muted,
                      {
                        width: 20,
                      },
                    ]}
                  >
                    {index}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.text,
                        {
                          fontWeight: '600',
                        },
                      ]}
                    >
                      {node.data.label || uiText('Untitled step')}
                    </Text>
                    <Text style={styles.muted}>
                      {node.data.kind === 'review'
                        ? uiText('Approval gate')
                        : node.data.botId
                          ? uiText('Bot job · {value0}', {
                              value0:
                                snapshot?.workspace.tasks.find(
                                  (task) => task.id === node.data.botId && task.bot,
                                )?.title || 'Unavailable Bot',
                            })
                          : uiText('Agent task')}
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
                    <View
                      style={[
                        styles.row,
                        {
                          justifyContent: 'flex-end',
                        },
                      ]}
                    >
                      <IconButton
                        icon="moveUp"
                        variant="plain"
                        label={uiText('Move up')}
                        disabled={busy || index === 1}
                        onPress={() => move(index, -1)}
                      />
                      <IconButton
                        icon="moveDown"
                        variant="plain"
                        label={uiText('Move down')}
                        disabled={busy || index === ordered.length - 1}
                        onPress={() => move(index, 1)}
                      />
                      <IconButton
                        icon="trash"
                        variant="plain"
                        color={colors.error}
                        label={uiText('Remove step')}
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
            <Action
              secondary
              label={uiText('Add task')}
              disabled={busy}
              onPress={() => add('task')}
            />
            <Action
              secondary
              label={uiText('Add review')}
              disabled={busy}
              onPress={() => add('review')}
            />
          </View>
          <Text style={styles.muted}>
            {baseline?.enabled
              ? uiText('Changes apply to future runs. Current runs keep their original steps.')
              : uiText(
                  'Saved with automatic triggers paused. You can run it manually, then enable triggers when ready.',
                )}
          </Text>
          {attempted &&
            issues.map((issue) => (
              <Text key={issue} accessibilityRole="alert" style={styles.error}>
                {issue}
              </Text>
            ))}
          {!connected && (
            <Text style={styles.muted}>
              <InterfaceText>{'Reconnect to save changes on this computer.'}</InterfaceText>
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            wide
            label={uiText('Save automation')}
            disabled={!connected || busy}
            onPress={() => {
              setAttempted(true)
              if (issues.length) return
              act(() =>
                mobileWorkflow(function* () {
                  if (!focus.current) return
                  yield* callEffect(
                    '/api/workspace',
                    {
                      collection: 'automations',
                      id: draft.id,
                      ...(baseline
                        ? {
                            changes: {
                              name: {
                                before: baseline.name,
                                after: draft.name.trim(),
                              },
                              nodes: {
                                before: baseline.nodes,
                                after: draft.nodes,
                              },
                              edges: {
                                before: baseline.edges,
                                after: draft.edges,
                              },
                            },
                          }
                        : {
                            create: {
                              ...draft,
                              name: draft.name.trim(),
                              enabled: false,
                            },
                            changes: {},
                          }),
                    },
                    mutableStruct({
                      revision: Schema.Number.pipe(Schema.check(Schema.isFinite())),
                    }),
                    'PATCH',
                  )
                  onClose()
                }),
              )
            }}
          />
        </>
      )}
    </Sheet>
  )
}
