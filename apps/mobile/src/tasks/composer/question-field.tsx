import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Keyboard, Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { toggleQuestionChoice, type AgentQuestion, type QuestionDraft } from '@dovo/protocol'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.text, { color: colors.muted, fontWeight: '500', fontSize: 12 }]}>
        {q.header}
        {q.required ? '' : uiText(' (optional)')}
      </Text>
      <Text style={[styles.text, { fontSize: 14, lineHeight: 20, fontWeight: '600' }]}>
        {q.question}
      </Text>
      {q.multiple && (
        <Text style={[styles.muted, { fontSize: 11 }]}>
          <InterfaceText>{'Select all that apply'}</InterfaceText>
        </Text>
      )}
      {q.options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole={q.multiple ? 'checkbox' : 'radio'}
          accessibilityLabel={[option.label, option.description].filter(Boolean).join('. ')}
          aria-checked={draft.selected.includes(option.value)}
          accessibilityState={{ checked: draft.selected.includes(option.value), disabled }}
          disabled={disabled}
          onPress={() => onChange(toggleQuestionChoice(q, draft, option.value))}
          style={{
            borderWidth: 1,
            borderColor: draft.selected.includes(option.value) ? colors.accent : colors.border,
            backgroundColor: draft.selected.includes(option.value)
              ? colors.selection
              : colors.surface,
            borderRadius: 12,
            minHeight: 48,
            padding: 12,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              marginTop: 1,
              borderRadius: q.multiple ? 4 : 9,
              borderWidth: 1,
              borderColor: draft.selected.includes(option.value) ? colors.accent : colors.muted,
              backgroundColor: draft.selected.includes(option.value)
                ? colors.accent
                : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {draft.selected.includes(option.value) && (
              <Text style={{ color: colors.onAccent, fontSize: 12, lineHeight: 16 }}>✓</Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.text, { fontSize: 13, lineHeight: 19, fontWeight: '500' }]}>
              {option.label}
            </Text>
            {!!option.description && (
              <Text style={[styles.muted, { fontSize: 12, lineHeight: 18 }]}>
                {option.description}
              </Text>
            )}
          </View>
        </Pressable>
      ))}
      {q.custom && (
        <Field
          label={uiText('Answer: {value0}', { value0: q.header || q.question })}
          hideLabel
          placeholder={
            q.options.length ? uiText('Or write your own answer…') : uiText('Your answer…')
          }
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
