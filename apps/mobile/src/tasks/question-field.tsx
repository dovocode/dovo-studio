import { Keyboard, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { toggleQuestionChoice, type AgentQuestion, type QuestionDraft } from '@dovo/protocol'
import { Field } from '../ui/field'
import { colors, styles } from '../ui/theme'
export function QuestionField({
  question: q,
  draft,
  onChange,
  disabled,
}: {
  question: AgentQuestion
  draft: QuestionDraft
  onChange: (value: QuestionDraft) => void
  disabled: boolean
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.text, { fontWeight: '600', fontSize: 13 }]}>
        {q.header}
        {q.required ? '' : ' (optional)'}
      </Text>
      <Text style={[styles.text, { fontSize: 13 }]}>{q.question}</Text>
      {q.multiple && <Text style={[styles.muted, { fontSize: 11 }]}>Select all that apply</Text>}
      {q.options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole={q.multiple ? 'checkbox' : 'radio'}
          accessibilityLabel={option.label}
          accessibilityState={{ checked: draft.selected.includes(option.value), disabled }}
          disabled={disabled}
          onPress={() => onChange(toggleQuestionChoice(q, draft, option.value))}
          style={{
            borderWidth: 1,
            borderColor: draft.selected.includes(option.value) ? colors.accent : colors.border,
            backgroundColor: colors.surface,
            borderRadius: 8,
            padding: 8,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text style={[styles.text, { fontSize: 13 }]}>
            {draft.selected.includes(option.value) ? '✓ ' : ''}
            {option.label}
          </Text>
          {!!option.description && (
            <Text style={[styles.muted, { fontSize: 11, marginTop: 3 }]}>{option.description}</Text>
          )}
        </Pressable>
      ))}
      {q.custom && (
        <Field
          label={`Answer: ${q.header || q.question}`}
          placeholder={q.options.length ? 'Or write your own answer…' : 'Your answer…'}
          secureTextEntry={q.secret}
          keyboardType={q.inputType === 'number' ? 'numbers-and-punctuation' : 'default'}
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          editable={!disabled}
          value={draft.text}
          onChangeText={(text) => onChange({ selected: q.multiple ? draft.selected : [], text })}
        />
      )}
    </View>
  )
}
