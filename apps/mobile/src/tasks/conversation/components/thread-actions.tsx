import { useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { runClientEffect } from '@dovo/client-runtime'
import {
  createLauncherTask,
  launcherDefaultAgent,
  resolveTaskAgent,
  defaultTaskHarness,
  resolveProviderAccess,
  decode,
  taskHarnessSchema,
  threadActionSendSchema,
  threadActionResultSchema,
  RuntimeRequestError,
  type Task,
  type ThreadAction,
  type ThreadActionSend,
  type RuntimeSnapshot,
  type Repository,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { createDetailDrafts, detailDraftKey } from '../../../runtime/state/detail-drafts'
import { useNavigation } from '../../../shell/navigation'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useAction } from '../../../ui/controls/use-action'
import { McpThreadEditor } from '../../../ui/content/mcp-thread-editor'
import { AutomationActionCard } from './automation-action-card'

const attempts = createDetailDrafts<ThreadActionSend>()

/** Anchor only to the last message of the preparing turn. Missing anchors go at the end. */
export function mobileThreadActions(task: Task, messageId?: string) {
  return (task.threadActions ?? []).filter((action) => {
    const anchor = task.messages.filter((message) => message.turnId === action.runId).at(-1)?.id
    return anchor === messageId && action.state !== 'dismissed'
  })
}
export function ThreadActionCards({ task, messageId }: { task: Task; messageId?: string }) {
  const { snapshot, profile } = useRuntime()
  if (!snapshot?.threadActionsSupported) return null
  return (
    <>
      {mobileThreadActions(task, messageId).map((action) =>
        // Cards without `automation` are new-thread cards, including all older runtimes' cards.
        action.automation ? (
          <AutomationActionCard
            key={detailDraftKey(profile?.connection ?? null, task.id, action.id)}
            task={task}
            action={action}
          />
        ) : (
          <ThreadActionCard
            key={detailDraftKey(profile?.connection ?? null, task.id, action.id)}
            task={task}
            action={action}
          />
        ),
      )}
    </>
  )
}
function initialSelection(
  snapshot: RuntimeSnapshot,
  repository: Repository,
  task: Task,
  action: ThreadAction,
) {
  const fallback = launcherDefaultAgent(snapshot, repository)
  const source = resolveTaskAgent(task, snapshot.workspace.agents)
  const suggestion = action.suggestion
  const suggestedAgent = snapshot.workspace.agents.find((agent) => agent.id === suggestion?.agentId)
  const provider =
    suggestedAgent?.provider ?? suggestion?.provider ?? source?.provider ?? fallback.provider
  const base = suggestedAgent ?? (source?.provider === provider ? source : undefined)
  const harness = decode(taskHarnessSchema, {
    ...(base ?? defaultTaskHarness(provider)),
    provider,
    permission: resolveProviderAccess(
      provider,
      source?.permission ?? fallback.harness?.permission ?? 'read-only',
    ),
    approvalPolicy: source?.approvalPolicy ?? fallback.harness?.approvalPolicy,
    sandboxMode: source?.sandboxMode ?? fallback.harness?.sandboxMode,
    model: suggestion?.model ?? base?.model ?? '',
    reasoning: suggestion?.reasoning ?? base?.reasoning,
  })
  return {
    key: suggestedAgent ? `agent:${suggestedAgent.id}` : `harness:${provider}`,
    name: suggestedAgent?.name ?? provider,
    agentId: suggestedAgent?.id,
    provider,
    harness,
    model: harness.model,
  }
}
export function ThreadActionCard({ task, action }: { task: Task; action: ThreadAction }) {
  const { snapshot, profile, connected, callEffect } = useRuntime()
  const { navigate } = useNavigation()
  const { styles, colors } = useTheme()
  const { act, busy, error } = useAction()
  const [editing, setEditing] = useState(false)
  const [receipt, setReceipt] = useState<ThreadAction>()
  const current = receipt && receipt.updatedAt >= action.updatedAt ? receipt : action
  const repository = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  const key = detailDraftKey(profile?.connection ?? null, 'thread-action', task.id, action.id)
  if (!snapshot?.threadActionsSupported || current.state === 'dismissed') return null
  return (
    <View
      style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8 }}
    >
      <Text style={styles.title}>{current.title}</Text>
      <Text numberOfLines={4}>{current.prompt}</Text>
      <Text style={styles.muted}>
        {current.state === 'sent' ? 'Sent' : 'Review and edit before starting a new thread.'}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {current.sent ? (
        <Action
          label="Open sent thread"
          secondary
          onPress={() => {
            if (profile && current.sent) navigate('tasks', current.sent.taskId, profile.id)
          }}
        />
      ) : (
        <>
          <Action
            label="Review new thread"
            disabled={!connected || !repository || busy}
            onPress={() => setEditing(true)}
          />
          <Action
            label="Dismiss thread action"
            secondary
            disabled={!connected || busy}
            onPress={() =>
              act(async () => {
                const result = await runClientEffect(
                  callEffect(
                    '/api/thread-actions/dismiss',
                    { sourceTaskId: task.id, actionId: action.id },
                    threadActionResultSchema,
                  ),
                )
                setReceipt(result.action)
              })
            }
          />
        </>
      )}
      {editing && current.state === 'prepared' && repository && (
        <McpThreadEditor
          key={key}
          draftKey={key}
          repository={repository}
          allowDestination
          standalone={!!task.bot}
          initial={{
            prompt: action.prompt,
            selection: initialSelection(snapshot, repository, task, action),
          }}
          onClose={() => setEditing(false)}
          onSend={async (value) => {
            let payload = attempts.read(key)
            if (!payload) {
              const destination = snapshot.workspace.repositories.find(
                (item) => item.id === (value.repositoryId ?? repository.id),
              )
              if (!destination) throw Error('The selected destination is unavailable.')
              payload = decode(threadActionSendSchema, {
                sourceTaskId: task.id,
                actionId: action.id,
                messageId: randomUUID(),
                createTask: {
                  ...createLauncherTask(
                    snapshot,
                    destination,
                    value.selection,
                    action.title,
                    randomUUID(),
                  ),
                  title: action.title,
                },
                text: value.prompt,
              })
              if (!attempts.write(key, payload))
                throw Error('Save another thread action draft before sending this one.')
            }
            try {
              const result = await runClientEffect(
                callEffect('/api/thread-actions/send', payload, threadActionResultSchema),
              )
              attempts.remove(key)
              setReceipt(result.action)
            } catch (error) {
              if (error instanceof RuntimeRequestError && error.mutationRejected === true)
                attempts.remove(key)
              throw error
            }
          }}
        />
      )}
    </View>
  )
}
