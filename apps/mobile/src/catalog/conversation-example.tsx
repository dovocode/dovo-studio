import { useState } from 'react'
import { View } from 'react-native'
import { decode, agentQuestionSchema, type QuestionDraft } from '@dovo/protocol'
import { ComposerField } from '../tasks/composer/composer-field'
import { QuestionField } from '../tasks/composer/question-field'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { Switch } from '../ui/controls/switch'
import { useTheme } from '../ui/theme'

const question = decode(agentQuestionSchema, {
  id: 'catalog-review-scope',
  header: 'Review scope',
  question: 'Which parts should the next review cover?',
  multiple: true,
  custom: true,
  options: [
    {
      value: 'layout',
      label: 'Layout and navigation',
      description: 'Check small screens and long labels.',
    },
    {
      value: 'accessibility',
      label: 'Accessibility',
      description: 'Check focus, contrast and touch targets.',
    },
  ],
})

/** Production mobile input layer, with local simulated sending and no runtime connection. */
export function ConversationExample({ disconnected = false }: { disconnected?: boolean }) {
  const { styles } = useTheme()
  const [draft, setDraft] = useState('')
  const [revision, setRevision] = useState(0)
  const [fail, setFail] = useState(true)
  const [answer, setAnswer] = useState<QuestionDraft>({ selected: [], text: '' })
  const [message, setMessage] = useState('All changes stay in this example.')
  const [lastSent, setLastSent] = useState('')
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={styles.title}>
        Conversation inputs
      </Text>
      <Text style={styles.muted}>
        Production draft input and question choices. Attachments, dictation and runtime sending
        belong to the full composer.
      </Text>
      <View style={styles.card}>
        <ComposerField
          showOptions
          trailingControlCount={1}
          revision={String(revision)}
          value={draft}
          onChangeText={setDraft}
          onSelectionChange={() => undefined}
          placeholder="Write a follow-up…"
        />
      </View>
      <View style={styles.row}>
        <Text style={styles.text}>Simulate failed send</Text>
        <Switch accessibilityLabel="Simulate failed send" value={fail} onValueChange={setFail} />
      </View>
      <Action
        label="Send preview"
        wide
        disabled={disconnected || !draft.trim()}
        onPress={() => {
          if (fail) {
            setMessage('Simulated send failed. Your draft is preserved.')
            return
          }
          setLastSent(draft)
          setDraft('')
          setRevision((value) => value + 1)
          setMessage('Sent to this preview only.')
        }}
      />
      <Text accessibilityRole="status" style={styles.muted}>
        {disconnected ? 'Disconnected: draft remains editable; sending unavailable.' : message}
      </Text>
      {!!lastSent && <Text style={styles.text}>Local sent message: {lastSent}</Text>}
      <QuestionField question={question} draft={answer} onChange={setAnswer} disabled={false} />
      <Text accessibilityRole="status" style={styles.muted}>
        Local answer:{' '}
        {[...answer.selected, answer.text].filter(Boolean).join(', ') || 'Nothing selected'}
      </Text>
    </View>
  )
}
