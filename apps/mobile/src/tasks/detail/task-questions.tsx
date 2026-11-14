import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useQuestionRecovery } from '../composer/question-recovery'
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
  const uiText = useInterfaceText()

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
  const recovery = <RecoveredAnswers taskId={taskId} pendingIds={questions.map((q) => q.id)} />
  if (questionId && snapshot?.secureInputs?.some((input) => input.id === questionId))
    return recovery
  if (questionId && !pending)
    return (
      <View style={{ padding: 16, gap: 8 }}>
        {recovery}
        <Text accessibilityRole="alert" style={styles.muted}>
          {connected
            ? uiText('This question has already been answered or is no longer pending.')
            : uiText('Reconnect to check this question.')}
        </Text>
        <Action
          label={uiText('Show pending questions')}
          secondary
          onPress={() => router.setParams({ questionId: undefined })}
        />
      </View>
    )
  if (!pending) return recovery
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
          <InterfaceText
            values={{
              value0:
                snapshot?.workspace.tasks.find((child) => child.id === pending.taskId)?.title ??
                pending.taskId,
            }}
          >
            {'For child thread · {value0}'}
          </InterfaceText>
        </Text>
      )}
      {recovery}
      <QuestionCard
        key={JSON.stringify([
          profile?.id,
          profile?.connection.address,
          profile?.connection.token,
          pending.taskId,
          pending.id,
        ])}
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
  const { scope, store } = useQuestionRecovery()
  const saved = store
    .entries(scope)
    .find((entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId)
  const files = saved?.files ?? {}
  const setFiles = (update: (files: AnswerFiles) => AnswerFiles) =>
    store.update(
      scope,
      pending,
      undefined,
      update(
        store
          .entries(scope)
          .find(
            (entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId,
          )?.files ?? {},
      ),
    )
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const ids = Object.fromEntries(
    Object.entries(files).map(([id, files]) => [id, files.map((file) => file.id)]),
  )
  const count = Object.values(files).flat().length
  return (
    <QuestionForm
      request={pending}
      savedDrafts={saved?.drafts}
      onDraftsChange={(drafts) => store.update(scope, pending, drafts)}
      onAnswered={() => {
        if (
          store
            .entries(scope)
            .find(
              (entry) => entry.request.id === pending.id && entry.request.taskId === pending.taskId,
            ) === saved
        )
          store.remove(scope, pending.taskId, pending.id, saved ?? null)
      }}
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
      onAnswer={(answers, outcomes, references) =>
        runClientEffect(
          mobileWorkflow(function* () {
            yield* callEffect(
              '/api/tasks/answer',
              {
                id: pending.id,
                answers,
                outcomes,
                secretReferencesByQuestion: references,
                ...(answers && !outcomes ? { attachmentIdsByQuestion: ids } : {}),
              },
              responses.ok,
              undefined,
              { defer: false },
            )
            if (answers && !outcomes && profile)
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

function RecoveredAnswers({ taskId, pendingIds }: { taskId: string; pendingIds: string[] }) {
  const uiText = useInterfaceText()

  const { scope, store } = useQuestionRecovery()
  const { styles } = useTheme()
  const entries = store
    .entries(scope)
    .filter(
      (entry) =>
        entry.request.taskId === taskId &&
        !pendingIds.includes(entry.request.id) &&
        (Object.values(entry.drafts).some((draft) => draft.text || draft.selected.length) ||
          Object.values(entry.files).some((files) => files.length)),
    )
  return (
    <View style={{ gap: 8 }}>
      {!!store.error(scope) && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {store.error(scope)}
          </Text>
          <Action
            label={uiText('Retry saved answers')}
            secondary
            onPress={() => void store.retry(scope)}
          />
        </View>
      )}
      {entries.map((entry) => (
        <View key={entry.request.id} style={[styles.card, { padding: 12, gap: 8 }]}>
          <Text style={styles.text}>
            <InterfaceText values={{ value0: entry.request.prompt.title }}>
              {'Saved answers · {value0}'}
            </InterfaceText>
          </Text>
          <Text style={styles.muted}>
            <InterfaceText>
              {'This request is no longer pending. Select and copy the answers you want to keep.'}
            </InterfaceText>
          </Text>
          {entry.request.prompt.questions
            .filter((q) => !q.secret)
            .map((q) => (
              <View key={q.id}>
                <Text style={styles.muted}>{q.question}</Text>
                <Text selectable style={styles.text}>
                  {[...(entry.drafts[q.id]?.selected ?? []), entry.drafts[q.id]?.text ?? '']
                    .filter(Boolean)
                    .join('\n')}
                </Text>
                {(entry.files[q.id] ?? []).map((file) => (
                  <Text key={file.id} selectable style={styles.muted}>
                    <InterfaceText values={{ value0: file.name, value1: file.id }}>
                      {'Attachment: {value0} ({value1})'}
                    </InterfaceText>
                  </Text>
                ))}
              </View>
            ))}
          <Action
            destructive
            label={uiText('Discard saved answers')}
            secondary
            onPress={() => store.remove(scope, taskId, entry.request.id)}
          />
        </View>
      ))}
    </View>
  )
}
