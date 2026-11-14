import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { runClientEffect } from '@dovo/client-runtime'
import {
  RuntimeRequestError,
  automationActionSendSchema,
  decode,
  githubEventChoices,
  threadActionResultSchema,
  type AutomationActionSend,
  type AutomationData,
  type Task,
  type ThreadAction,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  createDetailDrafts,
  detailDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { automationHref } from '../../../shell/source-route'
import { Action } from '../../../ui/controls/action'
import { Field } from '../../../ui/controls/field'
import { useAction } from '../../../ui/controls/use-action'
import { Text } from '../../../ui/content/text'
import { Sheet, useSheetNavigation } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'

type Snapshot = NonNullable<ThreadAction['automation']>
type Resource = Snapshot['resources'][number]
/** `attempt` is the exact body of a start whose outcome is unknown. Retry resends it. */
type Draft = { text: string; attempt?: AutomationActionSend; stale?: boolean }
const drafts = createDetailDrafts<Draft>()

const botNotice =
  'This step runs in the Bot’s thread with the Bot’s own current settings and resources. Its private instructions and secrets stay with the Bot and are not shown or copied.'

function triggerText(
  data: Pick<AutomationData, 'trigger' | 'schedule' | 'timezone' | 'runAt' | 'github'>,
) {
  if (data.trigger === 'manual') return 'Manual run'
  if (data.trigger === 'webhook') return 'Webhook'
  if (data.trigger === 'schedule') return `Schedule ${data.schedule} (${data.timezone})`
  if (data.trigger === 'once') return `Once at ${data.runAt ?? 'an unset time'} (${data.timezone})`
  const github = data.github
  if (!github) return 'GitHub event'
  const event = githubEventChoices.find((choice) => choice.id === github.event)?.name
  return [
    `GitHub ${event ?? github.event} on ${github.host}/${github.repository || 'any repository'}`,
    github.label && `label ${github.label}`,
    github.actor && `actor ${github.actor}`,
    github.requireWriteAccess && 'write access required',
  ]
    .filter(Boolean)
    .join(' · ')
}
const agentText = ({ agent }: Resource) =>
  agent.modelSelection
    ? agent.modelSelection === 'inherit'
      ? 'Inherit · Project model applied at start'
      : `${agent.modelSelection === 'auto' ? 'Tune' : 'Maestro'} · Model chosen at start`
    : [agent.name, agent.provider, agent.model || 'default model', agent.reasoning]
        .filter(Boolean)
        .join(' · ')
const accessText = ({ agent }: Resource) =>
  [
    agent.permission,
    agent.approvalPolicy && `approval ${agent.approvalPolicy}`,
    agent.sandboxMode && `sandbox ${agent.sandboxMode}`,
  ]
    .filter(Boolean)
    .join(' · ')

/** Read-only view of the exact saved workflow and its effective resources. */
function SnapshotView({ snapshot }: { snapshot: Snapshot }) {
  const uiText = useInterfaceText()

  const { styles, colors } = useTheme()
  const { workflow } = snapshot
  const labels = new Map(workflow.nodes.map((node) => [node.id, node.data.label || node.id]))
  return (
    <View style={{ gap: 12 }}>
      {(workflow.policy || workflow.monitor) && (
        <Text>
          {JSON.stringify({ limits: workflow.policy, monitor: workflow.monitor }, null, 2)}
        </Text>
      )}
      {workflow.nodes.map((node, index) => {
        const resource = snapshot.resources.find((item) => item.nodeId === node.id)
        const rows: [string, string][] = [
          ...(node.data.kind === 'trigger'
            ? [['Trigger', triggerText(node.data)] as [string, string]]
            : []),
          ...(node.data.kind !== 'trigger' && node.data.objective
            ? [
                [resource?.botId ? 'Message to Bot' : 'Instructions', node.data.objective] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...(resource
            ? ([
                ...(resource.botId
                  ? [
                      ['Bot', resource.botName ?? resource.botId],
                      ['Bot settings', botNotice],
                    ]
                  : []),
                ['Agent', agentText(resource)],
                ['Access', accessText(resource)],
                ['Checkout', resource.repositoryName],
                ...(resource.execution
                  ? [
                      [
                        'Execution',
                        resource.execution === 'worktree' ? 'New worktree' : 'Main checkout',
                      ],
                    ]
                  : []),
                ...(resource.projects.length
                  ? [
                      [
                        'Projects',
                        resource.projects
                          .map((project) =>
                            project.path ? `${project.name} · ${project.path}` : project.name,
                          )
                          .join('\n'),
                      ],
                    ]
                  : []),
              ] as [string, string][])
            : []),
        ]
        return (
          <View
            key={node.id}
            accessibilityLabel={uiText('Step {value0}: {value1}', {
              value0: index + 1,
              value1: labels.get(node.id),
            })}
            style={{
              gap: 6,
              padding: 10,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
            }}
          >
            <Text style={{ fontWeight: '600' }}>
              {labels.get(node.id)} ({node.data.kind})
            </Text>
            {rows.map(([label, value]) => (
              <View key={label} style={{ gap: 2 }}>
                <Text style={styles.muted}>{label}</Text>
                <Text selectable>{value}</Text>
              </View>
            ))}
          </View>
        )
      })}
      {workflow.edges.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: '600' }}>{uiText('Connections')}</Text>
          {workflow.edges.map((edge) => (
            <Text key={edge.id}>
              {labels.get(edge.source) ?? edge.source} → {labels.get(edge.target) ?? edge.target}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

/** Starts one existing automation after a person reviews its exact saved revision. One body per
 * pairing, thread and action: busy and error state never carry over to another scope. */
export function AutomationActionCard({ task, action }: { task: Task; action: ThreadAction }) {
  const { profile } = useRuntime()
  const key = detailDraftKey(profile?.connection ?? null, 'automation-action', task.id, action.id)
  return <AutomationActionBody key={key} draftKey={key} task={task} action={action} />
}

function AutomationActionBody({
  draftKey: key,
  task,
  action,
}: {
  draftKey: string
  task: Task
  action: ThreadAction
}) {
  const uiText = useInterfaceText()

  const { snapshot: runtime, profile, connected, callEffect } = useRuntime()
  const { styles, colors } = useTheme()
  const navigateAfterSheet = useSheetNavigation()
  const { act, busy, error } = useAction()
  const [reviewing, setReviewing] = useState(false)
  const [receipt, setReceipt] = useState<{ key: string; action: ThreadAction }>()
  const { draft, setField } = useDetailDraft(drafts, key, () => ({ text: action.prompt }))
  const sending = useRef(false)
  // Late replies must not touch a card that now shows another runtime, thread or action.
  const live = useRef<string | undefined>(key)
  live.current = key
  useEffect(
    () => () => {
      live.current = undefined
    },
    [],
  )
  const received = receipt?.key === key ? receipt.action : undefined
  const current = received && received.updatedAt >= action.updatedAt ? received : action
  const snapshot = current.automation ?? action.automation
  if (!runtime?.threadActionsSupported || !snapshot || current.state === 'dismissed') return null
  const sent = current.automationSent
  const frozen = !!draft.attempt
  const paused = snapshot.workflow.enabled === false && !frozen
  const blocked = !connected
    ? 'Reconnect the source computer before Start.'
    : paused
      ? 'This automation is paused. Resume it in Automations, then refresh the review.'
      : undefined
  const write = (target: string, value: Draft | undefined) => {
    if (value) drafts.write(target, value)
    else drafts.remove(target)
  }
  const start = () => {
    if (sending.current || blocked || draft.stale) return
    const target = key
    const latest = drafts.read(target) ?? draft
    if (!latest.attempt && !latest.text.trim()) return
    sending.current = true
    act(async () => {
      try {
        const attempt =
          latest.attempt ??
          decode(automationActionSendSchema, {
            sourceTaskId: task.id,
            actionId: action.id,
            revision: snapshot.revision,
            text: latest.text.trim(),
          })
        if (!latest.attempt && !drafts.write(target, { text: latest.text, attempt }))
          throw Error('Save another automation action draft before starting this one.')
        let result
        try {
          result = await runClientEffect(
            callEffect('/api/thread-actions/send', attempt, threadActionResultSchema),
          )
        } catch (cause) {
          // Only a definite no-start unlocks the payload. Keep the person's context.
          if (
            cause instanceof RuntimeRequestError &&
            cause.mutationRejected === true &&
            drafts.read(target)?.attempt === attempt
          )
            write(target, { text: latest.text, stale: true })
          throw cause
        }
        // A newer draft for this action stays when an older start completes late.
        if (drafts.read(target)?.attempt === attempt) write(target, undefined)
        if (live.current !== target) return
        setReceipt({ key: target, action: result.action })
        setReviewing(false)
      } finally {
        sending.current = false
      }
    })
  }
  const review = () => {
    const target = key
    act(async () => {
      const result = await runClientEffect(
        callEffect(
          '/api/thread-actions/review',
          { sourceTaskId: task.id, actionId: action.id },
          threadActionResultSchema,
        ),
      )
      const latest = drafts.read(target)
      if (latest && !latest.attempt) write(target, { text: latest.text })
      if (live.current === target) setReceipt({ key: target, action: result.action })
    })
  }
  return (
    <View
      style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8 }}
    >
      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.muted}>
        <InterfaceText values={{ value0: snapshot.workflow.name }}>
          {'Automation · {value0}'}
        </InterfaceText>
      </Text>
      <Text numberOfLines={4}>{current.prompt}</Text>
      <Text style={styles.muted}>
        {sent
          ? uiText('Started')
          : uiText('Review the saved workflow, agents, projects and access before Start.')}
      </Text>
      {!!error && !reviewing && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {sent ? (
        <Action
          label={uiText('Open automation run')}
          secondary
          onPress={() => {
            if (profile)
              navigateAfterSheet(() =>
                router.push(automationHref(profile.id, snapshot.automationId, sent.runId)),
              )
          }}
        />
      ) : (
        <>
          <Action
            label={uiText('Review automation')}
            disabled={!connected || busy}
            onPress={() => setReviewing(true)}
          />
          <Action
            label={uiText('Dismiss automation action')}
            secondary
            disabled={!connected || busy}
            onPress={() => {
              const target = key
              act(async () => {
                const result = await runClientEffect(
                  callEffect(
                    '/api/thread-actions/dismiss',
                    { sourceTaskId: task.id, actionId: action.id },
                    threadActionResultSchema,
                  ),
                )
                if (live.current === target) setReceipt({ key: target, action: result.action })
              })
            }}
          />
        </>
      )}
      {reviewing && current.state === 'prepared' && !sent && (
        <Sheet
          title={uiText('Start {value0}', { value0: snapshot.workflow.name })}
          busy={busy}
          onClose={() => setReviewing(false)}
          footer={
            <View style={{ gap: 8 }}>
              {!frozen && (
                <Action
                  label={uiText('Refresh review')}
                  secondary
                  disabled={busy || !connected}
                  onPress={review}
                />
              )}
              <Action
                label={frozen ? uiText('Retry Start') : uiText('Start automation')}
                wide
                disabled={busy || !!blocked || !!draft.stale || (!frozen && !draft.text.trim())}
                onPress={start}
              />
            </View>
          }
        >
          <View style={{ gap: 16 }}>
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'Start runs this saved workflow once, with your context as external user input. Change the workflow itself in Automations.'
                }
              </InterfaceText>
            </Text>
            {!!blocked && <Text accessibilityRole="alert">{blocked}</Text>}
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {!!draft.stale && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'The computer did not start this run. Refresh the review to see the current automation before Start. Your run context stays.'
                  }
                </InterfaceText>
              </Text>
            )}
            <Field
              label={uiText('Run context')}
              multiline
              value={draft.text}
              editable={!busy && !frozen}
              onChangeText={(value) => {
                if (!drafts.read(key)?.attempt) setField('text', value)
              }}
              maxLength={20000}
            />
            {frozen && (
              <Text style={styles.muted}>
                <InterfaceText>
                  {
                    'The start may have reached the computer. Retry sends the same context and revision so it can recover the same run.'
                  }
                </InterfaceText>
              </Text>
            )}
            <SnapshotView snapshot={snapshot} />
            <Text style={styles.muted}>
              <InterfaceText>{'Closing this sheet keeps your unsent context.'}</InterfaceText>
            </Text>
          </View>
        </Sheet>
      )}
    </View>
  )
}
