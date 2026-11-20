import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { SecretReferenceFields } from '../../agents/secret-reference-fields'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { useEffect, useRef, type ComponentRef, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  AppState,
  Keyboard,
  ScrollView,
  View,
  findNodeHandle,
  type TextInput,
} from 'react-native'
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

/** The first question that `questionAnswerError` rejects, so submit can show it in place. */
export function invalidQuestion(
  questions: readonly AgentQuestion[],
  answers: QuestionAnswers,
  attachments: QuestionAttachmentIds,
) {
  for (const question of questions) {
    const error = questionAnswerError(
      [question],
      Object.hasOwn(answers, question.id) ? { [question.id]: answers[question.id] } : {},
      Object.hasOwn(attachments, question.id) ? { [question.id]: attachments[question.id] } : {},
    )
    if (error) return { id: question.id, error }
  }
}

/** Provider-marked secret text must not outlive the foreground. Other text stays as a draft. */
export function withoutSecretDrafts(
  questions: readonly AgentQuestion[],
  drafts: Record<string, QuestionDraft>,
) {
  if (!questions.some((q) => q.secret && (drafts[q.id]?.text || drafts[q.id]?.selected.length)))
    return drafts
  const next = { ...drafts }
  for (const q of questions) if (q.secret) next[q.id] = { selected: [], text: '' }
  return next
}

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
  notificationTaskId,
  notificationRuntimeIdentity,
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
  /** The owning thread that receives this question's push notification. */
  notificationTaskId?: string
  /** This computer's identity, which a parent on another computer uses in its push. */
  notificationRuntimeIdentity?: string
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
  const setDraftsRef = useRef(setDrafts)
  setDraftsRef.current = setDrafts
  const submitting = useRef(false)
  const edited = useRef(false)
  const [invalid, setInvalid] = useApplicationState<{ id: string; error: string } | null>(null)
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null)
  const positions = useRef(new Map<string, number>())
  const inputs = useRef(new Map<string, ComponentRef<typeof TextInput>>())
  const labels = useRef(new Map<string, ComponentRef<typeof View>>())
  useEffect(() => {
    if (!request.prompt.questions.some((q) => q.secret)) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return
      // Match the secure input card. A typed secret is gone when the app returns.
      const next = withoutSecretDrafts(request.prompt.questions, draftsRef.current)
      if (next !== draftsRef.current) setDraftsRef.current(() => next)
    })
    return () => subscription.remove()
  }, [request])
  const showInvalid = (target: { id: string; error: string }) => {
    setInvalid(target)
    const y = positions.current.get(target.id)
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true })
    requestAnimationFrame(() => {
      const input = inputs.current.get(target.id)
      if (input) {
        input.focus()
        return
      }
      const label = labels.current.get(target.id)
      const node = label && findNodeHandle(label)
      if (node) AccessibilityInfo.setAccessibilityFocus(node)
    })
  }
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
        const referenced = answers && questionReferenceAnswers(answers, outcomes ? {} : references)
        const failed =
          referenced &&
          questionAnswerError(request.prompt.questions, referenced, attachmentIdsByQuestion)
        if (referenced && failed) {
          const question = invalidQuestion(
            request.prompt.questions,
            referenced,
            attachmentIdsByQuestion,
          )
          if (question) {
            setError('')
            showInvalid(question)
          } else setError(failed)
          return
        }
        setInvalid(null)
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
          ? {
              runtimeId,
              taskId: request.taskId,
              ownerTaskId: notificationTaskId,
              runtimeIdentity: notificationRuntimeIdentity,
              inputId: request.id,
              inputType: 'question',
            }
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
        ref={scroll}
        style={{
          maxHeight: 200,
        }}
        contentContainerStyle={{
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {request.prompt.questions.map((q) => (
          <View
            key={q.id}
            style={{ gap: 8 }}
            onLayout={(event) => positions.current.set(q.id, event.nativeEvent.layout.y)}
          >
            <QuestionField
              question={Object.hasOwn(references, q.id) ? { ...q, custom: false, options: [] } : q}
              draft={drafts[q.id]}
              // Offline edits stay recoverable. Only the actions that answer need the runtime.
              disabled={busy || attachmentsBusy}
              error={invalid?.id === q.id ? invalid.error : undefined}
              inputRef={(node) => {
                if (node) inputs.current.set(q.id, node)
                else inputs.current.delete(q.id)
              }}
              labelRef={(node) => {
                if (node) labels.current.set(q.id, node)
                else labels.current.delete(q.id)
              }}
              onChange={(draft) => {
                edited.current = true
                setDrafts((current) => ({
                  ...current,
                  [q.id]: draft,
                }))
                setError('')
                setInvalid((current) => (current?.id === q.id ? null : current))
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
          <InterfaceText>{'Offline. You can keep editing. Reconnect to send.'}</InterfaceText>
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
