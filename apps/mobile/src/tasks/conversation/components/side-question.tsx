import { useState } from 'react'
import { View } from 'react-native'
import { Effect, Schema } from 'effect'
import { mutableStruct, type Task } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Field } from '../../../ui/controls/field'
import { Markdown } from '../../../ui/content/markdown'
import { Sheet } from '../../../ui/layout/sheet'
import { Text } from '../../../ui/content/text'
import { styles } from '../../../ui/theme'

const answerSchema = mutableStruct({ answer: Schema.String })

/** Ask about the thread without adding to the conversation. */
export function SideQuestion({ task, onClose }: { task: Task; onClose: () => void }) {
  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<{ question: string; answer: string }[]>([])
  const ask = () => {
    const text = question.trim()
    if (!text) return
    act(() =>
      callEffect('/api/tasks/aside', { id: task.id, question: text }, answerSchema).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            setAnswers((current) => [...current, { question: text, answer: result.answer }])
            setQuestion('')
          }),
        ),
      ),
    )
  }
  return (
    <Sheet title="Side question" onClose={onClose} busy={busy}>
      <Text style={styles.muted}>
        Answered from this conversation by your title model. Nothing is added to the thread.
      </Text>
      {answers.map((entry, index) => (
        <View key={index} style={[styles.card, { gap: 6 }]}>
          <Text style={[styles.muted, { fontWeight: '600' }]}>{entry.question}</Text>
          <Markdown text={entry.answer} variant="chat" />
        </View>
      ))}
      <Field
        label="Question"
        value={question}
        onChangeText={setQuestion}
        placeholder="What did the agent change so far?"
        multiline
        maxLength={4000}
        editable={!busy}
      />
      <Action
        label={busy ? 'Asking…' : 'Ask'}
        disabled={!connected || busy || !question.trim()}
        onPress={ask}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
