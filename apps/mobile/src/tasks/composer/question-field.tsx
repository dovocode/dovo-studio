import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Keyboard, Pressable, View, type TextInput } from 'react-native'
import type { ComponentRef, Ref } from 'react'
import { Text } from '../../ui/content/text'
import { toggleQuestionChoice, type AgentQuestion, type QuestionDraft } from '@dovo/protocol'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
export function QuestionField({
  question: q,
  draft,
  onChange,
  disabled,
  error,
  inputRef,
  labelRef,
}: {
  question: AgentQuestion
  draft: QuestionDraft
  onChange: (value: QuestionDraft) => void
  disabled: boolean
  /** Shown on this question after an explicit submit. */
  error?: string
  inputRef?: Ref<ComponentRef<typeof TextInput>>
  /** Receives screen reader focus when this question has no text field to focus. */
  labelRef?: Ref<ComponentRef<typeof View>>
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const label = [q.header, q.question].filter(Boolean).join('. ')
  return (
    <View
      // Each question is one labelled group, so a screen reader names the group it enters.
      role={q.options.length && !q.multiple ? 'radiogroup' : 'group'}
      aria-label={label}
      style={{ gap: 6 }}
    >
      <View
        ref={labelRef}
        accessible
        accessibilityLabel={[label, q.required ? '' : uiText('Optional'), error]
          .filter(Boolean)
          .join('. ')}
        style={{ gap: 6 }}
      >
        <Text style={[styles.text, { color: colors.muted, fontWeight: '500', fontSize: 12 }]}>
          {q.header}
          {q.required ? '' : uiText(' (optional)')}
        </Text>
        <Text style={[styles.text, { fontSize: 14, lineHeight: 20, fontWeight: '600' }]}>
          {q.question}
        </Text>
      </View>
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
            borderColor: draft.selected.includes(option.value)
              ? colors.accent
              : error
                ? colors.error
                : colors.border,
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
          inputRef={inputRef}
          error={error}
          value={draft.text}
          onChangeText={(text) => onChange({ selected: q.multiple ? draft.selected : [], text })}
        />
      )}
      {!!error && !q.custom && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
