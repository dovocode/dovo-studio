import { SecretReferenceFields } from '../../agents/secret-reference-fields'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useEffect, useRef, type ReactNode } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  questionAnswerError,
  questionReferenceAnswers,
  defaultSecretReference,
  type QuestionSecretReferences,
  questionDraftAnswers,
  type QuestionAnswers,
  type QuestionOutcomes,
  type QuestionAttachmentIds,
  type AgentQuestion,
  type QuestionDraft,
  type PendingQuestion,
} from '@dovo/protocol'
import { QuestionField } from './question-field'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { notificationAnswerDraft, clearNotificationAnswerDraft } from '../../notifications/answers'
import { NotificationInputView } from '../../notifications/viewport-view'
export function QuestionForm({
  request,
  connected,
  onAnswer,
  attachmentIdsByQuestion = {},
  renderAttachments,
  attachmentsBusy = false,
  runtimeId,
  notificationAccessible,
}: {
  request: PendingQuestion
  connected: boolean
  onAnswer: (
    answers: QuestionAnswers | null,
    outcomes?: QuestionOutcomes,
    references?: QuestionSecretReferences,
  ) => Promise<void>
  attachmentIdsByQuestion?: QuestionAttachmentIds
  renderAttachments?: (question: AgentQuestion, disabled: boolean) => ReactNode
  attachmentsBusy?: boolean
  runtimeId?: string
  notificationAccessible: boolean
}) {
  const { styles } = useTheme()

  const [drafts, setDrafts] = useApplicationState<Record<string, QuestionDraft>>(() =>
      Object.fromEntries(
        request.prompt.questions.map((q) => [
          q.id,
          {
            selected: [],
            text: '',
          },
        ]),
      ),
    ),
    [busy, setBusy] = useApplicationState(false),
    [error, setError] = useApplicationState('')
  const [references, setReferences] = useApplicationState<QuestionSecretReferences>({})
  const submitting = useRef(false)
  const edited = useRef(false)
  useEffect(() => {
    if (!runtimeId) return
    let disposed = false
    void notificationAnswerDraft(runtimeId, request)
      .then((draft) => {
        if (disposed || edited.current || submitting.current || !draft) return
        setDrafts((current) => ({ ...current, ...draft }))
        setError('Your notification answer was not confirmed. Review it and send again.')
      })
      .catch(() => {
        if (!disposed) setError('Could not restore your notification answer. Enter it again.')
      })
    return () => {
      disposed = true
    }
  }, [runtimeId, request.id])
  const submit = (answers: QuestionAnswers | null, outcomes?: QuestionOutcomes) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (submitting.current || !connected || attachmentsBusy) return
        const invalid =
          answers &&
          questionAnswerError(
            request.prompt.questions,
            questionReferenceAnswers(answers, outcomes ? {} : references),
            attachmentIdsByQuestion,
          )
        if (invalid) {
          setError(invalid)
          return
        }
        Keyboard.dismiss()
        submitting.current = true
        setError('')
        setBusy(true)
        return yield* mobileWorkflow(function* () {
          yield* nativeEffect(() =>
            onAnswer(answers, outcomes, answers && !outcomes ? references : {}),
          )
          if (runtimeId)
            yield* nativeEffect(() =>
              clearNotificationAnswerDraft(runtimeId, request.id).catch(() => {
                setError('Answer sent, but the saved notification draft could not be cleared.')
              }),
            )
        }).pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              setError(String(error))
              submitting.current = false
              setBusy(false)
            }),
          ),
        )
      }),
    )
  }
  return (
    <NotificationInputView
      input={
        runtimeId
          ? { runtimeId, taskId: request.taskId, inputId: request.id, inputType: 'question' }
          : undefined
      }
      enabled={notificationAccessible && connected && !busy}
      style={[
        styles.card,
        {
          padding: 10,
          gap: 8,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            fontSize: 13,
            fontWeight: '600',
          },
        ]}
      >
        {request.prompt.title}
      </Text>
      {request.prompt.blocking === false && (
        <Text style={styles.muted}>Answer when ready. You can keep chatting.</Text>
      )}
      <ScrollView
        style={{
          maxHeight: 200,
        }}
        contentContainerStyle={{
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {request.prompt.questions.map((q) => (
          <View key={q.id} style={{ gap: 8 }}>
            <QuestionField
              question={Object.hasOwn(references, q.id) ? { ...q, custom: false, options: [] } : q}
              draft={drafts[q.id]}
              disabled={busy || !connected || attachmentsBusy}
              onChange={(draft) => {
                edited.current = true
                setDrafts((current) => ({
                  ...current,
                  [q.id]: draft,
                }))
                setError('')
              }}
            />
            {request.secretReferences && q.secret && q.custom && (
              <>
                <Action
                  secondary
                  label={
                    Object.hasOwn(references, q.id)
                      ? 'Type secret instead'
                      : 'Use a secret reference'
                  }
                  disabled={busy || !connected}
                  onPress={() => {
                    setReferences((current) => {
                      const next = { ...current }
                      if (Object.hasOwn(next, q.id)) delete next[q.id]
                      else next[q.id] = defaultSecretReference('onepassword')
                      return next
                    })
                    setDrafts((current) => ({ ...current, [q.id]: { selected: [], text: '' } }))
                    setError('')
                  }}
                />
                {Object.hasOwn(references, q.id) && (
                  <>
                    <Text style={styles.muted}>
                      The computer reads this value and sends it to the agent’s secret response.
                      Dovo hides it from the activity log.
                    </Text>
                    <SecretReferenceFields
                      value={references[q.id]}
                      disabled={busy || !connected}
                      onChange={(value) =>
                        setReferences((current) => ({ ...current, [q.id]: value }))
                      }
                    />
                  </>
                )}
              </>
            )}
            {renderAttachments?.(q, busy || !connected || attachmentsBusy)}
          </View>
        ))}
      </ScrollView>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Action
          secondary
          label={request.prompt.unanswered ? 'Dismiss' : 'Decline'}
          disabled={busy || !connected || attachmentsBusy}
          onPress={() => void submit(null)}
        />
        {request.prompt.unanswered && (
          <Action
            label="I replied in chat"
            secondary
            disabled={busy || !connected || attachmentsBusy}
            onPress={() =>
              void submit(
                {},
                Object.fromEntries(request.prompt.questions.map((q) => [q.id, 'replied_in_chat'])),
              )
            }
          />
        )}
        <Action
          label="Send answers"
          disabled={busy || !connected || attachmentsBusy}
          onPress={() => void submit(questionDraftAnswers(drafts))}
        />
      </View>
      {!connected && <Text style={styles.muted}>Reconnect to answer</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </NotificationInputView>
  )
}
