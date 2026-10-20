import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useEffect, useRef } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import {
  questionAnswerError,
  questionDraftAnswers,
  type QuestionAnswers,
  type QuestionDraft,
  type PendingQuestion,
} from '@dovo/protocol'
import { QuestionField } from './question-field'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { notificationAnswerDraft, clearNotificationAnswerDraft } from '../../notifications/answers'
export function QuestionForm({
  request,
  connected,
  onAnswer,
  runtimeId,
}: {
  request: PendingQuestion
  connected: boolean
  onAnswer: (answers: QuestionAnswers | null) => Promise<void>
  runtimeId?: string
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
  const submit = (answers: QuestionAnswers | null) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (submitting.current || !connected) return
        const invalid = answers && questionAnswerError(request.prompt.questions, answers)
        if (invalid) {
          setError(invalid)
          return
        }
        Keyboard.dismiss()
        submitting.current = true
        setError('')
        setBusy(true)
        return yield* mobileWorkflow(function* () {
          yield* nativeEffect(() => onAnswer(answers))
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
    <View
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
          <QuestionField
            key={q.id}
            question={q}
            draft={drafts[q.id]}
            disabled={busy || !connected}
            onChange={(draft) => {
              edited.current = true
              setDrafts((current) => ({
                ...current,
                [q.id]: draft,
              }))
              setError('')
            }}
          />
        ))}
      </ScrollView>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Action
          secondary
          label="Decline"
          disabled={busy || !connected}
          onPress={() => void submit(null)}
        />
        <Action
          label="Send answers"
          disabled={busy || !connected}
          onPress={() => void submit(questionDraftAnswers(drafts))}
        />
      </View>
      {!connected && <Text style={styles.muted}>Reconnect to answer</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
