import { useRef, useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { router } from 'expo-router'
import { Schema } from 'effect'
import {
  mutableStruct,
  bringBackSideThreadResultSchema,
  sideThreadAttention,
  sideThreadAttentionTarget,
  responses,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { taskHref } from '../../../shell/task-route'
import { Action } from '../../../ui/controls/action'
import { useAction } from '../../../ui/controls/use-action'
import { Text } from '../../../ui/content/text'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'
import {
  appendRuntimeDraft,
  prepareRuntimeSideThread,
  finishRuntimeSideThread,
} from '../../draft/runtime-drafts'
import { useOperationGuard } from '../../../runtime/state/use-operation-guard'

const resultSchema = mutableStruct({ id: Schema.String })

export function AgentSideChats({
  task,
  onClose,
  onReadOnly,
}: {
  task: Task
  onClose: () => void
  onReadOnly: () => void
}) {
  const { snapshot, profile, connected, call, legacyDraftRuntimeId } = useRuntime()
  const current = useOperationGuard(
    JSON.stringify([profile?.id, profile?.connection.address, snapshot?.runtimeId, task.id]),
  )
  const { styles } = useTheme()
  const action = useAction()
  const sheet = useRef<SheetHandle>(null)
  const childId = useRef(randomUUID())
  const repository = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  const canCreate = !!repository && (!repository.kind || repository.kind === 'scratch')
  const children =
    snapshot?.workspace.tasks.filter((child) => child.sideThread?.parentTaskId === task.id) ?? []
  const open = (id: string) => {
    if (!profile || !current()) return
    sheet.current?.dismiss(() => {
      if (current()) router.push(taskHref(profile.id, id))
    })
  }
  return (
    <Sheet ref={sheet} title="Side chats" onClose={onClose} busy={action.busy}>
      {!children.length && (
        <Text style={styles.muted}>
          Work with an agent in its own conversation and checkout. Bring completed results back when
          you choose.
        </Text>
      )}
      <Action
        label="New side chat"
        disabled={
          !connected ||
          !profile ||
          action.busy ||
          !!task.archivedAt ||
          !!task.sideThread ||
          !canCreate
        }
        onPress={() =>
          action.act(async () => {
            if (!profile) return
            const id = await prepareRuntimeSideThread(
              profile.id,
              task.id,
              childId.current,
              '',
              task.draft ?? '',
              legacyDraftRuntimeId,
            )
            if (!current()) return
            const result = await call(
              '/api/tasks/side-thread/create',
              { id: task.id, childId: id },
              resultSchema,
            )
            await finishRuntimeSideThread(profile.id, task.id, id)
            open(result.id)
          })
        }
      />
      <Action secondary label="Read-only chat" onPress={onReadOnly} />
      {!!task.sideThread && (
        <Text style={styles.muted}>Start another side chat from the main thread.</Text>
      )}
      {!canCreate && (
        <Text style={styles.muted}>Agent side chats need a Git project or General workspace.</Text>
      )}
      {!children.length && (
        <Text style={styles.muted}>Your agent side chats will appear here.</Text>
      )}
      {children.map((child) => {
        const attention = sideThreadAttention(snapshot, child.id)
        const label =
          attention === 'approval'
            ? 'Needs approval'
            : attention === 'input'
              ? 'Needs answer'
              : child.archivedAt
                ? 'Archived'
                : child.archived
                  ? 'Settled'
                  : child.status
        const unused =
          child.status === 'draft' &&
          !child.turns?.length &&
          !child.activeRunId &&
          !child.queue?.length &&
          !attention
        return (
          <View key={child.id} style={{ gap: 2 }}>
            <Action
              secondary
              label={`${child.title} · ${label}`}
              disabled={!profile || action.busy}
              onPress={() => open(child.id)}
            />
            {unused && !child.archivedAt && (
              <Action
                secondary
                label={`Discard ${child.title}`}
                disabled={!connected || action.busy}
                onPress={() =>
                  action.act(() =>
                    call('/api/tasks/side-thread/discard', { id: child.id }, responses.ok),
                  )
                }
              />
            )}
          </View>
        )
      })}
      {!!action.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error}
        </Text>
      )}
    </Sheet>
  )
}

