import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  savedDrafts,
  onDraftsChange,
  onAnswered,
  onAnswer,
  attachmentIdsByQuestion = {},
  renderAttachments,
  attachmentsBusy = false,
  runtimeId,
  notificationAccessible,
}: {
  request: PendingQuestion
  connected: boolean
  savedDrafts?: Record<string, QuestionDraft>
  onDraftsChange?: (drafts: Record<string, QuestionDraft>) => void
  onAnswered?: () => void
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const [localDrafts, setLocalDrafts] = useApplicationState<Record<string, QuestionDraft>>(() =>
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
  const drafts = Object.fromEntries(
    request.prompt.questions.map((q) => [
      q.id,
      (!q.secret && savedDrafts?.[q.id]) || localDrafts[q.id] || { selected: [], text: '' },
    ]),
  )
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const setDrafts = (
    update: (current: Record<string, QuestionDraft>) => Record<string, QuestionDraft>,
  ) => {
    const next = update(draftsRef.current)
    draftsRef.current = next
    setLocalDrafts(next)
    onDraftsChange?.(next)
  }
  const submitting = useRef(false)
  const edited = useRef(false)
  useEffect(() => {
    if (!runtimeId) return
    let disposed = false
    void notificationAnswerDraft(runtimeId, request)
      .then((draft) => {
        if (
          disposed ||
          edited.current ||
          submitting.current ||
          !draft ||
          Object.values(draftsRef.current).some((value) => value.text || value.selected.length)
        )
          return
        setDrafts((current) => ({ ...current, ...draft }))
        setError(uiText('Your notification answer was not confirmed. Review it and send again.'))
      })
      .catch(() => {
        if (!disposed)
          setError(uiText('Could not restore your notification answer. Enter it again.'))
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
          if (answers && !outcomes) onAnswered?.()
          if (runtimeId)
            yield* nativeEffect(() =>
              clearNotificationAnswerDraft(runtimeId, request.id).catch(() => {
                setError(
                  uiText('Answer sent, but the saved notification draft could not be cleared.'),
                )
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
        <Text style={styles.muted}>
          <InterfaceText>{'Answer when ready. You can keep chatting.'}</InterfaceText>
        </Text>
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
                      ? uiText('Type secret instead')
                      : uiText('Use a secret reference')
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
                      <InterfaceText>
                        {
                          'The computer reads this value and sends it to the agent’s secret response. Dovo hides it from the activity log.'
                        }
                      </InterfaceText>
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
          label={request.prompt.unanswered ? uiText('Dismiss') : uiText('Decline')}
          disabled={busy || !connected || attachmentsBusy}
          onPress={() => void submit(null)}
        />
        {request.prompt.unanswered && (
          <Action
            label={uiText('I replied in chat')}
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
          label={uiText('Send answers')}
          disabled={busy || !connected || attachmentsBusy}
          onPress={() => void submit(questionDraftAnswers(drafts))}
        />
      </View>
      {!connected && (
        <Text style={styles.muted}>
          <InterfaceText>{'Reconnect to answer'}</InterfaceText>
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </NotificationInputView>
  )
}
