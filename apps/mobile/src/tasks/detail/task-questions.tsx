import { useState } from 'react'
import { Effect } from 'effect'
import { QuestionAttachments } from '../composer/question-attachments'
import {
  questionAllowsAttachments,
  type PendingQuestion,
  type QuestionAttachments as AnswerFiles,
} from '@dovo/protocol'
import { taskInputVisible } from '@dovo/protocol'
import { runtimeComputerName } from '@dovo/protocol'
import { mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { router } from 'expo-router'
import { Action } from '../../ui/controls/action'
import { View } from 'react-native'
import { responses } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { QuestionForm } from '../composer/question-form'
import { useConversationSelector } from '../conversation/state/provider'
export function TaskQuestions({ taskId, questionId }: { taskId: string; questionId?: string }) {
  const { styles } = useTheme()

  const { snapshot, profile, connected } = useRuntime()
  const visible = useConversationSelector((conversation) => conversation.visible)
  const questions =
    snapshot?.questions.filter((q) => taskInputVisible(snapshot.workspace.tasks, taskId, q)) ?? []
  const pending = questionId
    ? questions.find((q) => q.id === questionId)
    : (questions.find((q) => q.prompt.blocking !== false) ?? questions[0])
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  const project = snapshot?.workspace.repositories.find(
    (repo) => repo.id === task?.repositoryId,
  )?.name
  if (questionId && !pending)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        <Text accessibilityRole="alert" style={styles.muted}>
          {connected
            ? 'This question has already been answered or is no longer pending.'
            : 'Reconnect to check this question.'}
        </Text>
        <Action
          label="Show pending questions"
          secondary
          onPress={() => router.setParams({ questionId: undefined })}
        />
      </View>
    )
  if (!pending) return null
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}
    >
      <Text style={styles.muted}>
        {[task?.title, runtimeComputerName({ profile, snapshot }), project]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {pending.taskId !== taskId && (
        <Text style={styles.muted}>
          For child thread ·{' '}
          {snapshot?.workspace.tasks.find((child) => child.id === pending.taskId)?.title ??
            pending.taskId}
        </Text>
      )}
      <QuestionCard
        key={JSON.stringify([profile?.id, profile?.connection.address, pending.taskId, pending.id])}
        pending={pending}
        notificationAccessible={visible && pending.taskId === taskId}
      />
    </View>
  )
}

function QuestionCard({
  pending,
  notificationAccessible,
}: {
  pending: PendingQuestion
  notificationAccessible: boolean
}) {
  const { connected, profile, callEffect, finishAttachmentEffect, reviewAttachments } = useRuntime()
  const [files, setFiles] = useState<AnswerFiles>({})
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const ids = Object.fromEntries(
    Object.entries(files).map(([id, files]) => [id, files.map((file) => file.id)]),
  )
  const count = Object.values(files).flat().length
  return (
    <QuestionForm
      request={pending}
      connected={connected}
      runtimeId={profile?.id}
      notificationAccessible={notificationAccessible}
      attachmentIdsByQuestion={ids}
      attachmentsBusy={Object.values(uploading).some(Boolean)}
      renderAttachments={(q, disabled) =>
        pending.attachments && questionAllowsAttachments(q) ? (
          <QuestionAttachments
            taskId={pending.taskId}
            questionId={`${pending.id}:${q.id}`}
            files={Object.hasOwn(files, q.id) ? files[q.id] : []}
            count={count}
            disabled={disabled}
            onAdd={(file) => {
              setFiles((current) => ({
                ...current,
                [q.id]: [...(Object.hasOwn(current, q.id) ? current[q.id] : []), file],
              }))
              return true
            }}
            onRemove={(id) =>
              setFiles((current) => ({
                ...current,
                [q.id]: (Object.hasOwn(current, q.id) ? current[q.id] : []).filter(
                  (file) => file.id !== id,
                ),
              }))
            }
            onBusy={(busy) =>
              setUploading((current) =>
                current[q.id] === busy ? current : { ...current, [q.id]: busy },
              )
            }
          />
        ) : null
      }
      onAnswer={(answers) =>
        runClientEffect(
          mobileWorkflow(function* () {
            yield* callEffect(
              '/api/tasks/answer',
              { id: pending.id, answers, ...(answers ? { attachmentIdsByQuestion: ids } : {}) },
              responses.ok,
            )
            if (answers && profile)
              for (const file of Object.values(files).flat()) {
                yield* finishAttachmentEffect(profile, file.id).pipe(
                  Effect.catch(() => Effect.sync(() => reviewAttachments(profile))),
                )
              }
          }),
        )
      }
    />
  )
}