/** Uses the ordinary task screen for models, tools, approvals and cancellation. */
export function SideThreadActions({ task, onReview }: { task: Task; onReview?: () => void }) {
  const { snapshot, profile, connected, call, legacyDraftRuntimeId } = useRuntime()
  const { styles } = useTheme()
  const action = useAction()
  const [delivered, setDelivered] = useState('')
  const current = useOperationGuard(
    JSON.stringify([profile?.id, profile?.connection.address, snapshot?.runtimeId, task.id]),
  )
  const parent = snapshot?.workspace.tasks.find((item) => item.id === task.sideThread?.parentTaskId)
  if (!task.sideThread) return null
  const latest = task.turns?.at(-1)
  const hasResult =
    latest?.status === 'completed' &&
    task.messages.findIndex((message) => message.id === latest.assistantId) >=
      task.sideThread.contextMessageCount
  const reason =
    !connected || !profile
      ? 'Connect to bring results back.'
      : !parent
        ? 'The parent thread is unavailable.'
        : parent.archivedAt || task.archivedAt
          ? 'Restore the archived thread before bringing results back.'
          : parent.status === 'running' || parent.queue?.length || parent.subagentInbox?.length
            ? 'Available when the parent is idle with an empty queue.'
            : task.status === 'running' || task.queue?.length || task.subagentInbox?.length
              ? 'Wait for this side chat to finish.'
              : !hasResult
                ? 'Available after a finished reply.'
                : ''
  const disabled = !!reason || action.busy
  const alreadyBroughtBack = !!latest && task.sideThread.broughtBackThrough === latest.id
  return (
    <>
      {task.sideThread.source === 'head' && (
        <Text style={[styles.muted, { paddingHorizontal: 12 }]}>
          Committed files only · parent’s in-progress edits were excluded.
        </Text>
      )}
      {task.sideThread.source === 'scratch' && (
        <Text style={[styles.muted, { paddingHorizontal: 12 }]}>
          General side chat · starts with an empty directory.
        </Text>
      )}
      <Action
        secondary
        label={
          action.busy
            ? 'Bringing back…'
            : alreadyBroughtBack
              ? 'Retry delivery to parent'
              : 'Bring back'
        }
        disabled={disabled}
        onPress={() =>
          action.act(async () => {
            const result = await call(
              '/api/tasks/side-thread/bring-back',
              { id: task.id, expectedDraft: parent?.draft },
              bringBackSideThreadResultSchema,
            )
            if (profile && current()) {
              await appendRuntimeDraft(
                profile.id,
                result.id,
                result.text,
                parent?.draft,
                result.receiptId,
                legacyDraftRuntimeId,
              )
              if (current()) {
                setDelivered(result.receiptId)
                router.replace(taskHref(profile.id, result.id))
              }
            }
          })
        }
      />
      {!!reason && <Text style={[styles.muted, { paddingHorizontal: 12 }]}>{reason}</Text>}
      {!!delivered && (
        <Text accessibilityRole="status" style={styles.muted}>
          Brought back to the parent draft.
        </Text>
      )}
      {!!onReview && task.sideThread.source !== 'scratch' && (
        <Action secondary label="Review side-chat changes" onPress={onReview} />
      )}
      {!!action.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error}
        </Text>
      )}
    </>
  )
}

export function SideChatAttention({ task }: { task: Task }) {
  const { snapshot, profile } = useRuntime()
  const { styles } = useTheme()
  const target = sideThreadAttentionTarget(snapshot, task.id)
  if (!target || !profile) return null
  return (
    <View
      style={{
        paddingHorizontal: 12,
        gap: 4,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Text accessibilityRole="status" style={styles.muted}>
        Side chat needs {target.kind === 'approval' ? 'approval' : 'an answer'}.
      </Text>
      <Action
        secondary
        label={target.kind === 'approval' ? 'Open approval' : 'Open question'}
        onPress={() => router.push(taskHref(profile.id, target.id))}
      />
    </View>
  )
}
