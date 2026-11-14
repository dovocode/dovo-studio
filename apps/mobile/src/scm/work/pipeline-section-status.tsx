import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
export function PipelineSectionStatus({
  label,
  state,
  connected,
}: {
  label: string
  state: {
    ready: boolean
    error: string
    busy: boolean
    detail?: { stale?: boolean }
    refresh: () => void
  }
  connected: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  if (state.ready && !state.error && !state.detail?.stale) return null
  return (
    <View
      accessibilityLabel={uiText('{value0} loading status', { value0: label })}
      style={[styles.card, { gap: 8 }]}
    >
      <Text
        accessibilityRole={state.error ? 'alert' : undefined}
        style={state.error ? styles.error : styles.muted}
      >
        {state.error
          ? `${label}: ${state.error}`
          : state.ready
            ? uiText('{value0}: showing cached data.', { value0: label })
            : connected
              ? uiText('Loading {value0}…', { value0: label.toLowerCase() })
              : uiText('{value0}: connect to load this section.', { value0: label })}
      </Text>
      {(!state.busy || state.ready) && (
        <Action
          secondary
          disabled={!connected || state.busy}
          label={uiText('Refresh {value0}', { value0: label.toLowerCase() })}
          onPress={state.refresh}
        />
      )}
    </View>
  )
}
