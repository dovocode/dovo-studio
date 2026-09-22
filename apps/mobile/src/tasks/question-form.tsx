import { useRef, useState } from 'react'
import { Keyboard, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import {
  questionAnswerError,
  questionDraftAnswers,
  type QuestionAnswers,
  type QuestionDraft,
  type PendingQuestion,
} from '@dovo/protocol'
import { QuestionField } from './question-field'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
export function QuestionForm({
  request,
  connected,
  onAnswer,
}: {
  request: PendingQuestion
  connected: boolean
  onAnswer: (answers: QuestionAnswers | null) => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() =>
      Object.fromEntries(request.prompt.questions.map((q) => [q.id, { selected: [], text: '' }])),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const submitting = useRef(false)
  const submit = async (answers: QuestionAnswers | null) => {
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
    try {
      await onAnswer(answers)
    } catch (error) {
      setError(String(error))
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <View style={[styles.card, { padding: 10, gap: 8 }]}>
      <Text style={[styles.text, { fontSize: 13, fontWeight: '600' }]}>{request.prompt.title}</Text>
      {request.prompt.blocking === false && (
        <Text style={styles.muted}>Answer when ready. You can keep chatting.</Text>
      )}
      <ScrollView
        style={{ maxHeight: 200 }}
        contentContainerStyle={{ gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        {request.prompt.questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            draft={drafts[q.id]}
            disabled={busy || !connected}
            onChange={(draft) => {
              setDrafts((current) => ({ ...current, [q.id]: draft }))
              setError('')
            }}
          />
        ))}
      </ScrollView>
      <View style={styles.row}>
        <Action
          label="Send answers"
          disabled={busy || !connected}
          onPress={() => void submit(questionDraftAnswers(drafts))}
        />
        <Action
          secondary
          label="Decline"
          disabled={busy || !connected}
          onPress={() => void submit(null)}
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
