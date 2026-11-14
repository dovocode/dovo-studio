import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import type { AccountClient } from '@dovo/protocol'
import { useThreadSuggestions } from '@dovo/studio-core'
import { Text } from './text'
import { Action } from '../controls/action'
import { useTheme } from '../theme'

export function ThreadSuggestions({
  client,
  sourceId,
  active,
  onUseSuggestion,
}: {
  client: AccountClient
  sourceId: string
  active?: boolean
  onUseSuggestion: (text: string) => void
}) {
  const uiText = useInterfaceText()

  const inbox = useThreadSuggestions(client, sourceId, active)
  const { styles, colors } = useTheme()
  if (!inbox.suggestions.length)
    return inbox.error ? (
      <Text accessibilityRole="alert" style={{ color: colors.error, padding: 16 }}>
        {inbox.error}
      </Text>
    ) : null
  return (
    <View accessibilityLabel={uiText('Suggested next prompts')} style={{ padding: 16, gap: 12 }}>
      <Text style={styles.muted}>
        <InterfaceText>{'Suggested next prompts'}</InterfaceText>
      </Text>
      {inbox.suggestions.map((item) => (
        <View key={item.id} style={[styles.card, { gap: 8 }]}>
          <Text style={styles.muted}>
            <InterfaceText values={{ value0: item.value?.name || uiText('Reader') }}>
              {'{value0} · Suggested prompt'}
            </InterfaceText>
          </Text>
          <Text selectable style={styles.text}>
            {item.value?.text ?? item.error}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {item.value && (
              <Action
                label={uiText('Use in composer')}
                onPress={() => {
                  if (item.value) onUseSuggestion(item.value.text)
                }}
              />
            )}
            <Action
              secondary
              label={uiText('Dismiss')}
              disabled={inbox.busy !== null}
              onPress={() => void inbox.dismiss(item.id)}
            />
          </View>
        </View>
      ))}
      {!!inbox.error && (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {inbox.error}
        </Text>
      )}
    </View>
  )
}
