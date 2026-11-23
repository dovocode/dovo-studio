import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { approvalDetails, type ApprovalDetailField } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { copyText } from '../../ui/content/clipboard'
import { useTheme } from '../../ui/theme'

function CodePreview({ text, label, raw = false }: { text: string; label: string; raw?: boolean }) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const [status, setStatus] = useState('')
  const code = (
    <Text
      selectable
      style={[styles.text, { padding: 8, fontFamily: 'monospace', fontSize: 13, lineHeight: 19 }]}
    >
      {text}
    </Text>
  )
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
      }}
    >
      <View
        style={[
          styles.row,
          {
            justifyContent: 'space-between',
            paddingHorizontal: 8,
            borderBottomWidth: 1,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.muted, { flexShrink: 1, fontSize: 12, fontWeight: '500' }]}>
          {label}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={uiText('Copy {value0}', { value0: label })}
          onPress={() => {
            setStatus('')
            void copyText(text).then(
              (result) => setStatus(result === 'copied' ? uiText('Copied') : ''),
              () => setStatus(uiText('Could not copy')),
            )
          }}
          style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text accessibilityLiveRegion="polite" style={[styles.text, { fontSize: 12 }]}>
            {status || uiText('Copy')}
          </Text>
        </Pressable>
      </View>
      {raw ? (
        code
      ) : (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 144, flexGrow: 0 }}>
          {code}
        </ScrollView>
      )}
    </View>
  )
}

function Fields({ fields }: { fields: ApprovalDetailField[] }) {
  const { styles, colors } = useTheme()
  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      {fields.map((field, index) => (
        <View key={index} style={{ gap: 4, minWidth: 0 }}>
          {!!field.label && !field.code && (
            <Text style={[styles.muted, { fontSize: 12, fontWeight: '500' }]}>{field.label}</Text>
          )}
          {field.children?.length ? (
            <View style={{ borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 10 }}>
              <Fields fields={field.children} />
            </View>
          ) : field.code ? (
            <CodePreview text={field.text ?? ''} label={field.label} />
          ) : (
            <Text selectable style={[styles.text, { fontSize: 13, lineHeight: 19 }]}>
              {field.text}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

export function ApprovalDetails({ detail }: { detail: string }) {
  const uiText = useInterfaceText()

  const presentation = useMemo(() => approvalDetails(detail), [detail])
  const [showJson, setShowJson] = useState(false)
  const raw = showJson && presentation.json
  const { styles, colors } = useTheme()
  return (
    <View style={{ minWidth: 0 }}>
      <ScrollView
        key={raw ? 'json' : 'fields'}
        nestedScrollEnabled
        style={{ maxHeight: 260, flexGrow: 0 }}
      >
        {raw ? (
          <CodePreview text={presentation.raw} label={uiText('Full JSON')} raw />
        ) : (
          <Fields fields={presentation.fields} />
        )}
      </ScrollView>
      {presentation.json && (
        <Pressable
          accessibilityRole="togglebutton"
          accessibilityLabel={uiText('Full JSON')}
          accessibilityState={{ checked: raw }}
          onPress={() => setShowJson(!raw)}
          style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
        >
          <Text style={[styles.muted, { fontSize: 12 }, raw && { color: colors.accent }]}>
            {uiText('Full JSON')}
          </Text>
        </Pressable>
      )}
    </View>
  )
}
