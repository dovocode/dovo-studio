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
  const { styles } = useTheme()
  if (state.ready && !state.error && !state.detail?.stale) return null
  return (
    <View accessibilityLabel={`${label} loading status`} style={[styles.card, { gap: 8 }]}>
      <Text
        accessibilityRole={state.error ? 'alert' : undefined}
        style={state.error ? styles.error : styles.muted}
      >
        {state.error
          ? `${label}: ${state.error}`
          : state.ready
            ? `${label}: showing cached data.`
            : connected
              ? `Loading ${label.toLowerCase()}…`
              : `${label}: connect to load this section.`}
      </Text>
      {(!state.busy || state.ready) && (
        <Action
          secondary
          disabled={!connected || state.busy}
          label={`Refresh ${label.toLowerCase()}`}
          onPress={state.refresh}
        />
      )}
    </View>
  )
}
